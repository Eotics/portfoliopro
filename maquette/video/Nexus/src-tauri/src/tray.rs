//! Notification-area (system tray) icon: the central place to control NEXUS
//! while its windows are hidden. Every item calls the same code as the UI.

use crate::state::Nexus;
use std::sync::{Arc, Mutex};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

struct Items {
    companion: MenuItem<Wry>,
    voice: CheckMenuItem<Wry>,
    stop: MenuItem<Wry>,
    rearm: MenuItem<Wry>,
}

static ITEMS: Mutex<Option<Items>> = Mutex::new(None);

/// Set when the user really quits: window close requests must then go through
/// instead of hiding the windows (see lib.rs on_window_event).
pub static QUITTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Really exits NEXUS (tray "Quit", Companion "Quit").
pub fn quit(app: &AppHandle, nx: &Nexus, source: &str) {
    if nx.agent_running.load(std::sync::atomic::Ordering::SeqCst) {
        crate::commands::do_stop(nx, source);
    }
    nx.log(crate::state::Activity { kind: "system".into(), action: format!("NEXUS quit ({source})"), status: "ok".into(), ..Default::default() });
    QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
    app.exit(0);
    // Safety net: if something keeps the event loop alive, end the process anyway.
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(2500));
        std::process::exit(0);
    });
}

pub fn show_main(app: &AppHandle, page: Option<&str>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    if let Some(p) = page {
        let _ = app.emit("nexus://navigate", serde_json::json!({"page": p, "arg": null}));
    }
}

fn companion_visible(app: &AppHandle) -> bool {
    app.get_webview_window(crate::companion::LABEL).and_then(|w| w.is_visible().ok()).unwrap_or(false)
}

/// Updates labels/check marks to the real current state.
pub fn refresh(nx: &Nexus) {
    let g = ITEMS.lock().unwrap();
    let Some(i) = g.as_ref() else { return };
    let visible = companion_visible(&nx.app);
    let _ = i.companion.set_text(if visible { "Masquer le Companion" } else { "Afficher le Companion" });
    let _ = i.voice.set_checked(nx.settings().voice_enabled);
    let stopped = nx.control.is_stopped();
    let _ = i.stop.set_enabled(!stopped);
    let _ = i.rearm.set_enabled(stopped);
}

pub fn init(app: &AppHandle, nx: &Arc<Nexus>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Afficher NEXUS", true, None::<&str>)?;
    let companion = MenuItem::with_id(app, "companion", "Afficher le Companion", true, None::<&str>)?;
    let voice = CheckMenuItem::with_id(app, "voice", "Vocal activé", true, nx.settings().voice_enabled, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "STOP NEXUS", true, None::<&str>)?;
    let rearm = MenuItem::with_id(app, "rearm", "Réarmer NEXUS", false, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Paramètres", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quitter NEXUS", true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(app, &[&show, &companion, &sep()?, &voice, &sep()?, &stop, &rearm, &sep()?, &settings, &quit_item])?;

    *ITEMS.lock().unwrap() = Some(Items { companion, voice, stop, rearm });

    let mut b = TrayIconBuilder::with_id("nexus")
        .tooltip("NEXUS")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| {
            let Some(nx) = app.try_state::<Arc<Nexus>>() else { return };
            let nx = nx.inner().clone();
            match ev.id().as_ref() {
                "show" => show_main(app, None),
                "companion" => {
                    if companion_visible(app) {
                        crate::companion::hide_window(&nx);
                    } else {
                        crate::companion::reveal(app);
                    }
                }
                "voice" => {
                    let mut s = nx.settings();
                    s.voice_enabled = !s.voice_enabled;
                    if let Err(err) = crate::commands::apply_settings(&nx, s) {
                        nx.log(crate::state::Activity { kind: "system".into(), action: "Voice toggle from the tray failed".into(), status: "error".into(), error: Some(err), ..Default::default() });
                    }
                }
                "stop" => crate::commands::do_stop(&nx, "tray menu"),
                "rearm" => crate::commands::do_rearm(&nx),
                "settings" => show_main(app, Some("settings")),
                "quit" => self::quit(app, &nx, "tray menu"),
                _ => {}
            }
            refresh(&nx);
        })
        .on_tray_icon_event(|tray, ev| {
            // Left click: bring NEXUS back.
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                show_main(tray.app_handle(), None);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        b = b.icon(icon.clone());
    }
    b.build(app)?;
    refresh(nx);
    Ok(())
}
