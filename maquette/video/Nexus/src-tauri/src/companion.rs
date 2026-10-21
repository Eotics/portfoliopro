//! NEXUS Companion: a small always-available desktop window that is only another
//! front-end to the same backend (same agent, tools, permissions, STOP, logs).
//! This module owns the real window behaviour, the file inbox, drafts and
//! integration status checks.

use crate::db::now;
use crate::settings::{self, Settings};
use crate::state::{Activity, Nexus};
use crate::tools::fs as nfs;
use crate::win::apps;
use anyhow::{anyhow, bail, Context, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

type S<'a> = State<'a, Arc<Nexus>>;
type R<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    format!("{err:#}")
}

pub const LABEL: &str = "companion";

/// Quick actions the user may pin to the Companion toolbar.
pub const QUICK_ACTIONS: &[&str] = &["home", "chat", "task", "files", "control", "settings", "search", "app", "calendar", "composer", "stop"];

fn window(app: &AppHandle) -> R<WebviewWindow> {
    app.get_webview_window(LABEL).ok_or_else(|| "Companion window is not available".to_string())
}

fn size_for(mode: &str) -> (f64, f64) {
    match mode {
        "bar" => (452.0, 66.0),
        // Only the creature (transparent window), floating on the desktop.
        "pet" => (240.0, 270.0),
        "expanded" => (880.0, 660.0),
        _ => (452.0, 440.0),
    }
}

/// Keep the window fully on its current monitor after a resize.
fn clamp_to_monitor(w: &WebviewWindow) {
    let (Ok(Some(m)), Ok(pos), Ok(size)) = (w.current_monitor(), w.outer_position(), w.outer_size()) else { return };
    let (mx, my) = (m.position().x, m.position().y);
    let (mw, mh) = (m.size().width as i32, m.size().height as i32);
    let x = pos.x.clamp(mx, (mx + mw - size.width as i32).max(mx));
    let y = pos.y.clamp(my, (my + mh - size.height as i32).max(my));
    if x != pos.x || y != pos.y {
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }
}

fn default_position(w: &WebviewWindow) -> Option<PhysicalPosition<i32>> {
    let m = w.primary_monitor().ok()??;
    let sf = m.scale_factor();
    let (cw, ch) = size_for("compact");
    let x = m.position().x + m.size().width as i32 - ((cw + 24.0) * sf) as i32;
    let y = m.position().y + m.size().height as i32 - ((ch + 72.0) * sf) as i32;
    Some(PhysicalPosition::new(x, y))
}

/// Applied at startup and whenever settings are saved.
pub fn apply_settings(nx: &Nexus, s: &Settings, startup: bool) {
    let Some(w) = nx.app.get_webview_window(LABEL) else { return };
    let _ = w.set_always_on_top(s.companion_always_on_top);
    if startup {
        let _ = w.set_size(LogicalSize::new(size_for("compact").0, size_for("compact").1));
        let pos = s.companion_position.map(|(x, y)| PhysicalPosition::new(x, y)).or_else(|| default_position(&w));
        if let Some(p) = pos {
            let _ = w.set_position(p);
            clamp_to_monitor(&w);
        }
        if s.companion_enabled && s.companion_show_on_start {
            let _ = w.show();
        }
    }
    if !s.companion_enabled {
        let _ = w.hide();
    }
    register_shortcut(nx, s);
}

fn register_shortcut(nx: &Nexus, s: &Settings) {
    register_voice_shortcut(nx, s);
    let gs = nx.app.global_shortcut();
    if let Some(old) = nx.companion_shortcut.lock().unwrap().take() {
        let _ = gs.unregister(old);
    }
    if !s.companion_enabled || s.companion_shortcut.is_empty() || s.companion_shortcut == "off" {
        return;
    }
    match s.companion_shortcut.parse::<Shortcut>() {
        Ok(sc) => match gs.register(sc) {
            Ok(()) => *nx.companion_shortcut.lock().unwrap() = Some(sc),
            Err(err) => nx.log(Activity { kind: "system".into(), action: format!("Companion shortcut {} could not be registered (already used?)", s.companion_shortcut), status: "error".into(), error: Some(err.to_string()), ..Default::default() }),
        },
        Err(err) => nx.log(Activity { kind: "system".into(), action: format!("Invalid Companion shortcut {}", s.companion_shortcut), status: "error".into(), error: Some(err.to_string()), ..Default::default() }),
    }
}

/// Push-to-talk: registered only while voice is enabled by the user.
fn register_voice_shortcut(nx: &Nexus, s: &Settings) {
    let gs = nx.app.global_shortcut();
    if let Some(old) = nx.voice_shortcut.lock().unwrap().take() {
        let _ = gs.unregister(old);
    }
    if !s.voice_enabled || s.voice_shortcut.is_empty() || s.voice_shortcut == "off" {
        return;
    }
    match s.voice_shortcut.parse::<Shortcut>() {
        Ok(sc) => match gs.register(sc) {
            Ok(()) => *nx.voice_shortcut.lock().unwrap() = Some(sc),
            Err(err) => nx.log(Activity { kind: "system".into(), action: format!("Voice shortcut {} could not be registered (already used?)", s.voice_shortcut), status: "error".into(), error: Some(err.to_string()), ..Default::default() }),
        },
        Err(err) => nx.log(Activity { kind: "system".into(), action: format!("Invalid voice shortcut {}", s.voice_shortcut), status: "error".into(), error: Some(err.to_string()), ..Default::default() }),
    }
}

pub fn toggle(app: &AppHandle) {
    if let Ok(w) = window(app) {
        let enabled = app.try_state::<Arc<Nexus>>().map(|nx| nx.settings().companion_enabled).unwrap_or(true);
        // A minimized Companion counts as hidden: it has no taskbar button to restore it from.
        let shown = w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false);
        if shown {
            let _ = w.hide();
        } else if enabled {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
    refresh_tray(app);
}

fn refresh_tray(app: &AppHandle) {
    if let Some(nx) = app.try_state::<Arc<Nexus>>() {
        crate::tray::refresh(&nx);
    }
}

/// Persist the Companion position while it is dragged (throttled).
pub fn on_moved(nx: &Nexus, x: i32, y: i32) {
    let mut last = nx.last_pos_save.lock().unwrap();
    if last.elapsed().as_millis() < 400 {
        return;
    }
    *last = std::time::Instant::now();
    let mut s = nx.settings.write().unwrap();
    s.companion_position = Some((x, y));
    let _ = settings::save(&nx.db, &s);
}

// ---------- start with Windows ----------

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

pub fn startup_registered() -> bool {
    winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey(RUN_KEY)
        .and_then(|k| k.get_value::<String, _>("NEXUS"))
        .is_ok()
}

/// Only called when the user explicitly changes the setting.
pub fn set_startup(enable: bool) -> Result<()> {
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(RUN_KEY)?;
    if enable {
        let exe = std::env::current_exe()?;
        // --autostart: start quietly (tray + Companion), see lib.rs.
        key.set_value("NEXUS", &format!("\"{}\" --autostart", exe.display()))?;
    } else {
        let _ = key.delete_value("NEXUS");
    }
    Ok(())
}

// ---------- window commands ----------

/// Shows the Companion without stealing focus from the user's current app.
pub fn reveal(app: &AppHandle) {
    if let Ok(w) = window(app) {
        let _ = w.unminimize();
        let _ = w.show();
    }
    refresh_tray(app);
}

#[tauri::command]
pub fn companion_show(app: AppHandle) -> R<()> {
    let w = window(&app)?;
    let _ = w.unminimize();
    w.show().map_err(e)?;
    refresh_tray(&app);
    w.set_focus().map_err(e)
}

/// The installed NEXUS keeps the "start with Windows" entry pointing at itself
/// (e.g. after an update or when it was first enabled from a dev build).
pub fn sync_startup_entry(s: &Settings) {
    if cfg!(debug_assertions) || !s.start_with_windows {
        return;
    }
    let _ = set_startup(true);
}

#[tauri::command]
pub fn companion_hide(nx: S) -> R<()> {
    hide_window(&nx);
    Ok(())
}

/// Hides the Companion, remembering where it was.
pub fn hide_window(nx: &Nexus) {
    let Ok(w) = window(&nx.app) else { return };
    if let Ok(p) = w.outer_position() {
        let mut s = nx.settings.write().unwrap();
        s.companion_position = Some((p.x, p.y));
        let _ = settings::save(&nx.db, &s);
    }
    let _ = w.hide();
    crate::tray::refresh(nx);
}

#[tauri::command]
pub fn companion_toggle(app: AppHandle) {
    toggle(&app);
}

#[tauri::command]
pub fn companion_minimize(app: AppHandle) -> R<()> {
    window(&app)?.minimize().map_err(e)
}

#[tauri::command]
pub fn companion_resize(app: AppHandle, mode: String, scale: Option<f64>) -> R<()> {
    let w = window(&app)?;
    let (cw, ch) = size_for(&mode);
    // The pet window follows the creature's size (small / medium / large).
    let k = if mode == "pet" { scale.unwrap_or(1.0).clamp(0.6, 1.6) } else { 1.0 };
    let (cw, ch) = (cw * k, ch * k);
    // Grow upwards/leftwards from the bottom-right anchor so it stays near where the user put it.
    if let (Ok(pos), Ok(old), Ok(sf)) = (w.outer_position(), w.outer_size(), w.scale_factor()) {
        let nw = (cw * sf) as i32;
        let nh = (ch * sf) as i32;
        let x = pos.x + old.width as i32 - nw;
        let y = pos.y + old.height as i32 - nh;
        w.set_size(LogicalSize::new(cw, ch)).map_err(e)?;
        let _ = w.set_position(PhysicalPosition::new(x, y));
    } else {
        w.set_size(LogicalSize::new(cw, ch)).map_err(e)?;
    }
    clamp_to_monitor(&w);
    Ok(())
}

/// Mouse position relative to the Companion window centre, in logical pixels
/// (lets the pet look at the cursor anywhere on the desktop). Read-only.
#[tauri::command]
pub fn companion_cursor(app: AppHandle) -> R<Option<(f64, f64)>> {
    let w = window(&app)?;
    if !w.is_visible().unwrap_or(false) {
        return Ok(None);
    }
    let (Ok(c), Ok(pos), Ok(size), Ok(sf)) = (app.cursor_position(), w.outer_position(), w.outer_size(), w.scale_factor()) else { return Ok(None) };
    let cx = pos.x as f64 + size.width as f64 / 2.0;
    let cy = pos.y as f64 + size.height as f64 / 2.0;
    Ok(Some(((c.x - cx) / sf, (c.y - cy) / sf)))
}

/// Really exits NEXUS (all windows, tray, background work).
#[tauri::command]
pub fn app_quit(app: AppHandle, nx: S) {
    crate::tray::quit(&app, &nx, "Companion menu");
}

#[tauri::command]
pub fn show_main(app: AppHandle, page: Option<String>, arg: Option<String>) -> R<()> {
    let w = app.get_webview_window("main").ok_or("Main window is not available")?;
    let _ = w.unminimize();
    w.show().map_err(e)?;
    w.set_focus().map_err(e)?;
    if let Some(p) = page {
        // Broadcast: the frontend's `listen` receives app-wide events; the Companion ignores page changes.
        app.emit("nexus://navigate", json!({"page": p, "arg": arg})).map_err(e)?;
    }
    Ok(())
}

#[tauri::command]
pub fn startup_status() -> bool {
    startup_registered()
}

// ---------- file inbox ----------

const BLOCKED_EXT: &[&str] = &[
    "exe", "msi", "msix", "appx", "bat", "cmd", "com", "scr", "dll", "sys", "lnk", "url", "vbs", "vbe", "wsf", "wsh", "jar",
    "hta", "cpl", "msc", "reg", "iso", "img", "vhd", "vhdx",
];
const TEXT_EXT: &[&str] = &[
    "txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf", "log", "html", "htm", "rtf",
    "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "java", "kt", "c", "h", "cpp", "hpp", "cc", "cs", "go", "rb", "php", "swift",
    "sql", "sh", "ps1", "psm1", "css", "scss", "less", "lua", "dart", "vue", "svelte", "r", "m", "scala", "gradle", "env.example",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxFile {
    pub name: String,
    pub path: String,
    pub category: String,
    pub size: u64,
    pub added: Option<String>,
}

pub fn category(p: &Path) -> Result<&'static str> {
    let ext = nfs::ext_of(p);
    if BLOCKED_EXT.contains(&ext.as_str()) {
        bail!("'.{ext}' files are executables or shortcuts and are never accepted");
    }
    Ok(match ext.as_str() {
        "pdf" => "pdf",
        "docx" => "document",
        "zip" => "archive",
        x if nfs::IMAGE_EXT.contains(&x) => "image",
        x if TEXT_EXT.contains(&x) => match x {
            "txt" | "md" | "markdown" | "csv" | "tsv" | "log" | "rtf" | "html" | "htm" => "text",
            "json" | "xml" | "yaml" | "yml" | "toml" | "ini" | "cfg" | "conf" => "data",
            _ => "code",
        },
        "7z" | "rar" | "tar" | "gz" => bail!("'.{ext}' archives are not supported (only .zip can be listed)"),
        "doc" | "xls" | "xlsx" | "ppt" | "pptx" | "odt" => bail!("'.{ext}' documents are not supported yet (PDF, DOCX and text are)"),
        _ => bail!("Unsupported file type '.{ext}'"),
    })
}

fn inbox_dir(nx: &Nexus) -> Result<PathBuf> {
    let ws = nfs::workspaces(nx);
    let first = ws.first().ok_or_else(|| anyhow!("No authorized folder is configured"))?;
    let d = PathBuf::from(&first.path).join("Inbox");
    std::fs::create_dir_all(&d)?;
    Ok(d)
}

fn import_one(nx: &Nexus, inbox: &Path, src: &str) -> Result<InboxFile> {
    let p = PathBuf::from(src);
    if !p.is_absolute() || src.starts_with(r"\\") {
        bail!("Only local files can be added");
    }
    let md = std::fs::symlink_metadata(&p).with_context(|| format!("{src} does not exist"))?;
    if md.is_dir() {
        bail!("Folders cannot be dropped; drop files");
    }
    if !md.is_file() {
        bail!("Not a regular file");
    }
    let cat = category(&p)?;
    let max = if cat == "image" { 20 } else { 50 } * 1024 * 1024;
    if md.len() > max {
        bail!("File is {} MB; the limit is {} MB", md.len() / 1_048_576, max / 1_048_576);
    }
    if let Some(why) = nfs::protected(nx, &p) {
        bail!("{why}");
    }
    let name = p.file_name().ok_or_else(|| anyhow!("invalid name"))?.to_string_lossy().to_string();
    let mut dest = inbox.join(&name);
    let mut i = 1;
    while dest.exists() {
        let stem = p.file_stem().unwrap_or_default().to_string_lossy();
        let ext = nfs::ext_of(&p);
        dest = inbox.join(format!("{stem} ({i}).{ext}"));
        i += 1;
    }
    // Copy only: nothing is opened or executed.
    std::fs::copy(&p, &dest)?;
    if std::fs::metadata(&dest)?.len() != md.len() {
        bail!("Copy verification failed");
    }
    Ok(InboxFile { name: dest.file_name().unwrap().to_string_lossy().to_string(), path: dest.display().to_string(), category: cat.into(), size: md.len(), added: Some(now()) })
}

#[tauri::command]
pub fn import_files(nx: S, paths: Vec<String>) -> R<Vec<Value>> {
    let inbox = inbox_dir(&nx).map_err(e)?;
    let mut out = Vec::new();
    for p in paths.iter().take(50) {
        match import_one(&nx, &inbox, p) {
            Ok(f) => {
                nx.log(Activity { kind: "manual".into(), action: format!("File added to Inbox: {}", f.name), status: "ok".into(), result: Some(f.path.clone()), ..Default::default() });
                out.push(json!({"ok": true, "file": f}));
            }
            Err(err) => {
                let name = Path::new(p).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or(p.clone());
                nx.log(Activity { kind: "manual".into(), action: format!("File rejected: {name}"), status: "error".into(), error: Some(err.to_string()), ..Default::default() });
                out.push(json!({"ok": false, "name": name, "error": err.to_string()}));
            }
        }
    }
    nx.emit("nexus://inbox", json!({}));
    Ok(out)
}

#[tauri::command]
pub fn list_inbox(nx: S) -> R<Vec<InboxFile>> {
    let d = inbox_dir(&nx).map_err(e)?;
    let mut v: Vec<InboxFile> = std::fs::read_dir(&d)
        .map_err(e)?
        .flatten()
        .filter(|en| en.path().is_file())
        .map(|en| {
            let p = en.path();
            let md = en.metadata().ok();
            InboxFile {
                name: en.file_name().to_string_lossy().to_string(),
                category: category(&p).unwrap_or("unsupported").to_string(),
                size: md.as_ref().map(|m| m.len()).unwrap_or(0),
                added: md.and_then(|m| m.modified().ok()).map(|t| chrono::DateTime::<chrono::Local>::from(t).to_rfc3339()),
                path: p.display().to_string(),
            }
        })
        .collect();
    v.sort_by(|a, b| b.added.cmp(&a.added));
    Ok(v)
}

fn inside_path(nx: &Nexus, path: &str) -> R<PathBuf> {
    let r = nfs::resolve(nx, Some(path)).map_err(e)?;
    if !r.inside {
        return Err("This file is outside your authorized folders".into());
    }
    if let Some(why) = nfs::protected(nx, &r.path) {
        return Err(why);
    }
    Ok(r.path)
}

#[tauri::command]
pub fn remove_inbox_file(nx: S, path: String) -> R<()> {
    let p = inside_path(&nx, &path)?;
    let inbox = inbox_dir(&nx).map_err(e)?;
    if p.parent().map(|d| d != inbox).unwrap_or(true) {
        return Err("Only Inbox files can be removed here".into());
    }
    trash::delete(&p).map_err(e)?;
    nx.log(Activity { kind: "manual".into(), action: format!("Inbox file moved to Recycle Bin: {}", p.display()), status: "ok".into(), ..Default::default() });
    nx.emit("nexus://inbox", json!({}));
    Ok(())
}

/// "Extract text" action: real extraction, shown to the user (no AI involved).
#[tauri::command]
pub async fn extract_file_text(nx: S<'_>, path: String) -> R<Value> {
    let p = inside_path(&nx, &path)?;
    let (text, kind) = tokio::task::spawn_blocking(move || nfs::extract_text(&p)).await.map_err(e)?.map_err(e)?;
    let total = text.chars().count();
    Ok(json!({"kind": kind, "text": text.chars().take(200_000).collect::<String>(), "totalChars": total, "truncated": total > 200_000}))
}

#[tauri::command]
pub fn add_file_to_project(nx: S, project_id: String, path: String) -> R<()> {
    let p = inside_path(&nx, &path)?;
    let n: i64 = nx.db.with(|c| c.query_row("SELECT COUNT(*) FROM projects WHERE id=?1", [&project_id], |r| r.get(0))).map_err(e)?;
    if n == 0 {
        return Err("Unknown project".into());
    }
    nx.db
        .with(|c| c.execute("INSERT INTO project_files(project_id,path,added_at) VALUES(?1,?2,?3)", rusqlite::params![project_id, p.display().to_string(), now()]))
        .map_err(e)?;
    nx.log(Activity { kind: "manual".into(), action: format!("File attached to project: {}", p.display()), status: "ok".into(), ..Default::default() });
    Ok(())
}

#[tauri::command]
pub fn list_project_files(nx: S, project_id: String) -> R<Vec<Value>> {
    nx.db
        .with(|c| {
            let mut st = c.prepare("SELECT id,path,added_at FROM project_files WHERE project_id=?1 ORDER BY id DESC")?;
            let r = st.query_map([&project_id], |r| {
                let path: String = r.get(1)?;
                Ok(json!({"id": r.get::<_, i64>(0)?, "exists": Path::new(&path).exists(), "path": path, "addedAt": r.get::<_, String>(2)?}))
            })?;
            r.collect()
        })
        .map_err(e)
}

// ---------- composer ----------

#[tauri::command]
pub fn validate_attachments(nx: S, paths: Vec<String>) -> Vec<Value> {
    paths
        .iter()
        .map(|p| match inside_path(&nx, p) {
            Ok(pb) => match std::fs::metadata(&pb) {
                Ok(m) if m.is_file() => json!({"path": pb.display().to_string(), "ok": true, "size": m.len()}),
                Ok(_) => json!({"path": p, "ok": false, "error": "Not a file"}),
                Err(_) => json!({"path": p, "ok": false, "error": "File does not exist"}),
            },
            Err(err) => json!({"path": p, "ok": false, "error": err}),
        })
        .collect()
}

fn slug(s: &str) -> String {
    let t: String = s.chars().map(|c| if c.is_alphanumeric() { c } else { '-' }).collect();
    let t = t.trim_matches('-').chars().take(40).collect::<String>();
    if t.is_empty() { "draft".into() } else { t }
}

/// Saves a draft locally as a text file in <workspace>\Drafts. Nothing is sent.
#[tauri::command]
pub fn save_draft(nx: S, kind: String, to: String, subject: String, body: String, attachments: Vec<String>) -> R<String> {
    let ws = nfs::workspaces(&nx);
    let first = ws.first().ok_or("No authorized folder is configured")?;
    let dir = PathBuf::from(&first.path).join("Drafts");
    std::fs::create_dir_all(&dir).map_err(e)?;
    let path = dir.join(format!("{}-{}.txt", chrono::Local::now().format("%Y%m%d-%H%M%S"), slug(&subject)));
    let mut text = String::new();
    if kind == "email" {
        text.push_str(&format!("To: {to}\nSubject: {subject}\n"));
        if !attachments.is_empty() {
            text.push_str(&format!("Attachments: {}\n", attachments.join("; ")));
        }
        text.push('\n');
    } else if !subject.is_empty() {
        text.push_str(&format!("# {subject}\n\n"));
    }
    text.push_str(&body);
    std::fs::write(&path, &text).map_err(e)?;
    if std::fs::read_to_string(&path).map_err(e)? != text {
        return Err("Draft could not be verified after saving".into());
    }
    nx.log(Activity { kind: "manual".into(), action: format!("Draft saved: {}", path.display()), status: "ok".into(), ..Default::default() });
    Ok(path.display().to_string())
}

pub fn valid_email(s: &str) -> bool {
    let re = regex::Regex::new(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$").unwrap();
    !s.is_empty() && s.split([',', ';']).map(str::trim).all(|a| re.is_match(a))
}

/// Hands the draft to the user's own mail app (mailto:). NEXUS does not send it.
#[tauri::command]
pub fn open_in_mail_client(nx: S, to: String, subject: String, body: String) -> R<()> {
    if !valid_email(&to) {
        return Err("Recipient is not a valid e-mail address".into());
    }
    let enc = |s: &str| url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>().replace('+', "%20");
    let url = format!("mailto:{}?subject={}&body={}", to.replace(' ', ""), enc(&subject), enc(&body));
    if url.len() > 2000 {
        return Err("The message is too long for a mail-app hand-off; copy it or save the draft instead".into());
    }
    apps::shell_open(&url, None).map_err(e)?;
    nx.log(Activity { kind: "manual".into(), action: format!("Draft opened in the default mail app for {to} (not sent by NEXUS)"), status: "ok".into(), ..Default::default() });
    Ok(())
}

/// One AI call without tools: drafting only, the user edits before anything happens.
#[tauri::command]
pub async fn ai_draft(nx: S<'_>, kind: String, instruction: String, to: String, subject: String, body: String) -> R<Value> {
    let p = crate::agent::provider::Provider::from_settings(&nx.settings()).map_err(e)?;
    let lang = if nx.settings().language == "en" { "English" } else { "French" };
    let system = format!(
        "You draft {} for the user. Write in {lang} unless the instruction says otherwise. Output format: first line 'Subject: <subject>' (or 'Title: <title>' for documents), then a blank line, then the body only. No commentary.",
        if kind == "email" { "e-mails" } else { "documents" }
    );
    let prompt = format!("Instruction: {instruction}\nRecipient: {to}\nCurrent subject: {subject}\nCurrent draft:\n{body}");
    let msgs = vec![json!({"role": "user", "content": prompt})];
    let mut sink = |_d: crate::agent::provider::Delta| {};
    let r = p
        .chat(&nx.http, crate::agent::provider::ChatRequest { system: &system, messages: &msgs, tools: &[] }, &nx.control.token(), &mut sink)
        .await
        .map_err(e)?;
    let text: String = r.content.iter().filter_map(|b| b["text"].as_str()).collect();
    let (first, rest) = text.trim().split_once('\n').unwrap_or((text.trim(), ""));
    let (subj, body) = match first.split_once(':') {
        Some((k, v)) if ["subject", "title", "objet", "titre"].contains(&k.trim().to_lowercase().as_str()) => (v.trim().to_string(), rest.trim().to_string()),
        _ => (subject, text.trim().to_string()),
    };
    nx.log(Activity { kind: "agent".into(), action: format!("NEXUS drafted {} (not sent)", if kind == "email" { "an e-mail" } else { "a document" }), status: "ok".into(), result: Some(r.model), ..Default::default() });
    Ok(json!({"subject": subj, "body": body}))
}

// ---------- integrations ----------

fn tool_version(prog: &str, args: &[&str]) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let o = std::process::Command::new(prog).args(args).creation_flags(0x0800_0000).output().ok()?;
    if !o.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&o.stdout).to_string() + &String::from_utf8_lossy(&o.stderr);
    s.lines().next().map(|l| l.trim().to_string())
}

/// Real status checks only. A card never says "connected" unless a check passed.
#[tauri::command]
pub async fn integrations_status(nx: S<'_>) -> R<Vec<Value>> {
    let ai_key = crate::secrets::has("anthropic_api_key");
    let ai_test = nx.ai_test.lock().unwrap().clone();
    let model = nx.settings().anthropic_model;
    let checks = tokio::task::spawn_blocking(|| {
        let gh = tool_version("gh", &["--version"]);
        let gh_auth = gh.as_ref().map(|_| {
            use std::os::windows::process::CommandExt;
            std::process::Command::new("gh").args(["auth", "status"]).creation_flags(0x0800_0000).output().map(|o| o.status.success()).unwrap_or(false)
        });
        let tools: Vec<(&str, Option<String>)> = vec![
            ("Git", tool_version("git", &["--version"])),
            ("Node.js", tool_version("node", &["--version"])),
            ("Rust / Cargo", tool_version("cargo", &["--version"])),
            ("Python", tool_version("python", &["--version"])),
        ];
        (gh, gh_auth, tools)
    })
    .await
    .map_err(e)?;
    let (gh, gh_auth, tools) = checks;

    let ai_status = match (&ai_key, &ai_test) {
        (false, _) => ("not_configured", "No API key".to_string()),
        (true, Some(t)) if t["ok"] == true => ("connected", format!("Verified {}", t["at"].as_str().unwrap_or(""))),
        (true, Some(t)) => ("error", t["error"].as_str().unwrap_or("Last test failed").to_string()),
        (true, None) => ("disconnected", "Key stored, connection not tested in this session".to_string()),
    };
    let mut cards = vec![
        json!({"id": "anthropic", "name": "Anthropic (Claude)", "status": ai_status.0, "detail": ai_status.1, "model": model,
               "actions": ["test"], "implemented": true}),
        json!({"id": "microsoft_calendar", "name": "Microsoft Calendar", "status": "not_configured",
               "detail": "Not implemented yet (phase 8): needs a Microsoft Entra app registration", "actions": [], "implemented": false}),
        json!({"id": "email", "name": "E-mail (send)", "status": "not_configured",
               "detail": "No e-mail integration exists yet. Drafts can be copied, saved, or handed to your mail app.", "actions": [], "implemented": false}),
        json!({"id": "github", "name": "GitHub", "status": match (&gh, gh_auth) { (None, _) => "not_configured", (Some(_), Some(true)) => "connected", _ => "auth_required" },
               "detail": match (&gh, gh_auth) {
                   (None, _) => "GitHub CLI (gh) is not installed. NEXUS has no GitHub actions yet.".to_string(),
                   (Some(v), Some(true)) => format!("{v} — signed in. NEXUS has no GitHub actions yet (read-only status)."),
                   (Some(v), _) => format!("{v} — not signed in (run `gh auth login`). NEXUS has no GitHub actions yet."),
               }, "actions": [], "implemented": false}),
    ];
    for (name, v) in tools {
        cards.push(json!({"id": format!("local:{name}"), "name": name, "status": if v.is_some() { "connected" } else { "not_configured" },
            "detail": v.unwrap_or_else(|| "Not found on PATH".into()), "actions": [], "implemented": true, "local": true}));
    }
    Ok(cards)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categorises_and_blocks_executables() {
        assert_eq!(category(Path::new("a.pdf")).unwrap(), "pdf");
        assert_eq!(category(Path::new("a.PNG")).unwrap(), "image");
        assert_eq!(category(Path::new("main.rs")).unwrap(), "code");
        assert_eq!(category(Path::new("notes.md")).unwrap(), "text");
        assert_eq!(category(Path::new("a.zip")).unwrap(), "archive");
        assert!(category(Path::new("setup.exe")).is_err());
        assert!(category(Path::new("x.lnk")).is_err());
        assert!(category(Path::new("run.bat")).is_err());
        assert!(category(Path::new("a.rar")).is_err());
        assert!(category(Path::new("noext")).is_err());
    }

    #[test]
    fn email_validation() {
        assert!(valid_email("a@b.fr"));
        assert!(valid_email("a@b.fr; c.d@e.com"));
        assert!(!valid_email("nope"));
        assert!(!valid_email(""));
        assert!(!valid_email("a@b"));
    }

    #[test]
    fn slugs_are_safe_file_names() {
        assert_eq!(slug("Réunion: projet/NEXUS?"), "Réunion--projet-NEXUS");
        assert_eq!(slug("///"), "draft");
    }
}
