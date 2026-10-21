//! Desktop tools: applications, windows, screen, mouse and keyboard.

use super::{Assessment, ImageOut, RunCtx, ToolOutput, ToolSpec};
use crate::db::now;
use crate::permissions::{AppStatus, Kind, Risk};
use crate::state::{Highlight, Nexus};
use crate::win::{apps, capture, input, windows as winwin};
use anyhow::{anyhow, bail, Context, Result};
use rusqlite::params;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant};

const COORD_NOTE: &str = "x/y are pixel coordinates in the most recent desktop_take_screenshot image of that monitor (monitor defaults to 1, the primary).";

pub fn specs() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "desktop.open_application",
            description: "Launch an installed Windows application by name (as listed by system_list_installed_applications) and verify it is running.",
            scope: "desktop.control", risk: Risk::Low, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"name":{"type":"string","description":"Application name, e.g. 'Opera GX', 'Discord', 'Visual Studio Code'","maxLength":200}},"required":["name"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "desktop.close_application",
            description: "Close an application's windows gracefully (like clicking X). force=true kills the process and may lose unsaved work.",
            scope: "desktop.control", risk: Risk::Medium, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"name":{"type":"string","maxLength":200},"force":{"type":"boolean"}},"required":["name"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "desktop.list_windows",
            description: "List visible top-level windows with title, process, position and size.",
            scope: "desktop.read", risk: Risk::Low, kind: Kind::Read,
            schema: || json!({"type":"object","properties":{},"additionalProperties":false}),
        },
        ToolSpec {
            name: "desktop.focus_window",
            description: "Bring a window to the foreground, by hwnd (from desktop_list_windows) or by a case-insensitive title substring.",
            scope: "desktop.control", risk: Risk::Low, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"hwnd":{"type":"integer"},"title":{"type":"string","maxLength":300}},"additionalProperties":false}),
        },
        ToolSpec {
            name: "desktop.get_monitors",
            description: "List monitors with index, resolution and position.",
            scope: "desktop.read", risk: Risk::Low, kind: Kind::Read,
            schema: || json!({"type":"object","properties":{},"additionalProperties":false}),
        },
        ToolSpec {
            name: "desktop.take_screenshot",
            description: "Capture a monitor and return the image. Use it to see the screen before clicking; coordinates for mouse tools refer to this image.",
            scope: "desktop.read", risk: Risk::Low, kind: Kind::Read,
            schema: || json!({"type":"object","properties":{"monitor":{"type":"integer","minimum":1}},"additionalProperties":false}),
        },
        ToolSpec {
            name: "desktop.get_cursor_position",
            description: "Return the current mouse cursor position in physical desktop pixels.",
            scope: "desktop.read", risk: Risk::Low, kind: Kind::Read,
            schema: || json!({"type":"object","properties":{},"additionalProperties":false}),
        },
        ToolSpec {
            name: "desktop.move_mouse",
            description: const_format(COORD_NOTE, "Move the real mouse cursor."),
            scope: "desktop.mouse", risk: Risk::Low, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"monitor":{"type":"integer","minimum":1}},"required":["x","y"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "desktop.click",
            description: const_format(COORD_NOTE, "Move to x/y (if given) and click. button: left|right|middle, count: 1 or 2 (double click)."),
            scope: "desktop.mouse", risk: Risk::Medium, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"monitor":{"type":"integer","minimum":1},"button":{"type":"string","enum":["left","right","middle"]},"count":{"type":"integer","minimum":1,"maximum":3}},"additionalProperties":false}),
        },
        ToolSpec {
            name: "desktop.drag",
            description: const_format(COORD_NOTE, "Press at (from_x,from_y), move to (to_x,to_y) and release."),
            scope: "desktop.mouse", risk: Risk::Medium, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"from_x":{"type":"number"},"from_y":{"type":"number"},"to_x":{"type":"number"},"to_y":{"type":"number"},"monitor":{"type":"integer","minimum":1}},"required":["from_x","from_y","to_x","to_y"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "desktop.scroll",
            description: "Scroll the mouse wheel. dy>0 scrolls up, dy<0 down (in notches). Optional x/y moves the cursor first (screenshot coordinates).",
            scope: "desktop.mouse", risk: Risk::Low, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"dy":{"type":"integer","minimum":-50,"maximum":50},"dx":{"type":"integer","minimum":-50,"maximum":50},"x":{"type":"number"},"y":{"type":"number"},"monitor":{"type":"integer","minimum":1}},"required":["dy"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "desktop.type",
            description: "Type Unicode text into the focused window (works with French accents). \\n presses Enter.",
            scope: "desktop.keyboard", risk: Risk::Medium, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"text":{"type":"string","maxLength":5000}},"required":["text"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "desktop.press_key",
            description: "Press a single key, e.g. enter, esc, tab, backspace, delete, up, down, left, right, home, end, pageup, pagedown, f1-f24, a-z, 0-9.",
            scope: "desktop.keyboard", risk: Risk::Medium, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"key":{"type":"string","maxLength":30},"repeat":{"type":"integer","minimum":1,"maximum":50}},"required":["key"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "desktop.hotkey",
            description: "Press a keyboard shortcut, e.g. [\"ctrl\",\"c\"], [\"alt\",\"tab\"], [\"win\",\"d\"], [\"ctrl\",\"shift\",\"esc\"].",
            scope: "desktop.keyboard", risk: Risk::Medium, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"keys":{"type":"array","items":{"type":"string","maxLength":30}}},"required":["keys"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "desktop.highlight",
            description: "CO-PILOT visual guidance: highlight a location on the user's Control Panel screen view WITHOUT clicking, so the user can decide to act. Coordinates as in desktop_take_screenshot.",
            scope: "desktop.read", risk: Risk::Low, kind: Kind::Read,
            schema: || json!({"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"width":{"type":"number"},"height":{"type":"number"},"label":{"type":"string","maxLength":200},"monitor":{"type":"integer","minimum":1}},"required":["x","y","label"],"additionalProperties":false}),
        },
    ]
}

/// ToolSpec descriptions are &'static; leak the handful of composed strings once.
fn const_format(note: &str, text: &str) -> &'static str {
    Box::leak(format!("{text} {note}").into_boxed_str())
}

// ---------- application table ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRow {
    pub id: String,
    pub name: String,
    pub exe_path: Option<String>,
    pub launch_target: String,
    pub source: String,
    pub install_dir: Option<String>,
    pub expected_process: Option<String>,
    pub status: AppStatus,
    pub running: bool,
}

pub fn store_discovered(nx: &Nexus, found: &[apps::DiscoveredApp]) -> Result<()> {
    let ts = now();
    nx.db.with(|c| {
        for a in found {
            c.execute(
                "INSERT INTO applications(id,name,exe_path,launch_target,launch_args,source,install_dir,expected_process,last_seen)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name, exe_path=excluded.exe_path, launch_target=excluded.launch_target,
                   launch_args=excluded.launch_args, source=excluded.source, install_dir=excluded.install_dir,
                   expected_process=excluded.expected_process, last_seen=excluded.last_seen",
                params![a.id, a.name, a.exe_path, a.launch_target, a.launch_args, a.source, a.install_dir, a.expected_process, ts],
            )?;
        }
        // Apps that disappeared from this scan are uninstalled; keep only user-set status rows? No: drop stale.
        c.execute("DELETE FROM applications WHERE last_seen <> ?1", [&ts])?;
        Ok(())
    })
}

pub fn list_apps(nx: &Nexus) -> Result<Vec<AppRow>> {
    let running: std::collections::HashSet<String> = nx.sys.processes().into_iter().map(|p| p.name.to_lowercase()).collect();
    let rows = nx.db.with(|c| {
        let mut st = c.prepare("SELECT id,name,exe_path,launch_target,source,install_dir,expected_process,status FROM applications ORDER BY name COLLATE NOCASE")?;
        let r = st
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?, r.get::<_, Option<String>>(5)?, r.get::<_, Option<String>>(6)?, r.get::<_, String>(7)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(r)
    })?;
    Ok(rows
        .into_iter()
        .map(|(id, name, exe_path, launch_target, source, install_dir, expected_process, status)| AppRow {
            running: expected_process.as_ref().map(|p| running.contains(&p.to_lowercase())).unwrap_or(false),
            status: serde_json::from_value(Value::String(status)).unwrap_or(AppStatus::Ask),
            id, name, exe_path, launch_target, source, install_dir, expected_process,
        })
        .collect())
}

pub fn set_app_status(nx: &Nexus, id: &str, s: AppStatus) -> Result<()> {
    let v = serde_json::to_value(s)?.as_str().unwrap_or("ask").to_string();
    nx.db.with(|c| c.execute("UPDATE applications SET status=?1 WHERE id=?2", params![v, id]))?;
    nx.emit("nexus://apps", json!({}));
    Ok(())
}

/// Exact match, then prefix, then substring; refuses to guess between several.
pub fn find_app(nx: &Nexus, query: &str) -> Result<AppRow> {
    let q = query.trim().to_lowercase();
    let q = q.strip_suffix(".exe").unwrap_or(&q).to_string();
    let apps = list_apps(nx)?;
    if apps.is_empty() {
        bail!("The installed-application list is empty. Rescan applications from the Control Panel or Permissions page.");
    }
    let proc_name = |a: &AppRow| a.expected_process.as_ref().map(|p| p.to_lowercase().trim_end_matches(".exe").to_string());
    if let Some(a) = apps.iter().find(|a| a.name.to_lowercase() == q || proc_name(a).as_deref() == Some(&q)) {
        return Ok(a.clone());
    }
    let pref: Vec<_> = apps.iter().filter(|a| a.name.to_lowercase().starts_with(&q)).collect();
    if pref.len() == 1 {
        return Ok(pref[0].clone());
    }
    let sub: Vec<_> = apps.iter().filter(|a| a.name.to_lowercase().contains(&q)).collect();
    match (pref.len(), sub.len()) {
        (0, 1) => Ok(sub[0].clone()),
        (0, 0) => bail!(
            "No installed application matches '{query}'. It may not be installed, or the list is outdated: rescan installed applications."
        ),
        _ => {
            let names: Vec<_> = (if pref.is_empty() { sub } else { pref }).iter().take(12).map(|a| a.name.clone()).collect();
            bail!("'{query}' is ambiguous. Matching applications: {}. Ask the user which one.", names.join(", "))
        }
    }
}

fn package_family(target: &str) -> Option<String> {
    let aumid = target.strip_prefix("shell:AppsFolder\\")?;
    Some(aumid.split(['_', '!']).next()?.to_lowercase())
}

fn windows_for(app: &AppRow) -> Vec<winwin::WindowInfo> {
    let name = app.name.to_lowercase();
    let proc = app.expected_process.as_ref().map(|p| p.to_lowercase());
    let dir = app.install_dir.as_ref().map(|d| d.to_lowercase());
    let fam = package_family(&app.launch_target);
    winwin::list()
        .into_iter()
        .filter(|w| {
            let exe = w.exe_path.to_lowercase();
            proc.as_deref().map(|p| w.process.to_lowercase() == p).unwrap_or(false)
                || dir.as_deref().map(|d| !d.is_empty() && exe.starts_with(d)).unwrap_or(false)
                || fam.as_deref().map(|f| exe.contains(f)).unwrap_or(false)
                || w.title.to_lowercase().contains(&name)
        })
        .collect()
}

fn is_running(nx: &Nexus, app: &AppRow) -> bool {
    app.expected_process.as_ref().map(|p| !nx.sys.running_by_name(p).is_empty()).unwrap_or(false) || !windows_for(app).is_empty()
}

// ---------- coordinates ----------

fn to_screen(nx: &Nexus, monitor: Option<u64>, x: f64, y: f64) -> Result<(i32, i32, usize)> {
    let idx = monitor.unwrap_or(1) as usize;
    let m = capture::monitor_by_index(idx)?;
    let (fw, fh) = nx.ai_frames.lock().unwrap().get(&idx).copied().unwrap_or((m.width, m.height));
    let (sx, sy) = capture::frame_to_screen(&m, fw, fh, x, y);
    Ok((sx, sy, idx))
}

fn num(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(|x| x.as_f64())
}
fn string(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(|s| s.to_string())
}

/// Shortcuts NEXUS must never press: they would lock the session or fight STOP.
fn forbidden_combo(keys: &[String]) -> Option<&'static str> {
    let k: Vec<String> = keys.iter().map(|s| s.to_lowercase()).collect();
    let has = |n: &str| k.iter().any(|x| x == n);
    if (has("win") || has("windows") || has("meta")) && has("l") {
        return Some("Win+L would lock the session");
    }
    if (has("ctrl") || has("control")) && has("alt") && (has("delete") || has("del")) {
        return Some("Ctrl+Alt+Del cannot be automated");
    }
    if (has("ctrl") || has("control")) && has("alt") && has("backspace") {
        return Some("Ctrl+Alt+Backspace is the STOP NEXUS hotkey");
    }
    None
}

pub fn assess(nx: &Arc<Nexus>, spec: &ToolSpec, input: &Value) -> Result<Assessment> {
    let a = match spec.name {
        "desktop.open_application" => {
            let app = find_app(nx, &string(input, "name").unwrap_or_default())?;
            let mut a = Assessment::new(spec, format!("Launch {}", app.name))
                .detail("Application", &app.name)
                .detail("Source", &app.source)
                .detail("Target", app.exe_path.clone().unwrap_or(app.launch_target.clone()));
            a.app = Some((app.id.clone(), app.status));
            a
        }
        "desktop.close_application" => {
            let app = find_app(nx, &string(input, "name").unwrap_or_default())?;
            let force = input.get("force").and_then(|f| f.as_bool()).unwrap_or(false);
            let mut a = Assessment::new(spec, format!("{} {}", if force { "Force-kill" } else { "Close" }, app.name))
                .detail("Application", &app.name)
                .detail("Consequence", if force { "The process is terminated; unsaved work is lost." } else { "The app may ask to save unsaved work." });
            if force {
                a.risk = Risk::High;
            }
            a.app = Some((app.id.clone(), if app.status == AppStatus::Blocked { AppStatus::Blocked } else { AppStatus::Allowed }));
            a
        }
        "desktop.focus_window" => Assessment::new(spec, "Bring a window to the foreground"),
        "desktop.move_mouse" | "desktop.click" | "desktop.drag" | "desktop.scroll" => {
            let (x, y) = match spec.name {
                "desktop.drag" => (num(input, "from_x"), num(input, "from_y")),
                _ => (num(input, "x"), num(input, "y")),
            };
            let mon = input.get("monitor").and_then(|m| m.as_u64());
            let pos = match (x, y) {
                (Some(x), Some(y)) => {
                    let (sx, sy, idx) = to_screen(nx, mon, x, y)?;
                    format!("({sx}, {sy}) on monitor {idx}")
                }
                _ => "current cursor position".into(),
            };
            let verb = match spec.name {
                "desktop.move_mouse" => "Move the mouse to".to_string(),
                "desktop.drag" => "Drag from".into(),
                "desktop.scroll" => "Scroll at".into(),
                _ => {
                    let b = string(input, "button").unwrap_or("left".into());
                    let c = input.get("count").and_then(|c| c.as_u64()).unwrap_or(1);
                    format!("{}{}-click at", if c >= 2 { "Double " } else { "" }, b)
                }
            };
            Assessment::new(spec, format!("{verb} {pos}"))
        }
        "desktop.type" => {
            let t = string(input, "text").unwrap_or_default();
            let preview: String = t.chars().take(160).collect();
            let a = Assessment::new(spec, format!("Type {} characters into the focused window", t.chars().count()))
                .detail("Text", if t.chars().count() > 160 { format!("{preview}…") } else { preview });
            let fg = winwin::keyboard_target_preview().map(|w| format!("{} ({})", w.title, w.process)).unwrap_or_default();
            a.detail("Target window", fg)
        }
        "desktop.press_key" => {
            let k = string(input, "key").unwrap_or_default();
            input::parse_key(&k)?;
            Assessment::new(spec, format!("Press {k}"))
        }
        "desktop.hotkey" => {
            let keys: Vec<String> = input["keys"].as_array().map(|a| a.iter().filter_map(|k| k.as_str().map(String::from)).collect()).unwrap_or_default();
            if keys.is_empty() || keys.len() > 5 {
                bail!("keys must contain 1 to 5 keys");
            }
            for k in &keys {
                input::parse_key(k)?;
            }
            let mut a = Assessment::new(spec, format!("Press shortcut {}", keys.join("+")));
            a.hard_deny = forbidden_combo(&keys).map(|s| s.to_string());
            a
        }
        _ => Assessment::new(spec, spec.description.split('.').next().unwrap_or(spec.name).to_string()),
    };
    Ok(a)
}

pub async fn call(nx: &Arc<Nexus>, run: &RunCtx, name: &str, input: Value) -> Result<ToolOutput> {
    let cancel = run.token.clone();
    match name {
        "desktop.open_application" => {
            let app = find_app(nx, &string(&input, "name").unwrap_or_default())?;
            let was_running = is_running(nx, &app);
            let target = app.launch_target.clone();
            tokio::task::spawn_blocking(move || apps::shell_open(&target, None))
                .await?
                .with_context(|| format!("{} could not be launched", app.name))?;
            // Verify: poll for the process or a matching window.
            let deadline = Instant::now() + Duration::from_secs(15);
            let mut verified = false;
            while Instant::now() < deadline {
                if cancel.is_cancelled() {
                    bail!("Interrupted by STOP NEXUS");
                }
                tokio::time::sleep(Duration::from_millis(600)).await;
                let wins = windows_for(&app);
                let proc_ok = app.expected_process.as_ref().map(|p| !nx.sys.running_by_name(p).is_empty()).unwrap_or(false);
                if !wins.is_empty() || (proc_ok && !was_running) {
                    verified = true;
                    break;
                }
            }
            let wins = windows_for(&app);
            let summary = if verified {
                format!("{} {}", app.name, if was_running { "was already running and was activated" } else { "launched and detected running" })
            } else {
                format!("Launch command for {} was accepted, but no process or window was detected within 15 s", app.name)
            };
            Ok(ToolOutput::new(summary, json!({
                "application": app.name,
                "alreadyRunning": was_running,
                "windows": wins.iter().take(5).map(|w| json!({"title": w.title, "hwnd": w.hwnd, "process": w.process})).collect::<Vec<_>>(),
            }))
            .verified(verified))
        }
        "desktop.close_application" => {
            let app = find_app(nx, &string(&input, "name").unwrap_or_default())?;
            let force = input.get("force").and_then(|f| f.as_bool()).unwrap_or(false);
            let wins = windows_for(&app);
            if wins.is_empty() && !is_running(nx, &app) {
                bail!("{} is not running", app.name);
            }
            if force {
                let pids: Vec<u32> = wins.iter().map(|w| w.pid).chain(app.expected_process.as_ref().map(|p| nx.sys.running_by_name(p)).unwrap_or_default()).collect();
                let killed = kill_pids(&pids);
                tokio::time::sleep(Duration::from_millis(800)).await;
                let gone = !is_running(nx, &app);
                return Ok(ToolOutput::new(format!("Force-terminated {} ({killed} process(es))", app.name), json!({"killed": killed})).verified(gone));
            }
            for w in &wins {
                winwin::request_close(w.hwnd)?;
            }
            let deadline = Instant::now() + Duration::from_secs(8);
            while Instant::now() < deadline && !windows_for(&app).is_empty() {
                if cancel.is_cancelled() {
                    bail!("Interrupted by STOP NEXUS");
                }
                tokio::time::sleep(Duration::from_millis(400)).await;
            }
            let remaining = windows_for(&app);
            let ok = remaining.is_empty();
            let summary = if ok {
                format!("{} closed (all {} window(s) gone)", app.name, wins.len())
            } else {
                format!("Asked {} to close; {} window(s) still open (it may be asking to save)", app.name, remaining.len())
            };
            Ok(ToolOutput::new(summary, json!({"remainingWindows": remaining.iter().map(|w| &w.title).collect::<Vec<_>>()})).verified(ok))
        }
        "desktop.list_windows" => {
            let w = tokio::task::spawn_blocking(winwin::list).await?;
            Ok(ToolOutput::new(format!("{} windows open", w.len()), json!(w)).untrusted())
        }
        "desktop.focus_window" => {
            let hwnd = match (input.get("hwnd").and_then(|h| h.as_i64()), string(&input, "title")) {
                (Some(h), _) => h as isize,
                (None, Some(t)) => {
                    let t = t.to_lowercase();
                    let m: Vec<_> = winwin::list().into_iter().filter(|w| w.title.to_lowercase().contains(&t)).collect();
                    match m.len() {
                        0 => bail!("No open window title contains '{t}'"),
                        1 => m[0].hwnd,
                        _ => bail!("Several windows match: {}. Use hwnd.", m.iter().map(|w| format!("{} [{}]", w.title, w.hwnd)).collect::<Vec<_>>().join("; ")),
                    }
                }
                _ => bail!("Provide hwnd or title"),
            };
            let w = tokio::task::spawn_blocking(move || winwin::focus(hwnd)).await??;
            Ok(ToolOutput::new(format!("Focused '{}'", w.title), json!(w)).verified(true))
        }
        "desktop.get_monitors" => {
            let m = capture::monitors()?;
            Ok(ToolOutput::new(format!("{} monitor(s)", m.len()), json!(m)))
        }
        "desktop.take_screenshot" => {
            let idx = input.get("monitor").and_then(|m| m.as_u64()).unwrap_or(1) as usize;
            let maxw = nx.settings().ai_screenshot_max_width;
            let f = tokio::task::spawn_blocking(move || capture::capture(idx, maxw, 80)).await??;
            nx.ai_frames.lock().unwrap().insert(idx, (f.width, f.height));
            let mut out = ToolOutput::new(
                format!("Screenshot of monitor {idx} ({}x{} shown as {}x{})", f.monitor.width, f.monitor.height, f.width, f.height),
                json!({"monitor": idx, "imageWidth": f.width, "imageHeight": f.height, "screenWidth": f.monitor.width, "screenHeight": f.monitor.height,
                       "note": "Mouse tool coordinates for this monitor now refer to this image's pixels."}),
            )
            .untrusted();
            out.images.push(ImageOut { media_type: f.media_type.into(), data: f.data });
            Ok(out)
        }
        "desktop.get_cursor_position" => {
            let (x, y) = input::cursor_pos()?;
            Ok(ToolOutput::new(format!("Cursor at ({x}, {y})"), json!({"x": x, "y": y})))
        }
        "desktop.move_mouse" => {
            let (sx, sy, _) = to_screen(nx, input.get("monitor").and_then(|m| m.as_u64()), num(&input, "x").unwrap_or(0.0), num(&input, "y").unwrap_or(0.0))?;
            input::move_to(sx, sy)?;
            let (cx, cy) = input::cursor_pos()?;
            let ok = (cx - sx).abs() <= 2 && (cy - sy).abs() <= 2;
            Ok(ToolOutput::new(format!("Mouse moved to ({cx}, {cy})"), json!({"x": cx, "y": cy})).verified(ok))
        }
        "desktop.click" => {
            let button: input::Button = serde_json::from_value(input.get("button").cloned().unwrap_or(json!("left"))).unwrap_or(input::Button::Left);
            let count = input.get("count").and_then(|c| c.as_u64()).unwrap_or(1) as u32;
            if let (Some(x), Some(y)) = (num(&input, "x"), num(&input, "y")) {
                let (sx, sy, _) = to_screen(nx, input.get("monitor").and_then(|m| m.as_u64()), x, y)?;
                input::move_to(sx, sy)?;
                tokio::time::sleep(Duration::from_millis(40)).await;
            }
            if cancel.is_cancelled() {
                bail!("Interrupted by STOP NEXUS");
            }
            input::click(button, count)?;
            let (cx, cy) = input::cursor_pos()?;
            Ok(ToolOutput::new(format!("{:?} click ×{count} sent at ({cx}, {cy})", button), json!({"x": cx, "y": cy,
                "note": "The click was injected. Take a screenshot to confirm its effect."})))
        }
        "desktop.drag" => {
            let mon = input.get("monitor").and_then(|m| m.as_u64());
            let (fx, fy, _) = to_screen(nx, mon, num(&input, "from_x").unwrap_or(0.0), num(&input, "from_y").unwrap_or(0.0))?;
            let (tx, ty, _) = to_screen(nx, mon, num(&input, "to_x").unwrap_or(0.0), num(&input, "to_y").unwrap_or(0.0))?;
            input::drag((fx, fy), (tx, ty), input::Button::Left, &cancel).await?;
            Ok(ToolOutput::new(format!("Dragged from ({fx}, {fy}) to ({tx}, {ty})"), json!({})))
        }
        "desktop.scroll" => {
            if let (Some(x), Some(y)) = (num(&input, "x"), num(&input, "y")) {
                let (sx, sy, _) = to_screen(nx, input.get("monitor").and_then(|m| m.as_u64()), x, y)?;
                input::move_to(sx, sy)?;
            }
            let dy = input.get("dy").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            let dx = input.get("dx").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            input::scroll(dx, dy)?;
            Ok(ToolOutput::new(format!("Scrolled {} notch(es) {}", dy.abs(), if dy >= 0 { "up" } else { "down" }), json!({})))
        }
        "desktop.type" => {
            let t = string(&input, "text").unwrap_or_default();
            let target = keyboard_target().await?;
            let n = input::type_text(&t, &cancel).await?;
            Ok(ToolOutput::new(format!("Typed {n} characters into '{}'", target.title), json!({"characters": n, "window": target.title, "process": target.process})))
        }
        "desktop.press_key" => {
            let k = string(&input, "key").unwrap_or_default();
            let vk = input::parse_key(&k)?;
            let rep = input.get("repeat").and_then(|r| r.as_u64()).unwrap_or(1);
            keyboard_target().await?;
            for _ in 0..rep {
                if cancel.is_cancelled() {
                    bail!("Interrupted by STOP NEXUS");
                }
                input::press_combo(&[vk])?;
                tokio::time::sleep(Duration::from_millis(30)).await;
            }
            Ok(ToolOutput::new(format!("Pressed {k}{}", if rep > 1 { format!(" ×{rep}") } else { String::new() }), json!({})))
        }
        "desktop.hotkey" => {
            let keys: Vec<String> = input["keys"].as_array().map(|a| a.iter().filter_map(|k| k.as_str().map(String::from)).collect()).unwrap_or_default();
            if let Some(why) = forbidden_combo(&keys) {
                bail!("{why}");
            }
            let vks = keys.iter().map(|k| input::parse_key(k)).collect::<Result<Vec<_>>>()?;
            keyboard_target().await?;
            input::press_combo(&vks)?;
            Ok(ToolOutput::new(format!("Pressed {}", keys.join("+")), json!({})))
        }
        "desktop.highlight" => {
            let idx = input.get("monitor").and_then(|m| m.as_u64()).unwrap_or(1) as usize;
            let m = capture::monitor_by_index(idx)?;
            let (fw, fh) = nx.ai_frames.lock().unwrap().get(&idx).copied().unwrap_or((m.width, m.height));
            let x = num(&input, "x").unwrap_or(0.0);
            let y = num(&input, "y").unwrap_or(0.0);
            let w = num(&input, "width").unwrap_or(fw as f64 * 0.04);
            let h = num(&input, "height").unwrap_or(fh as f64 * 0.04);
            let (sx, sy) = capture::frame_to_screen(&m, fw, fh, x, y);
            let hl = Highlight {
                monitor: idx,
                x: x / fw as f64, y: y / fh as f64, w: w / fw as f64, h: h / fh as f64,
                label: string(&input, "label").unwrap_or_default(),
                screen_x: sx, screen_y: sy,
            };
            *nx.highlight.lock().unwrap() = Some(hl.clone());
            nx.emit("nexus://highlight", &hl);
            Ok(ToolOutput::new(format!("Highlighted '{}' on monitor {idx}; nothing was clicked", hl.label), json!({"screenX": sx, "screenY": sy})))
        }
        _ => Err(anyhow!("Tool {name} is not implemented")),
    }
}

/// Keystrokes go to the foreground window; if that is NEXUS itself (the user
/// just typed in the chat), hand focus back to the app they were using.
async fn keyboard_target() -> Result<winwin::WindowInfo> {
    tokio::task::spawn_blocking(|| {
        winwin::ensure_external_foreground();
        winwin::foreground().ok_or_else(|| anyhow!("No window has keyboard focus"))
    })
    .await?
}

fn kill_pids(pids: &[u32]) -> usize {
    let mut s = sysinfo::System::new();
    s.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let mut n = 0;
    let mut seen = std::collections::HashSet::new();
    for pid in pids {
        if !seen.insert(*pid) || *pid == std::process::id() {
            continue;
        }
        if let Some(p) = s.process(sysinfo::Pid::from_u32(*pid)) {
            if p.kill() {
                n += 1;
            }
        }
    }
    n
}
