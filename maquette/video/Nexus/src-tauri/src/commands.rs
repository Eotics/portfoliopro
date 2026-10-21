//! Tauri commands: the frontend's only way into the backend.
//! Manual-control commands are the *user* acting, so they bypass the AI
//! permission pipeline but are still logged (mouse moves excepted).

use crate::agent;
use crate::control::AgentStatus;
use crate::db::now;
use crate::permissions::{self, AppStatus, ScopeStatus, SCOPES};
use crate::secrets;
use crate::settings::{self, Mode, Settings};
use crate::state::{Activity, ApprovalChoice, ApprovalRequest, Nexus};
use crate::tools::{self, desktop, fs as nfs, nexus as nmem};
use crate::win::{apps, capture, input, system, windows as winwin};
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::State;

type S<'a> = State<'a, Arc<Nexus>>;
type R<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    format!("{err:#}")
}

fn log_manual(nx: &Nexus, action: String) {
    nx.log(Activity { kind: "manual".into(), action, status: "ok".into(), permission: Some("user".into()), ..Default::default() });
}

// ---------- state / control ----------

#[tauri::command]
pub fn get_state(nx: S) -> Value {
    let s = nx.settings();
    json!({
        "status": nx.control.status(),
        "mode": nx.control.mode(),
        "stopped": nx.control.is_stopped(),
        "agentRunning": nx.agent_running.load(Ordering::SeqCst),
        "provider": s.ai_provider,
        "model": s.anthropic_model,
        "aiConfigured": secrets::has(if s.ai_provider == "openai" { "openai_api_key" } else { "anthropic_api_key" }),
        "pendingApprovals": nx.approvals.lock().unwrap().len(),
    })
}

pub fn do_stop(nx: &Nexus, source: &str) {
    let transitioned = nx.control.stop();
    // Deny everything waiting on the user; dropping the senders resolves them as Deny.
    let pending: Vec<_> = nx.approvals.lock().unwrap().drain().collect();
    for (_, (_req, tx)) in pending {
        let _ = tx.send(ApprovalChoice::Deny);
    }
    input::release_modifiers();
    crate::voice::cancel(nx);
    nx.emit("nexus://voice", json!({"type": "stop-speaking"}));
    *nx.highlight.lock().unwrap() = None;
    nx.emit("nexus://highlight", Value::Null);
    nx.control.set_status(AgentStatus::Stopped);
    nx.emit("nexus://status", AgentStatus::Stopped);
    let _ = nx.db.with(|c| {
        c.execute("UPDATE tasks SET status='CANCELLED', updated_at=?1 WHERE status IN ('RUNNING','WAITING_PERMISSION','PLANNED')", [now()])
    });
    nx.emit("nexus://tasks", json!({}));
    if transitioned {
        nx.log(Activity { kind: "stop".into(), action: format!("STOP NEXUS activated ({source})"), status: "ok".into(), result: Some("Automation halted; pending approvals denied; input released".into()), ..Default::default() });
    }
}

#[tauri::command]
pub fn stop_nexus(nx: S) {
    do_stop(&nx, "button");
}

#[tauri::command]
pub fn rearm_nexus(nx: S) {
    do_rearm(&nx);
}

pub fn do_rearm(nx: &Nexus) {
    nx.control.rearm();
    nx.control.set_status(AgentStatus::Idle);
    nx.emit("nexus://status", AgentStatus::Idle);
    nx.log(Activity { kind: "stop".into(), action: "NEXUS re-armed by the user".into(), status: "ok".into(), ..Default::default() });
}

#[tauri::command]
pub fn set_mode(nx: S, mode: Mode) {
    nx.control.set_mode(mode);
    nx.emit("nexus://mode", mode);
    nx.log(Activity { kind: "system".into(), action: format!("Control mode set to {mode:?}"), status: "ok".into(), ..Default::default() });
}

// ---------- approvals ----------

#[tauri::command]
pub fn list_approvals(nx: S) -> Vec<ApprovalRequest> {
    nx.approvals.lock().unwrap().values().map(|(r, _)| r.clone()).collect()
}

#[tauri::command]
pub fn resolve_approval(nx: S, id: String, choice: ApprovalChoice) -> R<()> {
    let entry = nx.approvals.lock().unwrap().remove(&id);
    let (req, tx) = entry.ok_or("This approval request is no longer pending")?;
    if choice == ApprovalChoice::Always && !req.allow_always {
        let _ = tx.send(ApprovalChoice::Once);
        return Ok(());
    }
    tx.send(choice).map_err(|_| "The task waiting for this approval has ended".to_string())
}

// ---------- chat ----------

#[tauri::command]
pub async fn send_message(nx: S<'_>, conversation_id: Option<String>, text: String, voice: Option<bool>) -> R<String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Message is empty".into());
    }
    if nx.agent_running.load(Ordering::SeqCst) {
        return Err("NEXUS is already working on a request. Wait or press STOP NEXUS.".into());
    }
    if nx.control.is_stopped() {
        // A new explicit request from the user re-arms NEXUS.
        nx.control.rearm();
        nx.log(Activity { kind: "stop".into(), action: "NEXUS re-armed by a new user request".into(), status: "ok".into(), ..Default::default() });
    }
    let conv = match conversation_id {
        Some(c) => c,
        None => agent::create_conversation(&nx, &text).map_err(e)?,
    };
    let nx2 = nx.inner().clone();
    let c2 = conv.clone();
    tauri::async_runtime::spawn(async move {
        let _ = agent::run(nx2, c2, text, voice.unwrap_or(false)).await;
    });
    Ok(conv)
}

#[tauri::command]
pub fn list_conversations(nx: S) -> R<Vec<Value>> {
    nx.db
        .with(|c| {
            let mut st = c.prepare("SELECT id,title,created_at,updated_at FROM conversations ORDER BY updated_at DESC LIMIT 200")?;
            let r = st.query_map([], |r| Ok(json!({"id": r.get::<_, String>(0)?, "title": r.get::<_, String>(1)?, "createdAt": r.get::<_, String>(2)?, "updatedAt": r.get::<_, String>(3)?})))?;
            r.collect()
        })
        .map_err(e)
}

#[tauri::command]
pub fn get_conversation(nx: S, id: String) -> R<Value> {
    let messages: Vec<Value> = nx
        .db
        .with(|c| {
            let mut st = c.prepare("SELECT role,content,created_at FROM messages WHERE conversation_id=?1 ORDER BY id")?;
            let r = st.query_map([&id], |r| {
                let content: String = r.get(1)?;
                Ok(json!({"role": r.get::<_, String>(0)?, "content": serde_json::from_str::<Value>(&content).unwrap_or(json!([])), "createdAt": r.get::<_, String>(2)?}))
            })?;
            r.collect()
        })
        .map_err(e)?;
    // Strip images and thinking payloads: the UI only needs text + tool references.
    let messages: Vec<Value> = messages
        .into_iter()
        .map(|mut m| {
            if let Some(arr) = m["content"].as_array_mut() {
                arr.retain(|b| b["type"] != "thinking" && b["type"] != "redacted_thinking");
                for b in arr.iter_mut() {
                    if b["type"] == "tool_result" {
                        b["content"] = json!(null);
                    }
                }
            }
            m
        })
        .collect();
    let runs = tool_runs_where(&nx, "conversation_id=?1", &id, 1000)?;
    Ok(json!({"messages": messages, "toolRuns": runs}))
}

#[tauri::command]
pub fn delete_conversation(nx: S, id: String) -> R<()> {
    nx.db.with(|c| c.execute("DELETE FROM conversations WHERE id=?1", [&id])).map_err(e)?;
    Ok(())
}

fn tool_runs_where(nx: &Nexus, clause: &str, arg: &str, limit: i64) -> R<Vec<Value>> {
    let sql = format!(
        "SELECT id,task_id,conversation_id,tool,input,status,risk,permission,decision,summary,result,error,verified,started_at,ended_at,duration_ms
         FROM tool_runs WHERE {clause} ORDER BY started_at DESC LIMIT {limit}"
    );
    nx.db
        .with(|c| {
            let mut st = c.prepare(&sql)?;
            let map = |r: &rusqlite::Row| {
                Ok(json!({
                    "id": r.get::<_, String>(0)?, "taskId": r.get::<_, Option<String>>(1)?, "conversationId": r.get::<_, Option<String>>(2)?,
                    "tool": r.get::<_, String>(3)?, "input": serde_json::from_str::<Value>(&r.get::<_, String>(4)?).unwrap_or(Value::Null),
                    "status": r.get::<_, String>(5)?, "risk": r.get::<_, String>(6)?, "permission": r.get::<_, String>(7)?,
                    "decision": r.get::<_, Option<String>>(8)?, "summary": r.get::<_, Option<String>>(9)?,
                    "result": r.get::<_, Option<String>>(10)?.and_then(|s| serde_json::from_str::<Value>(&s).ok()),
                    "error": r.get::<_, Option<String>>(11)?, "verified": r.get::<_, Option<bool>>(12)?,
                    "startedAt": r.get::<_, String>(13)?, "endedAt": r.get::<_, Option<String>>(14)?, "durationMs": r.get::<_, Option<i64>>(15)?,
                }))
            };
            let rows = if clause == "1=1" { st.query_map([], map)?.collect() } else { st.query_map([arg], map)?.collect() };
            rows
        })
        .map_err(e)
}

#[tauri::command]
pub fn list_tool_runs(nx: S, limit: Option<i64>) -> R<Vec<Value>> {
    tool_runs_where(&nx, "1=1", "", limit.unwrap_or(200).clamp(1, 2000))
}

#[tauri::command]
pub fn list_tools() -> Vec<Value> {
    tools::registry()
        .iter()
        .map(|t| json!({"name": t.name, "description": t.description, "scope": t.scope, "risk": t.risk, "kind": t.kind}))
        .collect()
}

// ---------- screen & manual control ----------

#[tauri::command]
pub fn list_monitors() -> R<Vec<capture::MonitorInfo>> {
    capture::monitors().map_err(e)
}

#[tauri::command]
pub async fn capture_frame(monitor: usize, max_width: Option<u32>, quality: Option<u8>, nx: S<'_>) -> R<capture::Frame> {
    let s = nx.settings();
    let w = max_width.unwrap_or(s.stream_max_width);
    let q = quality.unwrap_or(s.stream_quality);
    tokio::task::spawn_blocking(move || capture::capture(monitor, w, q)).await.map_err(e)?.map_err(e)
}

#[tauri::command]
pub fn screenshot_to_file(nx: S, monitor: usize) -> R<String> {
    let f = capture::capture(monitor, 100_000, 95).map_err(e)?;
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(&f.data).map_err(e)?;
    let dir = dirs_pictures().join("NEXUS");
    std::fs::create_dir_all(&dir).map_err(e)?;
    let path = dir.join(format!("screenshot-{}-monitor{monitor}.jpg", chrono::Local::now().format("%Y%m%d-%H%M%S")));
    std::fs::write(&path, bytes).map_err(e)?;
    log_manual(&nx, format!("Screenshot saved to {}", path.display()));
    Ok(path.display().to_string())
}

fn dirs_pictures() -> std::path::PathBuf {
    std::path::PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default()).join("Pictures")
}

fn point(monitor: usize, fx: f64, fy: f64) -> R<(i32, i32)> {
    let m = capture::monitor_by_index(monitor).map_err(e)?;
    Ok(capture::frame_to_screen(&m, 10_000, 10_000, fx.clamp(0.0, 1.0) * 10_000.0, fy.clamp(0.0, 1.0) * 10_000.0))
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MouseAction {
    Move,
    Click,
    Double,
    Right,
    Middle,
    Down,
    Up,
}

/// fx/fy are 0..1 fractions of the monitor, from the preview. Clicks restore
/// the cursor afterwards so the user's pointer stays over the preview.
#[tauri::command]
pub fn manual_mouse(nx: S, monitor: usize, fx: f64, fy: f64, action: MouseAction) -> R<(i32, i32)> {
    let (x, y) = point(monitor, fx, fy)?;
    let orig = input::cursor_pos().map_err(e)?;
    input::move_to(x, y).map_err(e)?;
    let clicked = match action {
        MouseAction::Move => None,
        MouseAction::Click => Some((input::click(input::Button::Left, 1), "Left click")),
        MouseAction::Double => Some((input::click(input::Button::Left, 2), "Double click")),
        MouseAction::Right => Some((input::click(input::Button::Right, 1), "Right click")),
        MouseAction::Middle => Some((input::click(input::Button::Middle, 1), "Middle click")),
        MouseAction::Down => Some((input::button(input::Button::Left, true), "")),
        MouseAction::Up => Some((input::button(input::Button::Left, false), "")),
    };
    if let Some((r, label)) = clicked {
        r.map_err(e)?;
        if !label.is_empty() {
            std::thread::sleep(std::time::Duration::from_millis(15));
            input::move_to(orig.0, orig.1).map_err(e)?;
            log_manual(&nx, format!("{label} at ({x}, {y}) on monitor {monitor}"));
        }
    }
    Ok((x, y))
}

/// Whole drag gesture in one call (press, interpolate, release), then restore the cursor.
#[tauri::command]
pub async fn manual_drag(nx: S<'_>, monitor: usize, fx1: f64, fy1: f64, fx2: f64, fy2: f64) -> R<()> {
    let a = point(monitor, fx1, fy1)?;
    let b = point(monitor, fx2, fy2)?;
    let orig = input::cursor_pos().map_err(e)?;
    input::drag(a, b, input::Button::Left, &tokio_util::sync::CancellationToken::new()).await.map_err(e)?;
    input::move_to(orig.0, orig.1).map_err(e)?;
    log_manual(&nx, format!("Drag from {a:?} to {b:?} on monitor {monitor}"));
    Ok(())
}

#[tauri::command]
pub fn manual_scroll(monitor: usize, fx: f64, fy: f64, dy: i32, dx: Option<i32>) -> R<()> {
    let (x, y) = point(monitor, fx, fy)?;
    input::move_to(x, y).map_err(e)?;
    input::scroll(dx.unwrap_or(0), dy.clamp(-20, 20)).map_err(e)
}

#[tauri::command]
pub async fn manual_type(nx: S<'_>, text: String) -> R<usize> {
    tokio::task::spawn_blocking(winwin::ensure_external_foreground).await.map_err(e)?;
    let n = input::type_text(&text, &tokio_util::sync::CancellationToken::new()).await.map_err(e)?;
    log_manual(&nx, format!("Typed {n} characters"));
    Ok(n)
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyAction {
    Press,
    Down,
    Up,
}

#[tauri::command]
pub fn manual_key(key: String, action: KeyAction) -> R<()> {
    let vk = input::parse_key(&key).map_err(e)?;
    if !matches!(action, KeyAction::Up) {
        winwin::ensure_external_foreground();
    }
    match action {
        KeyAction::Press => input::press_combo(&[vk]),
        KeyAction::Down => input::key_state(vk, true),
        KeyAction::Up => input::key_state(vk, false),
    }
    .map_err(e)
}

#[tauri::command]
pub fn manual_hotkey(nx: S, keys: Vec<String>) -> R<()> {
    let vks = keys.iter().map(|k| input::parse_key(k)).collect::<anyhow::Result<Vec<_>>>().map_err(e)?;
    winwin::ensure_external_foreground();
    input::press_combo(&vks).map_err(e)?;
    log_manual(&nx, format!("Shortcut {}", keys.join("+")));
    Ok(())
}

#[tauri::command]
pub fn cursor_position() -> R<(i32, i32)> {
    input::cursor_pos().map_err(e)
}

#[tauri::command]
pub fn get_highlight(nx: S) -> Value {
    json!(*nx.highlight.lock().unwrap())
}

#[tauri::command]
pub fn clear_highlight(nx: S) {
    *nx.highlight.lock().unwrap() = None;
    nx.emit("nexus://highlight", Value::Null);
}

/// The user accepted a CO-PILOT suggestion: click exactly the highlighted point.
#[tauri::command]
pub fn execute_highlight(nx: S) -> R<()> {
    let h = nx.highlight.lock().unwrap().take().ok_or("No highlighted location")?;
    input::move_to(h.screen_x, h.screen_y).map_err(e)?;
    input::click(input::Button::Left, 1).map_err(e)?;
    nx.emit("nexus://highlight", Value::Null);
    log_manual(&nx, format!("User executed suggested click '{}' at ({}, {})", h.label, h.screen_x, h.screen_y));
    Ok(())
}

// ---------- system ----------

#[tauri::command]
pub fn system_snapshot(nx: S) -> Value {
    json!({
        "system": nx.sys.snapshot(),
        "battery": system::battery(),
        "activeWindow": winwin::foreground(),
    })
}

#[tauri::command]
pub fn list_windows() -> Vec<winwin::WindowInfo> {
    winwin::list()
}

#[tauri::command]
pub fn list_processes(nx: S) -> Vec<system::Proc> {
    nx.sys.processes().into_iter().take(300).collect()
}

// ---------- applications ----------

#[tauri::command]
pub fn list_apps(nx: S) -> R<Vec<desktop::AppRow>> {
    desktop::list_apps(&nx).map_err(e)
}

pub fn rescan(nx: &Nexus) -> R<Value> {
    let (found, warnings) = apps::discover();
    desktop::store_discovered(nx, &found).map_err(e)?;
    nx.emit("nexus://apps", json!({}));
    nx.log(Activity { kind: "system".into(), action: format!("Discovered {} installed applications", found.len()), status: if warnings.is_empty() { "ok".into() } else { "unverified".into() }, error: (!warnings.is_empty()).then(|| warnings.join("; ")), ..Default::default() });
    Ok(json!({"count": found.len(), "warnings": warnings}))
}

#[tauri::command]
pub async fn rescan_apps(nx: S<'_>) -> R<Value> {
    let nx2 = nx.inner().clone();
    tokio::task::spawn_blocking(move || rescan(&nx2)).await.map_err(e)?
}

#[tauri::command]
pub fn set_app_status(nx: S, id: String, status: AppStatus) -> R<()> {
    desktop::set_app_status(&nx, &id, status).map_err(e)
}

#[tauri::command]
pub fn launch_app(nx: S, id: String) -> R<()> {
    let app = desktop::list_apps(&nx).map_err(e)?.into_iter().find(|a| a.id == id).ok_or("Unknown application")?;
    apps::shell_open(&app.launch_target, None).map_err(e)?;
    log_manual(&nx, format!("User launched {}", app.name));
    Ok(())
}

// ---------- permissions ----------

#[tauri::command]
pub fn list_permissions(nx: S) -> R<Vec<Value>> {
    let rows: Vec<(String, String, Option<String>, i64)> = nx
        .db
        .with(|c| {
            let mut st = c.prepare("SELECT scope,status,last_used,use_count FROM permissions")?;
            let r = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
            r.collect()
        })
        .map_err(e)?;
    Ok(SCOPES
        .iter()
        .map(|d| {
            let row = rows.iter().find(|r| r.0 == d.scope);
            json!({
                "scope": d.scope, "description": d.description, "risk": d.risk,
                "status": row.map(|r| r.1.clone()).unwrap_or("default".into()),
                "lastUsed": row.and_then(|r| r.2.clone()), "useCount": row.map(|r| r.3).unwrap_or(0),
                "tools": tools::registry().iter().filter(|t| t.scope == d.scope).map(|t| t.name).collect::<Vec<_>>(),
            })
        })
        .collect())
}

#[tauri::command]
pub fn set_permission(nx: S, scope: String, status: ScopeStatus) -> R<()> {
    if !SCOPES.iter().any(|d| d.scope == scope) {
        return Err("Unknown permission".into());
    }
    permissions::set_scope_status(&nx.db, &scope, status).map_err(e)?;
    nx.log(Activity { kind: "permission".into(), action: format!("Permission {scope} set to {status:?}"), status: "ok".into(), permission: Some(scope), ..Default::default() });
    Ok(())
}

#[tauri::command]
pub fn permission_history(nx: S, scope: String) -> R<Vec<Value>> {
    tool_runs_where(&nx, "permission=?1", &scope, 50)
}

// ---------- workspaces & files ----------

#[tauri::command]
pub fn list_workspaces(nx: S) -> Vec<nfs::Workspace> {
    nfs::workspaces(&nx)
}

#[tauri::command]
pub fn add_workspace(nx: S, path: String) -> R<nfs::Workspace> {
    let w = nfs::add_workspace(&nx, &path, None).map_err(e)?;
    nx.log(Activity { kind: "permission".into(), action: format!("Authorized folder added: {}", w.path), status: "ok".into(), permission: Some("filesystem".into()), ..Default::default() });
    Ok(w)
}

#[tauri::command]
pub fn remove_workspace(nx: S, id: i64) -> R<()> {
    nfs::remove_workspace(&nx, id).map_err(e)?;
    nx.log(Activity { kind: "permission".into(), action: "Authorized folder removed".into(), status: "ok".into(), ..Default::default() });
    Ok(())
}

/// Files page browsing (user-initiated, same containment rules as the agent).
#[tauri::command]
pub fn browse_folder(nx: S, path: Option<String>) -> R<Value> {
    let r = nfs::resolve(&nx, path.as_deref()).map_err(e)?;
    if !r.inside {
        return Err("This folder is outside your authorized folders".into());
    }
    let mut items: Vec<Value> = std::fs::read_dir(&r.path)
        .map_err(e)?
        .flatten()
        .take(2000)
        .map(|en| {
            let p = en.path();
            let md = en.metadata().ok();
            json!({
                "name": en.file_name().to_string_lossy(), "path": p.display().to_string(),
                "type": if md.as_ref().map(|m| m.is_dir()).unwrap_or(false) { "folder" } else { "file" },
                "size": md.as_ref().filter(|m| m.is_file()).map(|m| m.len()),
                "modified": md.and_then(|m| m.modified().ok()).map(|t| chrono::DateTime::<chrono::Local>::from(t).to_rfc3339()),
                "protected": nfs::protected(&nx, &p).is_some(),
            })
        })
        .collect();
    items.sort_by_key(|v| (v["type"] != "folder", v["name"].as_str().unwrap_or("").to_lowercase()));
    Ok(json!({"path": r.path.display().to_string(), "items": items}))
}

#[tauri::command]
pub fn open_path(nx: S, path: String) -> R<()> {
    let r = nfs::resolve(&nx, Some(&path)).map_err(e)?;
    if !r.inside {
        return Err("Outside authorized folders".into());
    }
    apps::shell_open(&r.path.display().to_string(), None).map_err(e)?;
    log_manual(&nx, format!("User opened {}", r.path.display()));
    Ok(())
}

// ---------- activity & tasks ----------

#[tauri::command]
pub fn list_activity(nx: S, limit: Option<i64>, kind: Option<String>) -> R<Vec<Value>> {
    let limit = limit.unwrap_or(300).clamp(1, 5000);
    nx.db
        .with(|c| {
            let sql = format!(
                "SELECT id,ts,kind,action,tool,status,risk,permission,result,error,task_id FROM activity_logs {} ORDER BY id DESC LIMIT {limit}",
                if kind.is_some() { "WHERE kind=?1" } else { "" }
            );
            let mut st = c.prepare(&sql)?;
            let map = |r: &rusqlite::Row| {
                Ok(json!({"id": r.get::<_, i64>(0)?, "ts": r.get::<_, String>(1)?, "kind": r.get::<_, String>(2)?, "action": r.get::<_, String>(3)?,
                    "tool": r.get::<_, Option<String>>(4)?, "status": r.get::<_, String>(5)?, "risk": r.get::<_, Option<String>>(6)?,
                    "permission": r.get::<_, Option<String>>(7)?, "result": r.get::<_, Option<String>>(8)?, "error": r.get::<_, Option<String>>(9)?,
                    "taskId": r.get::<_, Option<String>>(10)?}))
            };
            match &kind {
                Some(k) => st.query_map([k], map)?.collect(),
                None => st.query_map([], map)?.collect(),
            }
        })
        .map_err(e)
}

#[tauri::command]
pub fn clear_activity(nx: S) -> R<()> {
    nx.db.with(|c| c.execute("DELETE FROM activity_logs", [])).map_err(e)?;
    Ok(())
}

#[tauri::command]
pub fn list_tasks(nx: S) -> R<Vec<Value>> {
    nx.db
        .with(|c| {
            let mut st = c.prepare(
                "SELECT t.id,t.conversation_id,t.title,t.description,t.status,t.priority,t.created_at,t.updated_at,t.due_date,t.progress,
                   (SELECT COUNT(*) FROM tool_runs r WHERE r.task_id=t.id), t.outcome
                 FROM tasks t ORDER BY t.created_at DESC LIMIT 300",
            )?;
            let r = st.query_map([], |r| {
                Ok(json!({"id": r.get::<_, String>(0)?, "conversationId": r.get::<_, Option<String>>(1)?, "title": r.get::<_, String>(2)?,
                    "description": r.get::<_, String>(3)?, "status": r.get::<_, String>(4)?, "priority": r.get::<_, String>(5)?,
                    "createdAt": r.get::<_, String>(6)?, "updatedAt": r.get::<_, String>(7)?, "dueDate": r.get::<_, Option<String>>(8)?,
                    "progress": r.get::<_, f64>(9)?, "toolRuns": r.get::<_, i64>(10)?, "outcome": r.get::<_, Option<String>>(11)?}))
            })?;
            r.collect()
        })
        .map_err(e)
}

#[tauri::command]
pub fn get_task(nx: S, id: String) -> R<Value> {
    let steps: Vec<Value> = nx
        .db
        .with(|c| {
            let mut st = c.prepare("SELECT idx,title,status FROM task_steps WHERE task_id=?1 ORDER BY idx")?;
            let r = st.query_map([&id], |r| Ok(json!({"idx": r.get::<_, i64>(0)?, "title": r.get::<_, String>(1)?, "status": r.get::<_, String>(2)?})))?;
            r.collect()
        })
        .map_err(e)?;
    let runs = tool_runs_where(&nx, "task_id=?1", &id, 500)?;
    let logs = nx
        .db
        .with(|c| {
            let mut st = c.prepare("SELECT ts,action,status,error FROM activity_logs WHERE task_id=?1 ORDER BY id")?;
            let r = st.query_map([&id], |r| Ok(json!({"ts": r.get::<_, String>(0)?, "action": r.get::<_, String>(1)?, "status": r.get::<_, String>(2)?, "error": r.get::<_, Option<String>>(3)?})))?;
            r.collect::<rusqlite::Result<Vec<Value>>>()
        })
        .map_err(e)?;
    Ok(json!({"steps": steps, "toolRuns": runs, "logs": logs}))
}

#[tauri::command]
pub fn delete_task(nx: S, id: String) -> R<()> {
    nx.db.with(|c| c.execute("DELETE FROM tasks WHERE id=?1 AND status NOT IN ('RUNNING','WAITING_PERMISSION')", [&id])).map_err(e)?;
    Ok(())
}

// ---------- memory & projects ----------

#[tauri::command]
pub fn list_memory(nx: S) -> R<Vec<nmem::MemoryRow>> {
    nmem::list_memory(&nx).map_err(e)
}

#[tauri::command]
pub fn add_memory(nx: S, content: String, project: Option<String>) -> R<i64> {
    nmem::save_memory(&nx, &content, project.as_deref()).map_err(e)
}

#[tauri::command]
pub fn delete_memory(nx: S, id: i64) -> R<()> {
    nmem::delete_memory(&nx, id).map_err(e)?;
    Ok(())
}

#[tauri::command]
pub fn clear_memory(nx: S) -> R<()> {
    nx.db.with(|c| c.execute("DELETE FROM memory", [])).map_err(e)?;
    nx.emit("nexus://memory", json!({}));
    nx.log(Activity { kind: "system".into(), action: "All memories deleted by the user".into(), status: "ok".into(), ..Default::default() });
    Ok(())
}

#[tauri::command]
pub fn list_projects(nx: S) -> R<Vec<Value>> {
    nx.db
        .with(|c| {
            let mut st = c.prepare(
                "SELECT p.id,p.name,p.description,p.notes,p.created_at,p.updated_at,
                    (SELECT COUNT(*) FROM memory m WHERE m.project_id=p.id),
                    (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id)
                 FROM projects p ORDER BY p.updated_at DESC",
            )?;
            let r = st.query_map([], |r| {
                Ok(json!({"id": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)?, "description": r.get::<_, String>(2)?,
                    "notes": r.get::<_, String>(3)?, "createdAt": r.get::<_, String>(4)?, "updatedAt": r.get::<_, String>(5)?,
                    "memoryCount": r.get::<_, i64>(6)?, "taskCount": r.get::<_, i64>(7)?}))
            })?;
            r.collect()
        })
        .map_err(e)
}

#[tauri::command]
pub fn save_project(nx: S, id: Option<String>, name: String, description: String, notes: String) -> R<String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Project name is required".into());
    }
    let ts = now();
    let id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    nx.db
        .with(|c| {
            c.execute(
                "INSERT INTO projects(id,name,description,notes,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5)
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, notes=excluded.notes, updated_at=excluded.updated_at",
                params![id, name, description, notes, ts],
            )
        })
        .map_err(e)?;
    Ok(id)
}

#[tauri::command]
pub fn delete_project(nx: S, id: String) -> R<()> {
    nx.db
        .with(|c| {
            c.execute("DELETE FROM memory WHERE project_id=?1", [&id])?;
            c.execute("DELETE FROM projects WHERE id=?1", [&id])
        })
        .map_err(e)?;
    Ok(())
}

// ---------- settings & secrets ----------

#[tauri::command]
pub fn get_settings(nx: S) -> Settings {
    nx.settings()
}

#[tauri::command]
pub fn save_settings(nx: S, settings: Settings) -> R<()> {
    apply_settings(&nx, settings)
}

/// Validates, persists and applies settings (also used by the tray menu).
pub fn apply_settings(nx: &Nexus, settings: Settings) -> R<()> {
    let mut s = settings;
    s.voice_volume = s.voice_volume.min(100);
    s.effort = match s.effort.as_str() {
        "low" | "medium" | "high" | "xhigh" | "max" => s.effort,
        _ => "medium".into(),
    };
    s.stream_max_width = s.stream_max_width.clamp(640, 3840);
    s.ai_screenshot_max_width = s.ai_screenshot_max_width.clamp(800, 2560);
    s.stream_quality = s.stream_quality.clamp(30, 95);
    if !["full", "subtle", "off"].contains(&s.companion_animation.as_str()) {
        s.companion_animation = "full".into();
    }
    s.companion_actions.retain(|a| crate::companion::QUICK_ACTIONS.contains(&a.as_str()));
    // The window position is owned by the Companion itself (dragging), not the form.
    s.companion_position = nx.settings().companion_position;
    // Start-with-Windows touches the registry only when the user changes it.
    let was = crate::companion::startup_registered();
    if s.start_with_windows != was {
        crate::companion::set_startup(s.start_with_windows).map_err(e)?;
        nx.log(Activity { kind: "system".into(), action: format!("Start with Windows {}", if s.start_with_windows { "enabled" } else { "disabled" }), status: "ok".into(), ..Default::default() });
    }
    settings::save(&nx.db, &s).map_err(e)?;
    *nx.settings.write().unwrap() = s.clone();
    if !s.voice_enabled {
        crate::voice::cancel(nx);
    }
    crate::companion::apply_settings(nx, &s, false);
    crate::tray::refresh(nx);
    nx.emit("nexus://settings", json!({}));
    nx.log(Activity { kind: "system".into(), action: "Settings updated".into(), status: "ok".into(), ..Default::default() });
    Ok(())
}

#[tauri::command]
pub fn secret_status() -> Value {
    let mut m = serde_json::Map::new();
    for n in secrets::ALLOWED {
        m.insert(n.to_string(), json!(secrets::has(n)));
    }
    Value::Object(m)
}

#[tauri::command]
pub fn set_secret(nx: S, name: String, value: String) -> R<()> {
    if !secrets::ALLOWED.contains(&name.as_str()) {
        return Err("Unknown secret".into());
    }
    let v = value.trim();
    if v.is_empty() {
        return Err("Value is empty".into());
    }
    secrets::set(&name, v).map_err(e)?;
    nx.log(Activity { kind: "system".into(), action: format!("Secret '{name}' stored in Windows Credential Manager"), status: "ok".into(), ..Default::default() });
    Ok(())
}

#[tauri::command]
pub fn clear_secret(nx: S, name: String) -> R<()> {
    if !secrets::ALLOWED.contains(&name.as_str()) {
        return Err("Unknown secret".into());
    }
    secrets::delete(&name).map_err(e)?;
    nx.log(Activity { kind: "system".into(), action: format!("Secret '{name}' removed"), status: "ok".into(), ..Default::default() });
    Ok(())
}

/// Minimal real request so the user knows the key/model work.
#[tauri::command]
pub async fn test_ai_connection(nx: S<'_>) -> R<String> {
    let p = agent::provider::Provider::from_settings(&nx.settings()).map_err(e)?;
    let msgs = vec![json!({"role": "user", "content": "Reply with exactly: NEXUS online"})];
    let mut sink = |_d: agent::provider::Delta| {};
    let res = p
        .chat(&nx.http, agent::provider::ChatRequest { system: "You are a connectivity test.", messages: &msgs, tools: &[] }, &tokio_util::sync::CancellationToken::new(), &mut sink)
        .await;
    let at = chrono::Local::now().format("%H:%M").to_string();
    match res {
        Ok(r) => {
            let text: String = r.content.iter().filter_map(|b| b["text"].as_str()).collect();
            *nx.ai_test.lock().unwrap() = Some(json!({"ok": true, "at": at, "model": r.model}));
            nx.emit("nexus://integrations", json!({}));
            Ok(format!("{} replied: {}", r.model, text.trim()))
        }
        Err(err) => {
            *nx.ai_test.lock().unwrap() = Some(json!({"ok": false, "at": at, "error": format!("{err:#}")}));
            nx.emit("nexus://integrations", json!({}));
            Err(e(err))
        }
    }
}

// ---------- browser quick actions (user-initiated) ----------

fn open_in_default_or_setting(nx: &Nexus, url: &str) -> R<String> {
    let b = nx.settings().default_browser;
    if b == "system" {
        apps::shell_open(url, None).map_err(e)?;
        return Ok("default browser".into());
    }
    let app = desktop::find_app(nx, &b).map_err(e)?;
    let target = app.exe_path.clone().unwrap_or(app.launch_target.clone());
    apps::shell_open(&target, Some(url)).map_err(e)?;
    Ok(app.name)
}

#[tauri::command]
pub fn open_url(nx: S, url: String) -> R<String> {
    let u = tools::web::parse_web_url(&url).map_err(e)?;
    let used = open_in_default_or_setting(&nx, u.as_str())?;
    log_manual(&nx, format!("User opened {} in {used}", u.as_str()));
    Ok(used)
}

#[tauri::command]
pub fn web_search(nx: S, query: String) -> R<String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("Search query is empty".into());
    }
    let u = tools::web::search_url(&nx.settings().search_engine, q);
    let used = open_in_default_or_setting(&nx, &u)?;
    log_manual(&nx, format!("User searched the web for \"{q}\""));
    Ok(used)
}


// ---------- user-triggered tool calls (Companion quick actions) ----------

/// Runs one registry tool on the user's behalf through the exact same pipeline
/// as the AI: validation, assessment, permission policy, approval, execution,
/// verification and audit log. Nothing here bypasses security.
#[tauri::command]
pub async fn invoke_tool(nx: S<'_>, name: String, input: Value) -> R<Value> {
    if nx.control.is_stopped() {
        return Err("NEXUS is stopped. Re-arm it first.".into());
    }
    let run = tools::RunCtx::new("quick-actions".into(), format!("Quick action: {name}"), nx.control.token());
    let id = format!("quick_{}", uuid::Uuid::new_v4().simple());
    let r = tools::run_tool(&nx, &run, &id, &name, input).await;
    let stopped = nx.control.is_stopped() || run.token.is_cancelled();
    let outcome = agent::finish_task(&nx, &run, !r.is_error, stopped);
    if !nx.agent_running.load(Ordering::SeqCst) {
        nx.set_status(if r.is_error && !stopped { AgentStatus::Error } else { AgentStatus::Completed });
    }
    nx.emit("nexus://outcome", json!({"conversationId": "quick-actions", "taskId": run.task_id.lock().unwrap().clone(), "outcome": outcome}));
    let text: String = r.content.iter().filter_map(|c| c["text"].as_str()).collect::<Vec<_>>().join("
");
    Ok(json!({"isError": r.is_error, "text": text, "outcome": outcome, "toolRunId": id}))
}
