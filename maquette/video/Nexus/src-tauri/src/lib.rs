mod agent;
mod commands;
mod companion;
mod control;
mod db;
mod permissions;
mod secrets;
mod settings;
mod state;
mod studio;
mod tools;
mod tray;
mod tts;
mod voice;
mod win;

use state::{Activity, Nexus};
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub fn run() {
    let stop_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Backspace);

    tauri::Builder::default()
        // Launching NEXUS again (Start menu, desktop) brings the running one back.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| tray::show_main(app, None)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, sc, ev| {
                    // Push-to-talk: hold to speak, release to transcribe and send.
                    if let Some(nx) = app.try_state::<Arc<Nexus>>() {
                        if nx.voice_shortcut.lock().unwrap().as_ref() == Some(sc) {
                            let nx = nx.inner().clone();
                            if ev.state() == ShortcutState::Pressed {
                                companion::reveal(app);
                                if let Err(err) = voice::start(&nx, false) {
                                    nx.emit("nexus://voice", serde_json::json!({"type": "error", "message": err}));
                                }
                            } else {
                                tauri::async_runtime::spawn(async move {
                                    match voice::stop(&nx).await {
                                        Ok(text) => nx.emit("nexus://voice", serde_json::json!({"type": "ptt", "text": text})),
                                        Err(err) => nx.emit("nexus://voice", serde_json::json!({"type": "error", "message": err})),
                                    }
                                });
                            }
                            return;
                        }
                    }
                    if ev.state() != ShortcutState::Pressed {
                        return;
                    }
                    if sc == &stop_shortcut {
                        if let Some(nx) = app.try_state::<Arc<Nexus>>() {
                            commands::do_stop(&nx, "global hotkey Ctrl+Alt+Backspace");
                        }
                    } else if let Some(nx) = app.try_state::<Arc<Nexus>>() {
                        if nx.companion_shortcut.lock().unwrap().as_ref() == Some(sc) {
                            companion::toggle(app);
                        }
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = db::Db::open(&dir.join("nexus.db"))?;
            let nx = Arc::new(Nexus::new(app.handle().clone(), db, dir.clone()));
            if let Err(e) = tools::fs::ensure_default_workspace(&nx) {
                nx.log(Activity { kind: "system".into(), action: "Could not create the default workspace".into(), status: "error".into(), error: Some(e.to_string()), ..Default::default() });
            }
            app.manage(nx.clone());

            if let Err(e) = app.global_shortcut().register(stop_shortcut) {
                nx.log(Activity { kind: "system".into(), action: "STOP hotkey Ctrl+Alt+Backspace could not be registered".into(), status: "error".into(), error: Some(e.to_string()), ..Default::default() });
            }
            nx.log(Activity { kind: "system".into(), action: "NEXUS started".into(), status: "ok".into(), result: Some(format!("Data: {}", dir.display())), ..Default::default() });

            if let Err(e) = studio::install(&nx) {
                nx.log(Activity { kind: "system".into(), action: "Companion asset pack could not be installed".into(), status: "error".into(), error: Some(e.to_string()), ..Default::default() });
            }
            let s = nx.settings();
            companion::apply_settings(&nx, &s, true);
            companion::sync_startup_entry(&s);
            if let Err(e) = tray::init(app.handle(), &nx) {
                nx.log(Activity { kind: "system".into(), action: "Notification-area icon could not be created".into(), status: "error".into(), error: Some(e.to_string()), ..Default::default() });
            }
            // Started by Windows (Run key) or "start minimized": stay in the tray.
            let autostart = std::env::args().any(|a| a == "--autostart");
            if !(autostart || s.start_minimized) {
                tray::show_main(app.handle(), None);
            }

            // Application discovery can take a few seconds (COM + PowerShell).
            let nx2 = nx.clone();
            std::thread::spawn(move || {
                let _ = commands::rescan(&nx2);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if tray::QUITTING.load(std::sync::atomic::Ordering::SeqCst) {
                return; // really quitting: let every window close
            }
            let Some(nx) = window.app_handle().try_state::<Arc<Nexus>>() else { return };
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if nx.settings().close_to_tray {
                        // Keep running in the notification area.
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        window.app_handle().exit(0);
                    }
                }
                return;
            }
            if window.label() != companion::LABEL {
                return;
            }
            match event {
                tauri::WindowEvent::Moved(p) => companion::on_moved(&nx, p.x, p.y),
                // Closing the Companion only hides it; it is reopened from the main window or its shortcut.
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            companion::companion_show,
            companion::companion_hide,
            companion::companion_toggle,
            companion::companion_minimize,
            companion::companion_resize,
            companion::companion_cursor,
            companion::app_quit,
            companion::show_main,
            companion::startup_status,
            companion::import_files,
            companion::list_inbox,
            companion::remove_inbox_file,
            companion::extract_file_text,
            companion::add_file_to_project,
            companion::list_project_files,
            companion::validate_attachments,
            companion::save_draft,
            companion::open_in_mail_client,
            companion::ai_draft,
            companion::integrations_status,
            studio::studio_registry,
            studio::studio_rescan,
            studio::studio_asset_data,
            studio::studio_set_favorite,
            studio::studio_touch,
            studio::studio_import_asset,
            studio::studio_create_asset,
            studio::studio_update_asset,
            studio::studio_duplicate_asset,
            studio::studio_delete_asset,
            studio::studio_export_asset,
            studio::studio_open_folder,
            studio::studio_get_look,
            studio::studio_set_look,
            studio::studio_list_combos,
            studio::studio_save_combo,
            studio::studio_get_combo,
            studio::studio_restore_version,
            studio::studio_duplicate_version,
            studio::studio_delete_version,
            studio::studio_rename_combo,
            studio::studio_delete_combo,
            studio::studio_export_combo,
            studio::studio_import_combo,
            studio::studio_list_profiles,
            studio::studio_save_profile,
            studio::studio_delete_profile,
            studio::studio_activate_profile,
            studio::companion_position,
            voice::voice_status,
            voice::voice_download_model,
            voice::voice_start,
            voice::voice_stop,
            voice::voice_cancel,
            tts::tts_status,
            tts::tts_speak,
            commands::get_state,
            commands::stop_nexus,
            commands::rearm_nexus,
            commands::set_mode,
            commands::list_approvals,
            commands::resolve_approval,
            commands::send_message,
            commands::list_conversations,
            commands::get_conversation,
            commands::delete_conversation,
            commands::list_tool_runs,
            commands::list_tools,
            commands::list_monitors,
            commands::capture_frame,
            commands::screenshot_to_file,
            commands::manual_mouse,
            commands::manual_drag,
            commands::manual_scroll,
            commands::manual_type,
            commands::manual_key,
            commands::manual_hotkey,
            commands::cursor_position,
            commands::get_highlight,
            commands::clear_highlight,
            commands::execute_highlight,
            commands::system_snapshot,
            commands::list_windows,
            commands::list_processes,
            commands::list_apps,
            commands::rescan_apps,
            commands::set_app_status,
            commands::launch_app,
            commands::list_permissions,
            commands::set_permission,
            commands::permission_history,
            commands::list_workspaces,
            commands::add_workspace,
            commands::remove_workspace,
            commands::browse_folder,
            commands::open_path,
            commands::list_activity,
            commands::clear_activity,
            commands::list_tasks,
            commands::get_task,
            commands::delete_task,
            commands::list_memory,
            commands::add_memory,
            commands::delete_memory,
            commands::clear_memory,
            commands::list_projects,
            commands::save_project,
            commands::delete_project,
            commands::get_settings,
            commands::save_settings,
            commands::secret_status,
            commands::set_secret,
            commands::clear_secret,
            commands::test_ai_connection,
            commands::open_url,
            commands::web_search,
            commands::invoke_tool,
        ])
        .run(tauri::generate_context!())
        .expect("error while running NEXUS");
}
