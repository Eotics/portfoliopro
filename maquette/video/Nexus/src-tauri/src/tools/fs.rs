//! Filesystem tools confined to user-authorized workspaces.
//!
//! Every path goes through `resolve`: absolute-izes, rejects device/UNC/ADS
//! paths, normalises `..`, resolves symlinks/junctions of existing ancestors,
//! then checks containment against canonicalised workspaces. Paths outside a
//! workspace need explicit one-time approval; system and credential locations
//! are refused outright.

use super::{Assessment, RunCtx, ToolOutput, ToolSpec};
use crate::db::now;
use crate::permissions::{Kind, Risk};
use crate::state::Nexus;
use anyhow::{anyhow, bail, Context, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

pub fn specs() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "filesystem.list", description: "List a folder's contents. Relative paths are inside the default NEXUS workspace.",
            scope: "filesystem.read", risk: Risk::Low, kind: Kind::Read,
            schema: || json!({"type":"object","properties":{"path":{"type":"string","maxLength":1000}},"additionalProperties":false}),
        },
        ToolSpec {
            name: "filesystem.read", description: "Read a file's text: plain text and source code, PDF (extracted text), DOCX (extracted text) or ZIP (list of entries, never extracted). Up to 25 MB; returns at most max_chars characters (default 20000). For images use filesystem_read_image.",
            scope: "filesystem.read", risk: Risk::Low, kind: Kind::Read,
            schema: || json!({"type":"object","properties":{"path":{"type":"string","maxLength":1000},"max_chars":{"type":"integer","minimum":100,"maximum":200000}},"required":["path"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "filesystem.write", description: "Write a text file. mode: create (fails if it exists, default), overwrite, or append. Parent folders are created.",
            scope: "filesystem.write", risk: Risk::Medium, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"path":{"type":"string","maxLength":1000},"content":{"type":"string","maxLength":2000000},"mode":{"type":"string","enum":["create","overwrite","append"]}},"required":["path","content"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "filesystem.edit", description: "Precisely edit a text/code file by replacing old_string with new_string (old_string must match exactly and be unique unless replace_all). Preferred over filesystem_write for code changes: the user reviews the diff.",
            scope: "filesystem.write", risk: Risk::Medium, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"path":{"type":"string","maxLength":1000},"old_string":{"type":"string","maxLength":200000},"new_string":{"type":"string","maxLength":200000},"replace_all":{"type":"boolean"}},"required":["path","old_string","new_string"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "filesystem.read_image", description: "Look at an image file (png, jpg, gif, webp, bmp) in an authorized folder.",
            scope: "filesystem.read", risk: Risk::Low, kind: Kind::Read,
            schema: || json!({"type":"object","properties":{"path":{"type":"string","maxLength":1000}},"required":["path"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "filesystem.create_folder", description: "Create a folder (and missing parents).",
            scope: "filesystem.write", risk: Risk::Medium, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"path":{"type":"string","maxLength":1000}},"required":["path"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "filesystem.rename", description: "Rename a file or folder in place (new_name is a name, not a path).",
            scope: "filesystem.write", risk: Risk::Medium, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"path":{"type":"string","maxLength":1000},"new_name":{"type":"string","maxLength":255}},"required":["path","new_name"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "filesystem.move", description: "Move a file or folder. Fails if the destination exists.",
            scope: "filesystem.write", risk: Risk::Medium, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"from":{"type":"string","maxLength":1000},"to":{"type":"string","maxLength":1000}},"required":["from","to"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "filesystem.copy", description: "Copy a file (or a folder recursively). Fails if the destination exists.",
            scope: "filesystem.write", risk: Risk::Medium, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"from":{"type":"string","maxLength":1000},"to":{"type":"string","maxLength":1000}},"required":["from","to"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "filesystem.delete", description: "Move a file or folder to the Windows Recycle Bin (recoverable).",
            scope: "filesystem.delete", risk: Risk::High, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"path":{"type":"string","maxLength":1000}},"required":["path"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "filesystem.search", description: "Find files/folders whose name contains query (case-insensitive), under path or all authorized folders.",
            scope: "filesystem.read", risk: Risk::Low, kind: Kind::Read,
            schema: || json!({"type":"object","properties":{"query":{"type":"string","maxLength":200},"path":{"type":"string","maxLength":1000},"max_results":{"type":"integer","minimum":1,"maximum":500}},"required":["query"],"additionalProperties":false}),
        },
    ]
}

// ---------- workspaces ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: i64,
    pub path: String,
    pub label: String,
    pub exists: bool,
}

pub fn workspaces(nx: &Nexus) -> Vec<Workspace> {
    nx.db
        .with(|c| {
            let mut st = c.prepare("SELECT id,path,label FROM workspaces ORDER BY id")?;
            let r = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?;
            r.collect::<rusqlite::Result<Vec<_>>>()
        })
        .unwrap_or_default()
        .into_iter()
        .map(|(id, path, label)| Workspace { exists: Path::new(&path).is_dir(), id, path, label })
        .collect()
}

pub fn add_workspace(nx: &Nexus, path: &str, label: Option<&str>) -> Result<Workspace> {
    let p = PathBuf::from(path.trim());
    if !p.is_absolute() {
        bail!("Workspace path must be absolute");
    }
    check_syntax(&p)?;
    let canon = dunce::canonicalize(&p).with_context(|| format!("{} does not exist", p.display()))?;
    if !canon.is_dir() {
        bail!("{} is not a folder", canon.display());
    }
    if let Some(why) = protected(nx, &canon) {
        bail!("{} cannot be a workspace: {why}", canon.display());
    }
    if canon.parent().is_none() {
        bail!("A whole drive cannot be a workspace; pick a folder");
    }
    let label = label.map(String::from).unwrap_or_else(|| canon.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default());
    let s = canon.display().to_string();
    nx.db.with(|c| c.execute("INSERT OR IGNORE INTO workspaces(path,label,created_at) VALUES(?1,?2,?3)", rusqlite::params![s, label, now()]))?;
    workspaces(nx).into_iter().find(|w| w.path == s).ok_or_else(|| anyhow!("workspace not saved"))
}

pub fn remove_workspace(nx: &Nexus, id: i64) -> Result<()> {
    nx.db.with(|c| c.execute("DELETE FROM workspaces WHERE id=?1", [id]))?;
    Ok(())
}

pub fn ensure_default_workspace(nx: &Nexus) -> Result<()> {
    if !workspaces(nx).is_empty() {
        return Ok(());
    }
    let home = std::env::var("USERPROFILE").context("USERPROFILE not set")?;
    let dir = PathBuf::from(home).join("NexusWorkspace");
    std::fs::create_dir_all(&dir)?;
    add_workspace(nx, &dir.display().to_string(), Some("NexusWorkspace"))?;
    Ok(())
}

// ---------- path security ----------

const RESERVED: &[&str] = &["con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3"];

fn check_syntax(p: &Path) -> Result<()> {
    let s = p.to_string_lossy();
    if s.contains('\0') {
        bail!("Path contains a NUL character");
    }
    if s.starts_with(r"\\") || s.starts_with("//") {
        bail!("Network (UNC) and device paths are not allowed");
    }
    // A colon is only valid as the drive separator; elsewhere it means an alternate data stream.
    if s.char_indices().any(|(i, c)| c == ':' && i != 1) {
        bail!("Alternate data streams are not allowed");
    }
    for c in p.components() {
        if let Component::Normal(n) = c {
            let n = n.to_string_lossy().to_lowercase();
            let stem = n.split('.').next().unwrap_or("");
            if RESERVED.contains(&stem) {
                bail!("'{n}' is a reserved Windows device name");
            }
        }
    }
    Ok(())
}

fn lexical_normalize(p: &Path) -> Result<PathBuf> {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                if out.parent().is_none() {
                    bail!("Path escapes its root");
                }
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    Ok(out)
}

/// Canonicalises the deepest existing ancestor (resolving links), then re-appends the rest.
fn canonical_lenient(p: &Path) -> Result<PathBuf> {
    let mut existing = p.to_path_buf();
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    while !existing.exists() {
        let name = existing.file_name().ok_or_else(|| anyhow!("Invalid path"))?.to_os_string();
        rest.push(name);
        if !existing.pop() {
            bail!("Invalid path");
        }
    }
    let mut c = dunce::canonicalize(&existing)?;
    for r in rest.into_iter().rev() {
        c.push(r);
    }
    Ok(c)
}

fn lower(p: &Path) -> String {
    p.to_string_lossy().to_lowercase().trim_end_matches('\\').to_string()
}

fn is_within(child: &Path, parent: &Path) -> bool {
    let (c, p) = (lower(child), lower(parent));
    c == p || c.starts_with(&format!("{p}\\"))
}

/// Locations NEXUS never touches, regardless of approval.
pub fn protected(nx: &Nexus, p: &Path) -> Option<String> {
    let env = |k: &str| std::env::var(k).ok().map(PathBuf::from);
    let mut system: Vec<PathBuf> = vec![];
    for k in ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Some(d) = env(k) {
            system.push(d);
        }
    }
    if let Some(d) = env("ProgramData") {
        system.push(d.join("Microsoft"));
    }
    for s in &system {
        if is_within(p, s) {
            return Some(format!("{} is a protected system location", s.display()));
        }
    }
    if is_within(p, &nx.data_dir) {
        return Some("NEXUS's own configuration and permission database cannot be modified by the agent".into());
    }
    // Credential stores: blocks credential extraction attempts.
    let l = lower(p);
    let secret_dirs = [r"\.ssh", r"\.aws", r"\.azure", r"\.gnupg", r"\.kube", r"\microsoft\credentials", r"\microsoft\protect", r"\microsoft\vault"];
    if secret_dirs.iter().any(|d| l.contains(d)) {
        return Some("This location stores credentials or keys".into());
    }
    let name = p.file_name().map(|f| f.to_string_lossy().to_lowercase()).unwrap_or_default();
    if ["login data", "cookies", "web data", "key3.db", "key4.db", "logins.json", "local state", "ntuser.dat"].contains(&name.as_str())
        || name.ends_with(".kdbx")
        || name.ends_with(".pem")
        || name == ".env"
    {
        return Some("This file stores credentials, keys or browser secrets".into());
    }
    None
}

pub struct Resolved {
    pub path: PathBuf,
    pub inside: bool,
}

pub fn resolve(nx: &Nexus, raw: Option<&str>) -> Result<Resolved> {
    let ws = workspaces(nx);
    let default = ws.first().map(|w| PathBuf::from(&w.path)).ok_or_else(|| anyhow!("No authorized folder is configured"))?;
    let raw = raw.map(|s| s.trim()).filter(|s| !s.is_empty());
    let mut p = match raw {
        None => default.clone(),
        Some(r) => {
            let r = if let Some(rest) = r.strip_prefix("~") {
                format!("{}{}", std::env::var("USERPROFILE").unwrap_or_default(), rest)
            } else {
                r.to_string()
            };
            let r = r.replace('/', "\\");
            let pb = PathBuf::from(&r);
            if pb.is_absolute() {
                pb
            } else if r.starts_with('\\') || (r.len() >= 2 && &r[1..2] == ":") {
                bail!("Drive-relative paths are ambiguous; use a full path like C:\\Users\\...");
            } else {
                default.join(pb)
            }
        }
    };
    check_syntax(&p)?;
    p = lexical_normalize(&p)?;
    let canon = canonical_lenient(&p)?;
    let inside = ws.iter().any(|w| dunce::canonicalize(&w.path).map(|wp| is_within(&canon, &wp)).unwrap_or(false));
    Ok(Resolved { path: canon, inside })
}

// ---------- content extraction & diffs ----------

pub const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];

pub fn ext_of(p: &Path) -> String {
    p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn docx_text(bytes: &[u8]) -> Result<String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).context("not a valid DOCX (zip) file")?;
    let mut xml = String::new();
    use std::io::Read;
    zip.by_name("word/document.xml").context("DOCX has no word/document.xml")?.read_to_string(&mut xml)?;
    let xml = xml.replace("</w:p>", "\n").replace("<w:tab/>", "\t").replace("<w:br/>", "\n");
    let re = regex::Regex::new(r"<[^>]+>").unwrap();
    let text = re.replace_all(&xml, "");
    Ok(text.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&"))
}

fn zip_listing(bytes: &[u8]) -> Result<String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).context("not a valid ZIP file")?;
    let mut out = format!("ZIP archive with {} entries (contents not extracted):\n", zip.len());
    for i in 0..zip.len().min(500) {
        let f = zip.by_index(i)?;
        out.push_str(&format!("{}\t{} bytes\n", f.name(), f.size()));
    }
    Ok(out)
}

/// Returns (text, kind). Never executes anything; archives are only listed.
pub fn extract_text(p: &Path) -> Result<(String, &'static str)> {
    let md = std::fs::metadata(p).with_context(|| format!("{} does not exist", p.display()))?;
    if md.is_dir() {
        bail!("{} is a folder; use filesystem_list", p.display());
    }
    if md.len() > 25 * 1024 * 1024 {
        bail!("File is {} MB; only files up to 25 MB can be read", md.len() / 1_048_576);
    }
    let ext = ext_of(p);
    if IMAGE_EXT.contains(&ext.as_str()) {
        bail!("{} is an image; use filesystem_read_image to look at it", p.display());
    }
    let bytes = std::fs::read(p)?;
    match ext.as_str() {
        "pdf" => {
            // pdf-extract can panic on malformed files; contain it.
            let r = std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(&bytes));
            match r {
                Ok(Ok(t)) if !t.trim().is_empty() => Ok((t, "pdf")),
                Ok(Ok(_)) => bail!("This PDF has no extractable text (it may be a scanned image; OCR is not implemented)"),
                Ok(Err(e)) => bail!("Could not extract text from the PDF: {e}"),
                Err(_) => bail!("The PDF parser failed on this file (unsupported or malformed PDF)"),
            }
        }
        "docx" => Ok((docx_text(&bytes)?, "docx")),
        "zip" => Ok((zip_listing(&bytes)?, "zip")),
        _ => {
            if bytes.iter().take(8000).any(|b| *b == 0) {
                bail!("{} is a binary file, not text", p.display());
            }
            Ok((String::from_utf8_lossy(&bytes).to_string(), "text"))
        }
    }
}

pub fn unified_diff(before: &str, after: &str, name: &str) -> String {
    let d = similar::TextDiff::from_lines(before, after);
    let mut s = d.unified_diff().context_radius(3).header(&format!("a/{name}"), &format!("b/{name}")).to_string();
    if s.len() > 60_000 {
        let mut cut = 60_000;
        while !s.is_char_boundary(cut) {
            cut -= 1;
        }
        s.truncate(cut);
        s.push_str("\n… diff truncated …\n");
    }
    s
}

fn apply_edit(content: &str, old: &str, new: &str, all: bool) -> Result<(String, usize)> {
    if old.is_empty() {
        bail!("old_string is empty; use filesystem_write to create files");
    }
    let n = content.matches(old).count();
    match (n, all) {
        (0, _) => bail!("old_string was not found in the file (it must match exactly, including whitespace)"),
        (n, false) if n > 1 => bail!("old_string appears {n} times; add surrounding context to make it unique or set replace_all"),
        _ => Ok((if all { content.replace(old, new) } else { content.replacen(old, new, 1) }, n)),
    }
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default()
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(String::from)
}

pub fn assess(nx: &Arc<Nexus>, spec: &ToolSpec, input: &Value) -> Result<Assessment> {
    let paths: Vec<(&str, Resolved)> = match spec.name {
        "filesystem.move" | "filesystem.copy" => vec![
            ("From", resolve(nx, s(input, "from").as_deref())?),
            ("To", resolve(nx, s(input, "to").as_deref())?),
        ],
        "filesystem.search" if input.get("path").is_none() => vec![],
        _ => vec![("Path", resolve(nx, s(input, "path").as_deref())?)],
    };
    let verb = match spec.name {
        "filesystem.list" => "List",
        "filesystem.read" => "Read",
        "filesystem.write" => match s(input, "mode").as_deref() {
            Some("overwrite") => "Overwrite",
            Some("append") => "Append to",
            _ => "Create file",
        },
        "filesystem.create_folder" => "Create folder",
        "filesystem.edit" => "Edit",
        "filesystem.read_image" => "View image",
        "filesystem.rename" => "Rename",
        "filesystem.move" => "Move",
        "filesystem.copy" => "Copy",
        "filesystem.delete" => "Delete (to Recycle Bin)",
        _ => "Search",
    };
    let target = paths.first().map(|(_, r)| r.path.display().to_string()).unwrap_or_else(|| "all authorized folders".into());
    let mut a = Assessment::new(spec, format!("{verb} {target}"));
    for (k, r) in &paths {
        a = a.detail(k, r.path.display().to_string());
        if !r.inside {
            a.outside_workspace = true;
        }
        if let Some(why) = protected(nx, &r.path) {
            a.hard_deny = Some(why);
        }
    }
    if spec.name == "filesystem.write" {
        if let Some(c) = s(input, "content") {
            a = a.detail("Size", format!("{} characters", c.chars().count()));
        }
        if s(input, "mode").as_deref() == Some("overwrite") {
            a = a.detail("Consequence", "Existing content will be replaced");
        }
    }
    if spec.name == "filesystem.rename" {
        a = a.detail("New name", s(input, "new_name").unwrap_or_default());
    }
    // Show the exact change so the user reviews it before it is applied.
    if let Some((_, r)) = paths.first() {
        let preview = match spec.name {
            "filesystem.edit" => std::fs::read_to_string(&r.path).ok().and_then(|c| {
                apply_edit(&c, &s(input, "old_string").unwrap_or_default(), &s(input, "new_string").unwrap_or_default(), input.get("replace_all").and_then(|v| v.as_bool()).unwrap_or(false))
                    .ok()
                    .map(|(after, _)| unified_diff(&c, &after, &file_name(&r.path)))
            }),
            "filesystem.write" if s(input, "mode").as_deref() != Some("append") => {
                let before = std::fs::read_to_string(&r.path).unwrap_or_default();
                let after = s(input, "content").unwrap_or_default();
                (before.len() < 2_000_000).then(|| unified_diff(&before, &after, &file_name(&r.path)))
            }
            _ => None,
        };
        if let Some(d) = preview {
            a = a.detail("Diff", d);
        }
    }
    if a.outside_workspace && spec.kind == Kind::Act {
        a.risk = Risk::High;
    }
    Ok(a)
}

fn entry_json(p: &Path) -> Value {
    let md = std::fs::symlink_metadata(p).ok();
    let modified = md.as_ref().and_then(|m| m.modified().ok()).map(|t| chrono::DateTime::<chrono::Local>::from(t).to_rfc3339());
    json!({
        "name": p.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
        "path": p.display().to_string(),
        "type": if md.as_ref().map(|m| m.is_dir()).unwrap_or(false) { "folder" } else { "file" },
        "size": md.as_ref().filter(|m| m.is_file()).map(|m| m.len()),
        "modified": modified,
    })
}

fn copy_recursive(from: &Path, to: &Path) -> Result<u64> {
    if from.is_file() {
        return Ok(std::fs::copy(from, to)?);
    }
    let mut total = 0;
    for e in walkdir::WalkDir::new(from).follow_links(false) {
        let e = e?;
        let rel = e.path().strip_prefix(from)?;
        let dest = to.join(rel);
        if e.file_type().is_dir() {
            std::fs::create_dir_all(&dest)?;
        } else if e.file_type().is_file() {
            total += std::fs::copy(e.path(), &dest)?;
        }
    }
    Ok(total)
}

pub async fn call(nx: &Arc<Nexus>, run: &RunCtx, name: &str, input: Value) -> Result<ToolOutput> {
    let nx2 = nx.clone();
    let cancel = run.token.clone();
    let name = name.to_string();
    tokio::task::spawn_blocking(move || call_sync(&nx2, &name, input, cancel)).await?
}

fn call_sync(nx: &Nexus, name: &str, input: Value, cancel: tokio_util::sync::CancellationToken) -> Result<ToolOutput> {
    let path = || resolve(nx, s(&input, "path").as_deref()).map(|r| r.path);
    match name {
        "filesystem.list" => {
            let p = path()?;
            if !p.is_dir() {
                bail!("{} is not a folder", p.display());
            }
            let mut items: Vec<Value> = std::fs::read_dir(&p)?.flatten().take(500).map(|e| entry_json(&e.path())).collect();
            items.sort_by_key(|v| (v["type"] != "folder", v["name"].as_str().unwrap_or("").to_lowercase()));
            Ok(ToolOutput::new(format!("{} item(s) in {}", items.len(), p.display()), json!({"path": p.display().to_string(), "items": items})))
        }
        "filesystem.read" => {
            let p = path()?;
            let (text, kind) = extract_text(&p)?;
            let max = input.get("max_chars").and_then(|m| m.as_u64()).unwrap_or(20000) as usize;
            let total = text.chars().count();
            let content: String = text.chars().take(max).collect();
            Ok(ToolOutput::new(
                format!("Read {} ({kind}, {} characters{})", p.display(), total, if total > max { ", truncated" } else { "" }),
                json!({"path": p.display().to_string(), "kind": kind, "content": content, "truncated": total > max, "totalChars": total}),
            )
            .untrusted())
        }
        "filesystem.read_image" => {
            let p = path()?;
            if !IMAGE_EXT.contains(&ext_of(&p).as_str()) {
                bail!("{} is not a supported image (png, jpg, gif, webp, bmp)", p.display());
            }
            let md = std::fs::metadata(&p).with_context(|| format!("{} does not exist", p.display()))?;
            if md.len() > 30 * 1024 * 1024 {
                bail!("Image is larger than 30 MB");
            }
            let img = image::open(&p).with_context(|| format!("Could not decode {}", p.display()))?;
            let (w, h) = (img.width(), img.height());
            let img = if w > 1568 || h > 1568 { img.resize(1568, 1568, image::imageops::FilterType::Triangle) } else { img };
            let mut buf = Vec::new();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 85).encode_image(&img.to_rgb8())?;
            use base64::Engine;
            let mut out = ToolOutput::new(format!("Viewed {} ({w}x{h})", p.display()), json!({"path": p.display().to_string(), "width": w, "height": h})).untrusted();
            out.images.push(super::ImageOut { media_type: "image/jpeg".into(), data: base64::engine::general_purpose::STANDARD.encode(&buf) });
            Ok(out)
        }
        "filesystem.edit" => {
            let p = path()?;
            let before = std::fs::read_to_string(&p).with_context(|| format!("{} is not a readable UTF-8 text file", p.display()))?;
            let all = input.get("replace_all").and_then(|v| v.as_bool()).unwrap_or(false);
            let (after, n) = apply_edit(&before, &s(&input, "old_string").unwrap_or_default(), &s(&input, "new_string").unwrap_or_default(), all)?;
            if cancel.is_cancelled() {
                bail!("Interrupted by STOP NEXUS");
            }
            std::fs::write(&p, after.as_bytes())?;
            let ok = std::fs::read_to_string(&p).map(|c| c == after).unwrap_or(false);
            let diff = unified_diff(&before, &after, &file_name(&p));
            Ok(ToolOutput::new(format!("Edited {} ({n} replacement{})", p.display(), if n > 1 { "s" } else { "" }), json!({"path": p.display().to_string(), "replacements": n, "diff": diff})).verified(ok))
        }
        "filesystem.write" => {
            let p = path()?;
            let content = s(&input, "content").unwrap_or_default();
            let mode = s(&input, "mode").unwrap_or("create".into());
            if p.is_dir() {
                bail!("{} is a folder", p.display());
            }
            if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent)?;
            }
            use std::io::Write;
            let before = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            let previous = if mode == "append" { None } else { std::fs::read_to_string(&p).ok().filter(|c| c.len() < 2_000_000) };
            match mode.as_str() {
                "create" => {
                    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&p)
                        .with_context(|| format!("{} already exists (use mode overwrite or append)", p.display()))?;
                    f.write_all(content.as_bytes())?;
                }
                "append" => {
                    let mut f = std::fs::OpenOptions::new().append(true).create(true).open(&p)?;
                    f.write_all(content.as_bytes())?;
                }
                _ => std::fs::write(&p, content.as_bytes())?,
            }
            // Verify by reading back.
            let after = std::fs::read(&p)?;
            let ok = match mode.as_str() {
                "append" => after.len() as u64 == before + content.len() as u64 && after.ends_with(content.as_bytes()),
                _ => after == content.as_bytes(),
            };
            let diff = (mode != "append").then(|| unified_diff(previous.as_deref().unwrap_or(""), &content, &file_name(&p)));
            Ok(ToolOutput::new(format!("Wrote {} bytes to {}", content.len(), p.display()), json!({"path": p.display().to_string(), "bytes": after.len(), "diff": diff})).verified(ok))
        }
        "filesystem.create_folder" => {
            let p = path()?;
            std::fs::create_dir_all(&p)?;
            Ok(ToolOutput::new(format!("Folder {} exists", p.display()), json!({"path": p.display().to_string()})).verified(p.is_dir()))
        }
        "filesystem.rename" => {
            let p = path()?;
            let new_name = s(&input, "new_name").unwrap_or_default();
            if new_name.is_empty() || new_name.contains(['\\', '/', ':']) || new_name == "." || new_name == ".." {
                bail!("new_name must be a plain file name");
            }
            if !p.exists() {
                bail!("{} does not exist", p.display());
            }
            let dest = p.with_file_name(&new_name);
            check_syntax(&dest)?;
            if let Some(why) = protected(nx, &dest) {
                bail!("{why}");
            }
            if dest.exists() {
                bail!("{} already exists", dest.display());
            }
            std::fs::rename(&p, &dest)?;
            Ok(ToolOutput::new(format!("Renamed to {}", dest.display()), json!({"path": dest.display().to_string()})).verified(dest.exists() && !p.exists()))
        }
        "filesystem.move" | "filesystem.copy" => {
            let from = resolve(nx, s(&input, "from").as_deref())?.path;
            let mut to = resolve(nx, s(&input, "to").as_deref())?.path;
            if !from.exists() {
                bail!("{} does not exist", from.display());
            }
            if to.is_dir() {
                to = to.join(from.file_name().ok_or_else(|| anyhow!("invalid source"))?);
            }
            if to.exists() {
                bail!("{} already exists", to.display());
            }
            if is_within(&to, &from) {
                bail!("Cannot place a folder inside itself");
            }
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent)?;
            }
            if cancel.is_cancelled() {
                bail!("Interrupted by STOP NEXUS");
            }
            if name == "filesystem.copy" {
                let bytes = copy_recursive(&from, &to)?;
                Ok(ToolOutput::new(format!("Copied to {}", to.display()), json!({"to": to.display().to_string(), "bytes": bytes})).verified(to.exists()))
            } else {
                if std::fs::rename(&from, &to).is_err() {
                    // Cross-volume: copy then recycle the source.
                    copy_recursive(&from, &to)?;
                    trash::delete(&from).map_err(|e| anyhow!("copied, but could not remove source: {e}"))?;
                }
                Ok(ToolOutput::new(format!("Moved to {}", to.display()), json!({"to": to.display().to_string()})).verified(to.exists() && !from.exists()))
            }
        }
        "filesystem.delete" => {
            let p = path()?;
            if !p.exists() {
                bail!("{} does not exist", p.display());
            }
            let ws = workspaces(nx);
            if ws.iter().any(|w| lower(Path::new(&w.path)) == lower(&p)) {
                bail!("Refusing to delete an authorized folder itself");
            }
            trash::delete(&p).map_err(|e| anyhow!("Recycle Bin operation failed: {e}"))?;
            Ok(ToolOutput::new(format!("Moved {} to the Recycle Bin", p.display()), json!({"path": p.display().to_string()})).verified(!p.exists()))
        }
        "filesystem.search" => {
            let q = s(&input, "query").unwrap_or_default().to_lowercase();
            if q.is_empty() {
                bail!("query is empty");
            }
            let max = input.get("max_results").and_then(|m| m.as_u64()).unwrap_or(100) as usize;
            let roots: Vec<PathBuf> = match s(&input, "path") {
                Some(_) => vec![path()?],
                None => workspaces(nx).into_iter().map(|w| PathBuf::from(w.path)).collect(),
            };
            let mut hits = Vec::new();
            'outer: for r in roots {
                for e in walkdir::WalkDir::new(&r).max_depth(10).follow_links(false).into_iter().flatten() {
                    if cancel.is_cancelled() {
                        bail!("Interrupted by STOP NEXUS");
                    }
                    if e.file_name().to_string_lossy().to_lowercase().contains(&q) && protected(nx, e.path()).is_none() {
                        hits.push(entry_json(e.path()));
                        if hits.len() >= max {
                            break 'outer;
                        }
                    }
                }
            }
            Ok(ToolOutput::new(format!("{} match(es) for '{q}'", hits.len()), json!(hits)))
        }
        _ => Err(anyhow!("Tool {name} is not implemented")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits_require_unique_exact_match() {
        assert_eq!(apply_edit("a b a", "b", "c", false).unwrap(), ("a c a".to_string(), 1));
        assert!(apply_edit("a b a", "a", "x", false).is_err());
        assert_eq!(apply_edit("a b a", "a", "x", true).unwrap().0, "x b x");
        assert!(apply_edit("abc", "zzz", "x", false).is_err());
        assert!(apply_edit("abc", "", "x", false).is_err());
    }

    #[test]
    fn diff_shows_real_changes() {
        let d = unified_diff("one\ntwo\nthree\n", "one\n2\nthree\n", "f.txt");
        assert!(d.contains("-two") && d.contains("+2") && d.contains("a/f.txt"));
        assert!(unified_diff("same\n", "same\n", "f").is_empty());
    }

    #[test]
    fn extracts_text_docx_and_lists_zip() {
        let dir = std::env::temp_dir().join(format!("nexus-extract-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let txt = dir.join("a.txt");
        std::fs::write(&txt, "hello").unwrap();
        assert_eq!(extract_text(&txt).unwrap(), ("hello".to_string(), "text"));
        let docx = dir.join("d.docx");
        {
            let f = std::fs::File::create(&docx).unwrap();
            let mut z = zip::ZipWriter::new(f);
            z.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
            use std::io::Write;
            z.write_all(b"<w:document><w:body><w:p><w:r><w:t>Bonjour &amp; salut</w:t></w:r></w:p><w:p><w:r><w:t>Ligne 2</w:t></w:r></w:p></w:body></w:document>").unwrap();
            z.finish().unwrap();
        }
        let (t, k) = extract_text(&docx).unwrap();
        assert_eq!(k, "docx");
        assert!(t.contains("Bonjour & salut") && t.contains("Ligne 2"));
        let zipf = dir.join("z.zip");
        std::fs::copy(&docx, &zipf).unwrap();
        let (l, k) = extract_text(&zipf).unwrap();
        assert_eq!(k, "zip");
        assert!(l.contains("word/document.xml"));
        let bin = dir.join("b.dat");
        std::fs::write(&bin, [0u8, 1, 2, 0]).unwrap();
        assert!(extract_text(&bin).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_dangerous_syntax() {
        assert!(check_syntax(Path::new(r"\\server\share\x")).is_err());
        assert!(check_syntax(Path::new(r"\\?\C:\Windows")).is_err());
        assert!(check_syntax(Path::new(r"C:\a\file.txt:hidden")).is_err());
        assert!(check_syntax(Path::new(r"C:\a\CON.txt")).is_err());
        assert!(check_syntax(Path::new(r"C:\Users\me\notes.txt")).is_ok());
    }

    #[test]
    fn normalizes_parent_components() {
        assert_eq!(lexical_normalize(Path::new(r"C:\a\b\..\c")).unwrap(), PathBuf::from(r"C:\a\c"));
        assert!(lexical_normalize(Path::new(r"C:\..\..")).is_err());
    }

    #[test]
    fn containment_is_component_based_and_case_insensitive() {
        assert!(is_within(Path::new(r"C:\Users\Me\Work\a.txt"), Path::new(r"c:\users\me\work")));
        assert!(!is_within(Path::new(r"C:\Users\Me\Work2\a.txt"), Path::new(r"C:\Users\Me\Work")));
        assert!(is_within(Path::new(r"C:\Users\Me\Work"), Path::new(r"C:\Users\Me\Work\")));
    }
}
