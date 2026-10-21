//! NEXUS Companion Studio backend: cosmetic asset packs, SVG sanitising,
//! custom asset import, combos (with versions), profiles and the live look.
//!
//! Asset packs are folders under <data>/nexus-assets/. A pack folder with a
//! manifest.json declares slots and assets; loose image files dropped in a
//! folder named after a slot (e.g. nexus-assets/wings/my.png) are indexed too.
//! Nothing here is ever executed: SVG is reduced to an allowlist of drawing
//! elements and the UI only displays assets as images.

use crate::db::now;
use crate::state::{Activity, Nexus};
use anyhow::{anyhow, bail, Context, Result};
use base64::Engine;
use quick_xml::events::{BytesStart, Event};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;

include!(concat!(env!("OUT_DIR"), "/builtin_pack.rs"));

type S<'a> = State<'a, Arc<Nexus>>;
type R<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    format!("{err:#}")
}

/// Hard safety limits (memory/disk). Large on purpose; never silently applied.
const MAX_IMPORT_BYTES: u64 = 15 * 1024 * 1024;
const MAX_SVG_BYTES: usize = 3 * 1024 * 1024;
const MAX_LOOK_BYTES: usize = 4 * 1024 * 1024;

// ------------------------------------------------------------------ SVG sanitiser

const ALLOWED_ELEMENTS: &[&str] = &[
    "svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "defs", "lineargradient", "radialgradient", "stop",
    "clippath", "mask", "use", "title", "desc", "text", "tspan", "symbol", "pattern", "filter", "fegaussianblur", "feoffset", "femerge",
    "femergenode", "fecolormatrix", "feblend", "feflood", "fecomposite", "fedropshadow", "animate", "animatetransform", "set", "image", "style",
];

fn safe_url_refs(v: &str) -> bool {
    // Every url(...) must point inside the document (#id).
    let l = v.to_ascii_lowercase();
    let mut rest = l.as_str();
    while let Some(i) = rest.find("url(") {
        let after = rest[i + 4..].trim_start_matches(['\'', '"', ' ']);
        if !after.starts_with('#') {
            return false;
        }
        rest = &rest[i + 4..];
    }
    true
}

fn attr_allowed(elem: &str, key: &str, val: &str) -> bool {
    let k = key.to_ascii_lowercase();
    let v = val.trim().to_ascii_lowercase();
    if k.starts_with("on") || k == "xml:base" || k.starts_with("xlink:") && k != "xlink:href" {
        return false;
    }
    if v.contains("javascript:") || v.contains("vbscript:") || v.contains("data:text") || v.contains("expression(") {
        return false;
    }
    if k == "href" || k == "xlink:href" {
        return v.starts_with('#')
            || (elem == "image"
                && ["data:image/png;base64,", "data:image/jpeg;base64,", "data:image/gif;base64,", "data:image/webp;base64,"].iter().any(|p| v.starts_with(p)));
    }
    if k == "style" && v.contains("@import") {
        return false;
    }
    safe_url_refs(&v)
}

/// Rebuilds the SVG keeping only drawing elements and safe attributes.
pub fn sanitize_svg(src: &str) -> Result<String> {
    if src.len() > MAX_SVG_BYTES {
        bail!("SVG is larger than {} MB", MAX_SVG_BYTES / 1024 / 1024);
    }
    let mut reader = quick_xml::Reader::from_str(src);
    let mut out = quick_xml::Writer::new(Vec::new());
    let mut skip = 0usize;
    let mut seen_root = false;
    let mut in_style = false;
    let mut stack: Vec<String> = Vec::new();

    let clean = |e: &BytesStart, local: &str| -> Result<Option<BytesStart<'static>>> {
        let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
        let mut ne = BytesStart::new(name);
        for a in e.attributes().with_checks(false) {
            let a = a.map_err(|x| anyhow!("Malformed attribute: {x}"))?;
            let key = String::from_utf8_lossy(a.key.as_ref()).to_string();
            let val = a.unescape_value().map(|c| c.to_string()).unwrap_or_default();
            // Animations must not retarget links.
            if matches!(local, "animate" | "set" | "animatetransform") && key.eq_ignore_ascii_case("attributeName") && val.to_ascii_lowercase().contains("href") {
                return Ok(None);
            }
            if attr_allowed(local, &key, &val) {
                ne.push_attribute((key.as_str(), val.as_str()));
            }
        }
        Ok(Some(ne))
    };

    loop {
        let ev = reader.read_event().map_err(|x| anyhow!("Invalid SVG/XML: {x}"))?;
        match ev {
            Event::Eof => break,
            Event::Start(s) => {
                let local = String::from_utf8_lossy(s.local_name().as_ref()).to_ascii_lowercase();
                if skip > 0 {
                    skip += 1;
                    continue;
                }
                if !seen_root {
                    if local != "svg" {
                        bail!("The file is not an SVG image (root element is <{local}>)");
                    }
                    seen_root = true;
                }
                match (ALLOWED_ELEMENTS.contains(&local.as_str()), clean(&s, &local)?) {
                    (true, Some(ne)) => {
                        in_style = local == "style";
                        stack.push(local);
                        out.write_event(Event::Start(ne))?;
                    }
                    _ => skip = 1,
                }
            }
            Event::Empty(s) => {
                if skip > 0 {
                    continue;
                }
                let local = String::from_utf8_lossy(s.local_name().as_ref()).to_ascii_lowercase();
                if !seen_root {
                    bail!("The file is not an SVG image");
                }
                if ALLOWED_ELEMENTS.contains(&local.as_str()) {
                    if let Some(ne) = clean(&s, &local)? {
                        out.write_event(Event::Empty(ne))?;
                    }
                }
            }
            Event::End(_) => {
                if skip > 0 {
                    skip -= 1;
                    continue;
                }
                if let Some(name) = stack.pop() {
                    in_style = false;
                    let _ = name;
                    out.write_event(ev)?;
                }
            }
            Event::Text(t) => {
                if skip > 0 {
                    continue;
                }
                if in_style {
                    let css = t.unescape().map(|c| c.to_string()).unwrap_or_default();
                    let l = css.to_ascii_lowercase();
                    if l.contains("@import") || !safe_url_refs(&l) || l.contains("expression(") || l.contains("javascript:") {
                        continue;
                    }
                }
                out.write_event(Event::Text(t))?;
            }
            Event::CData(c) => {
                if skip == 0 && in_style {
                    let css = String::from_utf8_lossy(&c).to_string();
                    let l = css.to_ascii_lowercase();
                    if !(l.contains("@import") || !safe_url_refs(&l) || l.contains("javascript:")) {
                        out.write_event(Event::CData(c))?;
                    }
                }
            }
            // Comments, processing instructions, XML declarations and DOCTYPEs
            // (entity definitions) are dropped.
            _ => {}
        }
    }
    if !seen_root {
        bail!("The file is not an SVG image");
    }
    Ok(String::from_utf8(out.into_inner())?)
}

// ------------------------------------------------------------------ registry

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestAsset {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub category: String,
    #[serde(default = "default_type")]
    pub asset_type: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z_index: Option<f64>,
    /// Box size on the 200-unit canvas (default 200 = full canvas overlay).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<Value>,
    #[serde(default)]
    pub tintable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colors: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_color: Option<String>,
    #[serde(default)]
    pub mirrorable: bool,
    #[serde(default = "yes")]
    pub duplicable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compatible_bodies: Option<Vec<String>>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// expression -> file (eyes, mouths…)
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub variants: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

fn default_type() -> String {
    "svg".into()
}
fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub slots: Vec<Value>,
    #[serde(default)]
    pub assets: Vec<ManifestAsset>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetOut {
    /// Full id ("pack/asset"). The flattened `meta` also has `id` (short, in-pack)
    /// and `variants` (a map), so always serialise through `to_json`, which keeps
    /// these fields.
    pub id: String,
    pub pack: String,
    pub pack_name: String,
    pub custom: bool,
    pub supported: bool,
    pub unsupported_reason: Option<String>,
    pub variants: Vec<String>,
    pub favorite: bool,
    pub last_used: Option<String>,
    pub added: Option<String>,
    #[serde(flatten)]
    pub meta: ManifestAsset,
}

struct Indexed {
    out: AssetOut,
    dir: PathBuf,
}

#[derive(Default)]
pub struct Studio {
    index: Mutex<Option<(HashMap<String, Indexed>, Vec<Value>, Vec<Value>)>>,
    cache: Mutex<HashMap<PathBuf, (std::time::SystemTime, String)>>,
}

pub fn assets_root(nx: &Nexus) -> PathBuf {
    nx.data_dir.join("nexus-assets")
}

/// Folder names users can drop loose images into, mapped to slots.
const LOOSE_FOLDERS: &[(&str, &str)] = &[
    ("bodies", "body"), ("eyes", "eyes"), ("mouths", "mouth"), ("ears", "ears"), ("horns", "horns"), ("wings", "wings"), ("tails", "tail"),
    ("headwear", "headwear"), ("glasses", "glasses"), ("accessories", "body_accessories"), ("neck", "neck"), ("back", "back"),
    ("pets", "pet"), ("effects", "effects"), ("particles", "particles"), ("auras", "aura"), ("custom", "custom"),
];

/// Writes the embedded base pack and creates the drop folders.
pub fn install(nx: &Nexus) -> Result<()> {
    let root = assets_root(nx);
    let dir = root.join("builtin");
    std::fs::create_dir_all(&dir)?;
    // The builtin folder is managed by NEXUS: replace it entirely.
    for f in std::fs::read_dir(&dir)?.flatten() {
        if f.path().is_file() {
            let _ = std::fs::remove_file(f.path());
        }
    }
    for (name, bytes) in BUILTIN_PACK {
        std::fs::write(dir.join(name), bytes)?;
    }
    for (folder, _) in LOOSE_FOLDERS {
        let _ = std::fs::create_dir_all(root.join(folder));
    }
    let readme = root.join("README.txt");
    if !readme.exists() {
        let _ = std::fs::write(
            readme,
            "NEXUS cosmetic assets\r\n\r\n- Drop PNG/SVG/WEBP files into a folder such as wings\\ or auras\\ : NEXUS indexes them automatically.\r\n- Or add a pack: a folder containing manifest.json (see builtin\\manifest.json for the format).\r\n- The builtin\\ folder is managed by NEXUS and is rewritten at every start.\r\n- custom\\ holds the assets you import or create in the Studio.\r\n",
        );
    }
    Ok(())
}

fn safe_rel(source: &str) -> Option<&Path> {
    let p = Path::new(source);
    (!source.is_empty() && p.components().all(|c| matches!(c, Component::Normal(_)))).then_some(p)
}

fn meta_rows(nx: &Nexus) -> HashMap<String, (bool, Option<String>)> {
    nx.db
        .with(|c| {
            let mut st = c.prepare("SELECT asset_id, favorite, last_used FROM companion_asset_meta")?;
            let r = st.query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get::<_, bool>(1)?, r.get::<_, Option<String>>(2)?))))?;
            r.collect::<rusqlite::Result<HashMap<_, _>>>()
        })
        .unwrap_or_default()
}

fn ext_type(p: &Path) -> Option<&'static str> {
    match p.extension()?.to_string_lossy().to_ascii_lowercase().as_str() {
        "svg" => Some("svg"),
        "png" => Some("png"),
        "webp" => Some("webp"),
        _ => None,
    }
}

fn build_index(nx: &Nexus) -> (HashMap<String, Indexed>, Vec<Value>, Vec<Value>) {
    let root = assets_root(nx);
    let meta = meta_rows(nx);
    let mut assets: HashMap<String, Indexed> = HashMap::new();
    let mut slots: Vec<Value> = Vec::new();
    let mut packs: Vec<Value> = Vec::new();
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(&root).map(|it| it.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect()).unwrap_or_default();
    // builtin first so its slot definitions take precedence.
    dirs.sort_by_key(|d| (d.file_name().map(|f| f != "builtin").unwrap_or(true), d.clone()));
    for dir in dirs {
        let folder = dir.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
        let mpath = dir.join("manifest.json");
        if mpath.exists() {
            let m: Manifest = match std::fs::read_to_string(&mpath).ok().and_then(|t| serde_json::from_str(&t).ok()) {
                Some(m) => m,
                None => {
                    packs.push(json!({"id": folder, "name": folder, "error": "manifest.json is not valid"}));
                    continue;
                }
            };
            let pack_id = if m.id.is_empty() { folder.clone() } else { m.id.clone() };
            for s in &m.slots {
                if let Some(id) = s["id"].as_str() {
                    if !slots.iter().any(|x| x["id"] == id) {
                        let mut s = s.clone();
                        s["pack"] = json!(pack_id);
                        slots.push(s);
                    }
                }
            }
            let mut count = 0;
            for a in m.assets {
                let full = format!("{pack_id}/{}", a.id);
                let (supported, reason) = match a.asset_type.as_str() {
                    "svg" | "png" | "webp" if safe_rel(&a.source).is_some() && dir.join(&a.source).is_file() => (true, None),
                    "svg" | "png" | "webp" => (false, Some(format!("File '{}' is missing", a.source))),
                    "3d" | "gltf" | "glb" => (false, Some("3D assets are not supported by the current 2D renderer".to_string())),
                    other => (false, Some(format!("Asset type '{other}' is not supported"))),
                };
                let (fav, used) = meta.get(&full).cloned().unwrap_or((false, None));
                let added = std::fs::metadata(dir.join(&a.source)).ok().and_then(|m| m.modified().ok()).map(|t| chrono::DateTime::<chrono::Local>::from(t).to_rfc3339());
                let mut meta_a = a.clone();
                if meta_a.name.is_empty() {
                    meta_a.name = a.id.clone();
                }
                assets.insert(
                    full.clone(),
                    Indexed {
                        out: AssetOut {
                            id: full,
                            pack: pack_id.clone(),
                            pack_name: if m.name.is_empty() { pack_id.clone() } else { m.name.clone() },
                            custom: pack_id == "custom",
                            supported,
                            unsupported_reason: reason,
                            variants: a.variants.keys().cloned().collect(),
                            favorite: fav,
                            last_used: used,
                            added,
                            meta: meta_a,
                        },
                        dir: dir.clone(),
                    },
                );
                count += 1;
            }
            packs.push(json!({"id": pack_id, "name": m.name, "version": m.version, "assets": count, "folder": folder}));
        } else if let Some((_, slot)) = LOOSE_FOLDERS.iter().find(|(f, _)| *f == folder) {
            // Loose images: index with sensible defaults.
            let mut count = 0;
            for f in std::fs::read_dir(&dir).map(|it| it.flatten().collect::<Vec<_>>()).unwrap_or_default() {
                let p = f.path();
                let Some(t) = ext_type(&p) else { continue };
                let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                let full = format!("{folder}/{stem}");
                let (fav, used) = meta.get(&full).cloned().unwrap_or((false, None));
                let added = f.metadata().ok().and_then(|m| m.modified().ok()).map(|t| chrono::DateTime::<chrono::Local>::from(t).to_rfc3339());
                assets.insert(
                    full.clone(),
                    Indexed {
                        out: AssetOut {
                            id: full,
                            pack: folder.clone(),
                            pack_name: format!("Folder {folder}"),
                            custom: false,
                            supported: true,
                            unsupported_reason: None,
                            variants: vec![],
                            favorite: fav,
                            last_used: used,
                            added,
                            meta: ManifestAsset {
                                id: stem.clone(),
                                name: stem.replace(['_', '-'], " "),
                                category: slot.to_string(),
                                asset_type: t.into(),
                                source: p.file_name().unwrap().to_string_lossy().to_string(),
                                size: Some(if t == "svg" { 200.0 } else { 110.0 }),
                                mirrorable: true,
                                duplicable: true,
                                ..Default::default()
                            },
                        },
                        dir: dir.clone(),
                    },
                );
                count += 1;
            }
            if count > 0 {
                packs.push(json!({"id": folder, "name": format!("Folder {folder}"), "assets": count, "folder": folder, "loose": true}));
            }
        }
    }
    (assets, slots, packs)
}

impl AssetOut {
    pub fn to_json(&self) -> Value {
        let mut v = serde_json::to_value(self).unwrap_or(Value::Null);
        v["id"] = json!(self.id);
        v["variants"] = json!(self.variants);
        v
    }
}

fn with_index<T>(nx: &Nexus, f: impl FnOnce(&HashMap<String, Indexed>, &Vec<Value>, &Vec<Value>) -> T) -> T {
    let mut g = nx.studio.index.lock().unwrap();
    if g.is_none() {
        *g = Some(build_index(nx));
    }
    let (a, s, p) = g.as_ref().unwrap();
    f(a, s, p)
}

fn invalidate(nx: &Nexus) {
    *nx.studio.index.lock().unwrap() = None;
    nx.emit("nexus://studio-assets", json!({}));
}

#[tauri::command]
pub fn studio_registry(nx: S) -> Value {
    with_index(&nx, |a, s, p| {
        let mut list: Vec<&AssetOut> = a.values().map(|i| &i.out).collect();
        list.sort_by(|x, y| (x.meta.category.as_str(), x.meta.name.to_lowercase()).cmp(&(y.meta.category.as_str(), y.meta.name.to_lowercase())));
        let list: Vec<Value> = list.into_iter().map(AssetOut::to_json).collect();
        json!({"assets": list, "slots": s, "packs": p, "root": assets_root(&nx).display().to_string()})
    })
}

#[tauri::command]
pub fn studio_rescan(nx: S) -> Value {
    invalidate(&nx);
    studio_registry(nx)
}

/// Returns the sanitised SVG text or a data: URL for raster images.
#[tauri::command]
pub fn studio_asset_data(nx: S, id: String, variant: Option<String>) -> R<Value> {
    let (path, kind) = with_index(&nx, |a, _, _| -> R<(PathBuf, String)> {
        let i = a.get(&id).ok_or_else(|| format!("Unknown asset {id}"))?;
        if !i.out.supported {
            return Err(i.out.unsupported_reason.clone().unwrap_or_else(|| "Unsupported asset".into()));
        }
        let file = variant.as_ref().and_then(|v| i.out.meta.variants.get(v)).unwrap_or(&i.out.meta.source);
        let rel = safe_rel(file).ok_or("Invalid asset path in manifest")?;
        Ok((i.dir.join(rel), i.out.meta.asset_type.clone()))
    })?;
    let mtime = std::fs::metadata(&path).and_then(|m| m.modified()).map_err(e)?;
    if let Some((t, v)) = nx.studio.cache.lock().unwrap().get(&path) {
        if *t == mtime {
            return Ok(json!({"kind": if kind == "svg" { "svg" } else { "raster" }, "data": v}));
        }
    }
    let data = match kind.as_str() {
        "svg" => sanitize_svg(&std::fs::read_to_string(&path).map_err(e)?).map_err(e)?,
        _ => {
            let bytes = std::fs::read(&path).map_err(e)?;
            let mime = if kind == "webp" { "image/webp" } else { "image/png" };
            format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
        }
    };
    nx.studio.cache.lock().unwrap().insert(path, (mtime, data.clone()));
    Ok(json!({"kind": if kind == "svg" { "svg" } else { "raster" }, "data": data}))
}

#[tauri::command]
pub fn studio_set_favorite(nx: S, id: String, favorite: bool) -> R<()> {
    nx.db
        .with(|c| c.execute("INSERT INTO companion_asset_meta(asset_id,favorite) VALUES(?1,?2) ON CONFLICT(asset_id) DO UPDATE SET favorite=excluded.favorite", params![id, favorite]))
        .map_err(e)?;
    invalidate(&nx);
    Ok(())
}

#[tauri::command]
pub fn studio_touch(nx: S, id: String) -> R<()> {
    nx.db
        .with(|c| c.execute("INSERT INTO companion_asset_meta(asset_id,favorite,last_used) VALUES(?1,0,?2) ON CONFLICT(asset_id) DO UPDATE SET last_used=excluded.last_used", params![id, now()]))
        .map_err(e)?;
    if let Some((a, _, _)) = nx.studio.index.lock().unwrap().as_mut() {
        if let Some(i) = a.get_mut(&id) {
            i.out.last_used = Some(now());
        }
    }
    Ok(())
}

// ------------------------------------------------------------------ custom pack

fn custom_dir(nx: &Nexus) -> PathBuf {
    assets_root(nx).join("custom")
}

fn load_custom(nx: &Nexus) -> Result<Manifest> {
    let p = custom_dir(nx).join("manifest.json");
    if !p.exists() {
        return Ok(Manifest { id: "custom".into(), name: "My Assets".into(), version: "1".into(), ..Default::default() });
    }
    Ok(serde_json::from_str(&std::fs::read_to_string(p)?).context("custom/manifest.json is corrupted")?)
}

fn save_custom(nx: &Nexus, m: &Manifest) -> Result<()> {
    std::fs::create_dir_all(custom_dir(nx))?;
    let tmp = custom_dir(nx).join("manifest.json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(m)?)?;
    std::fs::rename(tmp, custom_dir(nx).join("manifest.json"))?;
    Ok(())
}

fn new_id(name: &str) -> String {
    let base: String = name.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
    let base = base.trim_matches('_').chars().take(30).collect::<String>();
    format!("{}_{}", if base.is_empty() { "asset" } else { &base }, &uuid::Uuid::new_v4().simple().to_string()[..8])
}

/// Validates bytes really are the claimed format.
fn check_raster(bytes: &[u8], t: &str) -> Result<(u32, u32)> {
    let fmt = match t {
        "png" => image::ImageFormat::Png,
        _ => image::ImageFormat::WebP,
    };
    let img = image::load_from_memory_with_format(bytes, fmt).with_context(|| format!("The file is not a valid {} image", t.to_uppercase()))?;
    Ok((img.width(), img.height()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOpts {
    pub name: String,
    pub category: String,
    pub z_index: Option<f64>,
    pub tintable: bool,
    pub mirrorable: bool,
    pub duplicable: bool,
    pub scale: Option<f64>,
    pub anchor_x: Option<f64>,
    pub anchor_y: Option<f64>,
}

fn store_asset(nx: &Nexus, bytes: &[u8], t: &str, o: &ImportOpts, colors: Option<Value>) -> Result<String> {
    let mut m = load_custom(nx)?;
    let id = new_id(&o.name);
    let file = format!("{id}.{t}");
    std::fs::create_dir_all(custom_dir(nx))?;
    std::fs::write(custom_dir(nx).join(&file), bytes)?;
    let size = if t == "svg" { 200.0 } else { 110.0 };
    m.assets.push(ManifestAsset {
        id: id.clone(),
        name: o.name.trim().chars().take(80).collect(),
        category: o.category.clone(),
        asset_type: t.into(),
        source: file,
        z_index: o.z_index,
        size: Some(size),
        scale: o.scale,
        anchor: match (o.anchor_x, o.anchor_y) {
            (Some(x), Some(y)) => Some(json!({"x": x.clamp(0.0, 1.0), "y": y.clamp(0.0, 1.0)})),
            _ => None,
        },
        tintable: o.tintable,
        colors,
        mirrorable: o.mirrorable,
        duplicable: o.duplicable,
        ..Default::default()
    });
    save_custom(nx, &m)?;
    Ok(format!("custom/{id}"))
}

#[tauri::command]
pub fn studio_import_asset(nx: S, path: String, opts: ImportOpts) -> R<String> {
    let p = PathBuf::from(&path);
    let ext = p.extension().map(|x| x.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    if ext == "gltf" || ext == "glb" {
        return Err("3D (GLTF/GLB) assets are not supported: the Companion renderer is 2D. Import a PNG, SVG or WEBP.".into());
    }
    let t = ext_type(&p).ok_or("Only PNG, SVG and WEBP files can be imported")?;
    if opts.name.trim().is_empty() || opts.category.trim().is_empty() {
        return Err("Name and category are required".into());
    }
    let md = std::fs::metadata(&p).map_err(|_| "File not found".to_string())?;
    if md.len() > MAX_IMPORT_BYTES {
        return Err(format!("The file is {} MB; the limit is {} MB (memory safety)", md.len() / 1_048_576, MAX_IMPORT_BYTES / 1_048_576));
    }
    let bytes = std::fs::read(&p).map_err(e)?;
    let stored: Vec<u8> = if t == "svg" {
        let text = String::from_utf8(bytes).map_err(|_| "The SVG is not valid UTF-8 text".to_string())?;
        sanitize_svg(&text).map_err(e)?.into_bytes()
    } else {
        check_raster(&bytes, t).map_err(e)?;
        bytes
    };
    let id = store_asset(&nx, &stored, t, &opts, None).map_err(e)?;
    nx.log(Activity { kind: "manual".into(), action: format!("Companion asset imported: {} ({t}, {})", opts.name, opts.category), status: "ok".into(), result: Some(id.clone()), ..Default::default() });
    invalidate(&nx);
    Ok(id)
}

/// Assets drawn in the Studio's shape editor.
#[tauri::command]
pub fn studio_create_asset(nx: S, svg: String, opts: ImportOpts, colors: Option<Value>) -> R<String> {
    if opts.name.trim().is_empty() {
        return Err("Name is required".into());
    }
    let clean = sanitize_svg(&svg).map_err(e)?;
    let id = store_asset(&nx, clean.as_bytes(), "svg", &opts, colors).map_err(e)?;
    nx.log(Activity { kind: "manual".into(), action: format!("Companion component created: {}", opts.name), status: "ok".into(), result: Some(id.clone()), ..Default::default() });
    invalidate(&nx);
    Ok(id)
}

fn custom_local_id(id: &str) -> R<&str> {
    id.strip_prefix("custom/").ok_or_else(|| "Only assets in My Assets can be modified; duplicate this one first".to_string())
}

#[tauri::command]
pub fn studio_update_asset(nx: S, id: String, patch: Value) -> R<()> {
    let local = custom_local_id(&id)?;
    let mut m = load_custom(&nx).map_err(e)?;
    let a = m.assets.iter_mut().find(|a| a.id == local).ok_or("Asset not found")?;
    if let Some(v) = patch["name"].as_str() {
        if !v.trim().is_empty() {
            a.name = v.trim().chars().take(80).collect();
        }
    }
    if let Some(v) = patch["category"].as_str() {
        a.category = v.to_string();
    }
    if let Some(v) = patch["zIndex"].as_f64() {
        a.z_index = Some(v);
    }
    if let Some(v) = patch["tintable"].as_bool() {
        a.tintable = v;
    }
    if let Some(v) = patch["mirrorable"].as_bool() {
        a.mirrorable = v;
    }
    if let Some(v) = patch["duplicable"].as_bool() {
        a.duplicable = v;
    }
    if let Some(v) = patch["scale"].as_f64() {
        a.scale = Some(v);
    }
    if let Some(v) = patch["tags"].as_array() {
        a.tags = v.iter().filter_map(|t| t.as_str().map(String::from)).collect();
    }
    save_custom(&nx, &m).map_err(e)?;
    invalidate(&nx);
    Ok(())
}

/// Copies any asset (including built-in ones) into My Assets so it can be edited.
#[tauri::command]
pub fn studio_duplicate_asset(nx: S, id: String) -> R<String> {
    let (src_meta, dir) = with_index(&nx, |a, _, _| a.get(&id).map(|i| (i.out.meta.clone(), i.dir.clone()))).ok_or("Unknown asset")?;
    let mut m = load_custom(&nx).map_err(e)?;
    let nid = new_id(&src_meta.name);
    std::fs::create_dir_all(custom_dir(&nx)).map_err(e)?;
    let mut copy = src_meta.clone();
    copy.id = nid.clone();
    copy.name = format!("{} (copy)", src_meta.name);
    let copy_file = |f: &str| -> R<String> {
        let rel = safe_rel(f).ok_or("Invalid path")?;
        let ext = Path::new(f).extension().map(|x| x.to_string_lossy().to_string()).unwrap_or_else(|| "svg".into());
        let dest = format!("{nid}_{}.{ext}", &uuid::Uuid::new_v4().simple().to_string()[..6]);
        std::fs::copy(dir.join(rel), custom_dir(&nx).join(&dest)).map_err(e)?;
        Ok(dest)
    };
    copy.source = copy_file(&src_meta.source)?;
    copy.variants = src_meta.variants.iter().map(|(k, v)| copy_file(v).map(|d| (k.clone(), d))).collect::<R<HashMap<_, _>>>()?;
    m.assets.push(copy);
    save_custom(&nx, &m).map_err(e)?;
    invalidate(&nx);
    Ok(format!("custom/{nid}"))
}

#[tauri::command]
pub fn studio_delete_asset(nx: S, id: String) -> R<()> {
    let local = custom_local_id(&id)?.to_string();
    let mut m = load_custom(&nx).map_err(e)?;
    let pos = m.assets.iter().position(|a| a.id == local).ok_or("Asset not found")?;
    let a = m.assets.remove(pos);
    for f in std::iter::once(&a.source).chain(a.variants.values()) {
        if let Some(rel) = safe_rel(f) {
            let _ = trash::delete(custom_dir(&nx).join(rel));
        }
    }
    save_custom(&nx, &m).map_err(e)?;
    nx.log(Activity { kind: "manual".into(), action: format!("Companion asset moved to Recycle Bin: {}", a.name), status: "ok".into(), ..Default::default() });
    invalidate(&nx);
    Ok(())
}

/// Exports an asset (files + its manifest entry) into a folder the user picked.
#[tauri::command]
pub fn studio_export_asset(nx: S, id: String, dest_dir: String) -> R<String> {
    let (meta, dir) = with_index(&nx, |a, _, _| a.get(&id).map(|i| (i.out.meta.clone(), i.dir.clone()))).ok_or("Unknown asset")?;
    let out = PathBuf::from(dest_dir).join(format!("nexus-asset-{}", meta.id));
    std::fs::create_dir_all(&out).map_err(e)?;
    for f in std::iter::once(&meta.source).chain(meta.variants.values()) {
        let rel = safe_rel(f).ok_or("Invalid path")?;
        std::fs::copy(dir.join(rel), out.join(rel)).map_err(e)?;
    }
    let pack = Manifest { id: format!("export-{}", meta.id), name: meta.name.clone(), version: "1.0.0".into(), slots: vec![], assets: vec![meta] };
    std::fs::write(out.join("manifest.json"), serde_json::to_vec_pretty(&pack).map_err(e)?).map_err(e)?;
    Ok(out.display().to_string())
}

#[tauri::command]
pub fn studio_open_folder(nx: S) -> R<()> {
    crate::win::apps::shell_open(&assets_root(&nx).display().to_string(), None).map_err(e)
}

// ------------------------------------------------------------------ live look

const LOOK_KEY: &str = "companion_look";

#[tauri::command]
pub fn studio_get_look(nx: S) -> R<Option<Value>> {
    nx.db.get_setting(LOOK_KEY).map_err(e)
}

/// The Companion window re-renders on `nexus://appearance`.
#[tauri::command]
pub fn studio_set_look(nx: S, look: Value) -> R<()> {
    if look.to_string().len() > MAX_LOOK_BYTES {
        return Err("Look data is too large".into());
    }
    if !look["layers"].is_array() {
        return Err("Invalid look: missing layers".into());
    }
    nx.db.set_setting(LOOK_KEY, &look).map_err(e)?;
    nx.emit("nexus://appearance", &look);
    Ok(())
}

// ------------------------------------------------------------------ combos & versions

#[tauri::command]
pub fn studio_list_combos(nx: S) -> R<Vec<Value>> {
    nx.db
        .with(|c| {
            let mut st = c.prepare(
                "SELECT c.id,c.name,c.created_at,c.updated_at,c.current_version,
                        (SELECT COUNT(*) FROM companion_combo_versions v WHERE v.combo_id=c.id),
                        (SELECT data FROM companion_combo_versions v WHERE v.combo_id=c.id AND v.version=c.current_version)
                 FROM companion_combos c ORDER BY c.updated_at DESC",
            )?;
            let r = st.query_map([], |r| {
                Ok(json!({"id": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)?, "createdAt": r.get::<_, String>(2)?, "updatedAt": r.get::<_, String>(3)?,
                    "currentVersion": r.get::<_, i64>(4)?, "versions": r.get::<_, i64>(5)?,
                    "data": r.get::<_, Option<String>>(6)?.and_then(|s| serde_json::from_str::<Value>(&s).ok())}))
            })?;
            r.collect()
        })
        .map_err(e)
}

/// New combo, or a new version of an existing one.
#[tauri::command]
pub fn studio_save_combo(nx: S, combo_id: Option<String>, name: String, data: Value) -> R<Value> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Combo name is required".into());
    }
    if !data["layers"].is_array() {
        return Err("Invalid combo: missing layers".into());
    }
    let ts = now();
    let s = data.to_string();
    let (id, v) = nx
        .db
        .with(|c| {
            let id = match combo_id {
                Some(id) if c.query_row("SELECT 1 FROM companion_combos WHERE id=?1", [&id], |_| Ok(())).optional()?.is_some() => id,
                _ => {
                    let id = uuid::Uuid::new_v4().to_string();
                    c.execute("INSERT INTO companion_combos(id,name,created_at,updated_at,current_version) VALUES(?1,?2,?3,?3,0)", params![id, name, ts])?;
                    id
                }
            };
            let v: i64 = c.query_row("SELECT COALESCE(MAX(version),0)+1 FROM companion_combo_versions WHERE combo_id=?1", [&id], |r| r.get(0))?;
            c.execute("INSERT INTO companion_combo_versions(combo_id,version,data,created_at) VALUES(?1,?2,?3,?4)", params![id, v, s, ts])?;
            c.execute("UPDATE companion_combos SET name=?2, current_version=?3, updated_at=?4 WHERE id=?1", params![id, name, v, ts])?;
            Ok((id, v))
        })
        .map_err(e)?;
    nx.log(Activity { kind: "manual".into(), action: format!("Companion combo saved: {name} v{v}"), status: "ok".into(), ..Default::default() });
    Ok(json!({"id": id, "version": v}))
}

#[tauri::command]
pub fn studio_get_combo(nx: S, id: String) -> R<Value> {
    nx.db
        .with(|c| {
            let (name, cur): (String, i64) = c.query_row("SELECT name,current_version FROM companion_combos WHERE id=?1", [&id], |r| Ok((r.get(0)?, r.get(1)?)))?;
            let mut st = c.prepare("SELECT version,created_at,data FROM companion_combo_versions WHERE combo_id=?1 ORDER BY version DESC")?;
            let versions = st
                .query_map([&id], |r| {
                    Ok(json!({"version": r.get::<_, i64>(0)?, "createdAt": r.get::<_, String>(1)?, "data": serde_json::from_str::<Value>(&r.get::<_, String>(2)?).unwrap_or(Value::Null)}))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(json!({"id": id, "name": name, "currentVersion": cur, "versions": versions}))
        })
        .map_err(e)
}

#[tauri::command]
pub fn studio_restore_version(nx: S, id: String, version: i64) -> R<Value> {
    let data: String = nx
        .db
        .with(|c| {
            let d = c.query_row("SELECT data FROM companion_combo_versions WHERE combo_id=?1 AND version=?2", params![id, version], |r| r.get(0))?;
            c.execute("UPDATE companion_combos SET current_version=?2, updated_at=?3 WHERE id=?1", params![id, version, now()])?;
            Ok(d)
        })
        .map_err(e)?;
    serde_json::from_str(&data).map_err(e)
}

#[tauri::command]
pub fn studio_duplicate_version(nx: S, id: String, version: i64) -> R<i64> {
    nx.db
        .with(|c| {
            let d: String = c.query_row("SELECT data FROM companion_combo_versions WHERE combo_id=?1 AND version=?2", params![id, version], |r| r.get(0))?;
            let v: i64 = c.query_row("SELECT COALESCE(MAX(version),0)+1 FROM companion_combo_versions WHERE combo_id=?1", [&id], |r| r.get(0))?;
            c.execute("INSERT INTO companion_combo_versions(combo_id,version,data,created_at) VALUES(?1,?2,?3,?4)", params![id, v, d, now()])?;
            c.execute("UPDATE companion_combos SET current_version=?2, updated_at=?3 WHERE id=?1", params![id, v, now()])?;
            Ok(v)
        })
        .map_err(e)
}

#[tauri::command]
pub fn studio_delete_version(nx: S, id: String, version: i64) -> R<()> {
    nx.db
        .with(|c| {
            let n: i64 = c.query_row("SELECT COUNT(*) FROM companion_combo_versions WHERE combo_id=?1", [&id], |r| r.get(0))?;
            if n <= 1 {
                return Err(rusqlite::Error::InvalidQuery);
            }
            c.execute("DELETE FROM companion_combo_versions WHERE combo_id=?1 AND version=?2", params![id, version])?;
            c.execute(
                "UPDATE companion_combos SET current_version=(SELECT MAX(version) FROM companion_combo_versions WHERE combo_id=?1) WHERE id=?1 AND current_version=?2",
                params![id, version],
            )?;
            Ok(())
        })
        .map_err(|_| "The last remaining version cannot be deleted; delete the combo instead".to_string())
}

#[tauri::command]
pub fn studio_rename_combo(nx: S, id: String, name: String) -> R<()> {
    if name.trim().is_empty() {
        return Err("Name is required".into());
    }
    nx.db.with(|c| c.execute("UPDATE companion_combos SET name=?2, updated_at=?3 WHERE id=?1", params![id, name.trim(), now()])).map_err(e)?;
    Ok(())
}

#[tauri::command]
pub fn studio_delete_combo(nx: S, id: String) -> R<()> {
    nx.db
        .with(|c| {
            c.execute("DELETE FROM companion_combo_versions WHERE combo_id=?1", [&id])?;
            c.execute("DELETE FROM companion_combos WHERE id=?1", [&id])
        })
        .map_err(e)?;
    Ok(())
}

/// Portable combo file: layout + embedded copies of the custom assets it uses.
#[tauri::command]
pub fn studio_export_combo(nx: S, name: String, data: Value, dest: String) -> R<String> {
    let mut embedded = Vec::new();
    let ids: Vec<String> = data["layers"].as_array().map(|l| l.iter().filter_map(|x| x["assetId"].as_str().map(String::from)).collect()).unwrap_or_default();
    for id in ids.iter().filter(|i| i.starts_with("custom/")) {
        let found = with_index(&nx, |a, _, _| a.get(id).map(|i| (i.out.meta.clone(), i.dir.clone())));
        if let Some((meta, dir)) = found {
            let mut files = serde_json::Map::new();
            for f in std::iter::once(&meta.source).chain(meta.variants.values()) {
                if let Some(rel) = safe_rel(f) {
                    if let Ok(b) = std::fs::read(dir.join(rel)) {
                        files.insert(f.clone(), json!(base64::engine::general_purpose::STANDARD.encode(b)));
                    }
                }
            }
            embedded.push(json!({"asset": meta, "files": files}));
        }
    }
    let doc = json!({"format": "nexus-combo", "formatVersion": 1, "name": name, "data": data, "customAssets": embedded});
    let mut p = PathBuf::from(dest);
    if p.extension().is_none() {
        p.set_extension("nexuscombo.json");
    }
    std::fs::write(&p, serde_json::to_vec_pretty(&doc).map_err(e)?).map_err(e)?;
    Ok(p.display().to_string())
}

#[tauri::command]
pub fn studio_import_combo(nx: S, path: String) -> R<Value> {
    let text = std::fs::read_to_string(&path).map_err(|_| "Could not read the file".to_string())?;
    if text.len() > 40 * 1024 * 1024 {
        return Err("Combo file is too large".into());
    }
    let doc: Value = serde_json::from_str(&text).map_err(|_| "Not a NEXUS combo file (invalid JSON)".to_string())?;
    if doc["format"] != "nexus-combo" {
        return Err("Not a NEXUS combo file".into());
    }
    let mut data = doc["data"].clone();
    if !data["layers"].is_array() {
        return Err("Combo file has no layers".into());
    }
    // Re-import embedded custom assets through the same validation as manual imports.
    let mut remap: HashMap<String, String> = HashMap::new();
    let mut m = load_custom(&nx).map_err(e)?;
    for ca in doc["customAssets"].as_array().cloned().unwrap_or_default() {
        let Ok(mut meta) = serde_json::from_value::<ManifestAsset>(ca["asset"].clone()) else { continue };
        let old = format!("custom/{}", meta.id);
        let nid = new_id(&meta.name);
        let mut rename: HashMap<String, String> = HashMap::new();
        let mut ok = true;
        for (fname, b64) in ca["files"].as_object().cloned().unwrap_or_default() {
            let Some(bytes) = b64.as_str().and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok()) else { ok = false; break };
            let Some(t) = ext_type(Path::new(&fname)) else { ok = false; break };
            let clean = if t == "svg" {
                match String::from_utf8(bytes).ok().and_then(|s| sanitize_svg(&s).ok()) {
                    Some(s) => s.into_bytes(),
                    None => { ok = false; break }
                }
            } else {
                if check_raster(&bytes, t).is_err() { ok = false; break }
                bytes
            };
            let dest = format!("{nid}_{}.{t}", &uuid::Uuid::new_v4().simple().to_string()[..6]);
            std::fs::create_dir_all(custom_dir(&nx)).map_err(e)?;
            std::fs::write(custom_dir(&nx).join(&dest), clean).map_err(e)?;
            rename.insert(fname, dest);
        }
        if !ok || !rename.contains_key(&meta.source) {
            continue;
        }
        meta.id = nid.clone();
        meta.source = rename[&meta.source].clone();
        meta.variants = meta.variants.iter().filter_map(|(k, v)| rename.get(v).map(|d| (k.clone(), d.clone()))).collect();
        m.assets.push(meta);
        remap.insert(old, format!("custom/{nid}"));
    }
    save_custom(&nx, &m).map_err(e)?;
    if let Some(layers) = data["layers"].as_array_mut() {
        for l in layers {
            if let Some(newid) = l["assetId"].as_str().and_then(|i| remap.get(i)) {
                l["assetId"] = json!(newid);
            }
        }
    }
    invalidate(&nx);
    let name = doc["name"].as_str().unwrap_or("Imported combo").to_string();
    let saved = studio_save_combo(nx, None, name, data.clone())?;
    Ok(json!({"combo": saved, "data": data, "importedAssets": remap.len()}))
}

// ------------------------------------------------------------------ profiles

const ACTIVE_PROFILE: &str = "companion_active_profile";

#[tauri::command]
pub fn studio_list_profiles(nx: S) -> R<Value> {
    let list: Vec<Value> = nx
        .db
        .with(|c| {
            let mut st = c.prepare("SELECT id,name,data,updated_at FROM companion_profiles ORDER BY created_at")?;
            let r = st.query_map([], |r| {
                Ok(json!({"id": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)?, "data": serde_json::from_str::<Value>(&r.get::<_, String>(2)?).unwrap_or(Value::Null), "updatedAt": r.get::<_, String>(3)?}))
            })?;
            r.collect()
        })
        .map_err(e)?;
    let active = nx.db.get_setting(ACTIVE_PROFILE).ok().flatten();
    Ok(json!({"profiles": list, "active": active}))
}

#[tauri::command]
pub fn studio_save_profile(nx: S, id: Option<String>, name: String, data: Value) -> R<String> {
    if name.trim().is_empty() {
        return Err("Profile name is required".into());
    }
    let id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let ts = now();
    nx.db
        .with(|c| {
            c.execute(
                "INSERT INTO companion_profiles(id,name,data,created_at,updated_at) VALUES(?1,?2,?3,?4,?4)
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name, data=excluded.data, updated_at=excluded.updated_at",
                params![id, name.trim(), data.to_string(), ts],
            )
        })
        .map_err(e)?;
    Ok(id)
}

#[tauri::command]
pub fn studio_delete_profile(nx: S, id: String) -> R<()> {
    nx.db.with(|c| c.execute("DELETE FROM companion_profiles WHERE id=?1", [&id])).map_err(e)?;
    Ok(())
}

/// Switches the live Companion to a profile (look, size and optional position).
#[tauri::command]
pub fn studio_activate_profile(nx: S, app: tauri::AppHandle, id: String) -> R<Value> {
    let data: String = nx.db.with(|c| c.query_row("SELECT data FROM companion_profiles WHERE id=?1", [&id], |r| r.get(0))).map_err(|_| "Profile not found".to_string())?;
    let data: Value = serde_json::from_str(&data).map_err(e)?;
    if data["look"]["layers"].is_array() {
        nx.db.set_setting(LOOK_KEY, &data["look"]).map_err(e)?;
        nx.emit("nexus://appearance", &data["look"]);
    }
    if let (Some(x), Some(y)) = (data["position"][0].as_i64(), data["position"][1].as_i64()) {
        if let Some(w) = tauri::Manager::get_webview_window(&app, crate::companion::LABEL) {
            let _ = w.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
        }
    }
    nx.db.set_setting(ACTIVE_PROFILE, &json!(id)).map_err(e)?;
    Ok(data)
}

#[tauri::command]
pub fn companion_position(app: tauri::AppHandle) -> Option<(i32, i32)> {
    let w = tauri::Manager::get_webview_window(&app, crate::companion::LABEL)?;
    w.outer_position().ok().map(|p| (p.x, p.y))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_scripts_handlers_and_external_refs() {
        let evil = r##"<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "boom">]><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="0 0 10 10">
            <script>alert(1)</script><foreignObject><div>hi</div></foreignObject>
            <a href="javascript:alert(1)"><rect width="5" height="5"/></a>
            <image href="https://evil.example/x.png"/><use href="https://evil.example/s.svg#a"/>
            <circle r="3" fill="url(https://evil.example/p)" onclick="x()"/><circle r="2" fill="url(#ok)"/>
            <style>@import url(https://evil.example/a.css); .a{fill:red}</style>
            <animate attributeName="href" to="javascript:alert(1)"/></svg>"##;
        let s = sanitize_svg(evil).unwrap();
        for bad in ["script", "alert", "foreignObject", "onload", "onclick", "evil.example", "@import", "DOCTYPE", "ENTITY", "javascript"] {
            assert!(!s.contains(bad), "{bad} survived: {s}");
        }
        assert!(s.contains("url(#ok)"), "{s}");
        assert!(s.starts_with("<svg"));
    }

    #[test]
    fn keeps_drawing_and_animation() {
        let ok = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><radialGradient id="a"><stop offset="0" stop-color="{{primary}}"/></radialGradient></defs><g><circle cx="10" cy="10" r="5" fill="url(#a)"><animate attributeName="r" values="1;5" dur="1s" repeatCount="indefinite"/></circle></g></svg>"##;
        let s = sanitize_svg(ok).unwrap();
        assert!(s.contains("<animate") && s.contains("{{primary}}") && s.contains("radialGradient"));
    }

    #[test]
    fn rejects_non_svg() {
        assert!(sanitize_svg("<html><body/></html>").is_err());
        assert!(sanitize_svg("not xml at all <<<").is_err());
    }

    #[test]
    fn builtin_pack_is_valid_and_safe() {
        let manifest = BUILTIN_PACK.iter().find(|(n, _)| *n == "manifest.json").expect("manifest");
        let m: Manifest = serde_json::from_slice(manifest.1).unwrap();
        assert!(m.assets.len() >= 40);
        for a in &m.assets {
            for f in std::iter::once(&a.source).chain(a.variants.values()) {
                let (_, bytes) = BUILTIN_PACK.iter().find(|(n, _)| n == f).unwrap_or_else(|| panic!("missing {f}"));
                let text = std::str::from_utf8(bytes).unwrap();
                let clean = sanitize_svg(text).unwrap_or_else(|e| panic!("{f}: {e}"));
                assert!(clean.len() > text.len() / 2, "{f} lost too much content in sanitising");
            }
        }
        for needed in ["white_blob", "cat_ears", "dragon_wings", "angel_wings", "demon_tail", "crown", "round_glasses", "purple_aura", "blue_aura", "stars", "nexus_blob", "floaty_fins", "blob_eyes", "tiny_mouth", "status_badges"] {
            assert!(m.assets.iter().any(|a| a.id == needed), "missing {needed}");
        }
    }

    #[test]
    fn registry_json_keeps_the_full_asset_id() {
        let out = AssetOut {
            id: "builtin/nexus_blob".into(), pack: "builtin".into(), pack_name: "Base".into(), custom: false, supported: true, unsupported_reason: None,
            variants: vec!["concerned".into()], favorite: false, last_used: None, added: None,
            meta: ManifestAsset {
                id: "nexus_blob".into(), category: "body".into(), source: "nexus_blob.svg".into(),
                variants: HashMap::from([("concerned".to_string(), "nexus_blob__concerned.svg".to_string())]), ..Default::default()
            },
        };
        assert_eq!(out.to_json()["id"], "builtin/nexus_blob");
        assert_eq!(out.to_json()["variants"], json!(["concerned"]));
        // Serialised as text too (what the frontend parses: the last duplicate key wins).
        let text = out.to_json().to_string();
        assert_eq!(text.matches("\"id\"").count(), 1);
    }

    #[test]
    fn manifest_paths_cannot_escape() {
        assert!(safe_rel("wings.svg").is_some());
        assert!(safe_rel("sub/wings.svg").is_some());
        assert!(safe_rel("../secret.txt").is_none());
        assert!(safe_rel("C:\\Windows\\win.ini").is_none());
        assert!(safe_rel("").is_none());
    }
}
