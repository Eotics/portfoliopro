//! User-facing configuration, stored as one JSON document in the settings table.

use crate::db::Db;
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Mode {
    Manual,
    Ai,
    Copilot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub ai_provider: String,
    pub anthropic_model: String,
    pub openai_model: String,
    pub effort: String,
    pub temperature: Option<f32>,
    pub medium_requires_approval: bool,
    pub default_mode: Mode,
    pub stream_max_width: u32,
    pub stream_quality: u8,
    pub ai_screenshot_max_width: u32,
    pub default_browser: String,
    pub search_engine: String,
    pub memory_enabled: bool,
    pub animations: bool,
    pub density: String,
    pub language: String,
    pub calendar_client_id: String,
    // Companion
    pub companion_enabled: bool,
    pub companion_show_on_start: bool,
    pub companion_always_on_top: bool,
    pub companion_position: Option<(i32, i32)>,
    pub companion_animation: String,
    pub companion_sounds: bool,
    pub companion_accent: String,
    pub companion_actions: Vec<String>,
    pub companion_shortcut: String,
    pub start_with_windows: bool,
    /// Closing the main window keeps NEXUS running in the notification area.
    pub close_to_tray: bool,
    /// Start with only the tray icon (and the Companion if enabled), no main window.
    pub start_minimized: bool,
    // Voice (off by default; the microphone only opens on explicit user action)
    pub voice_enabled: bool,
    pub voice_model: String,
    pub voice_shortcut: String,
    pub voice_speak_replies: bool,
    pub voice_name: String,
    pub voice_rate: f32,
    /// Input device name; empty = Windows default microphone.
    pub voice_device: String,
    /// Spoken replies volume, 0-100.
    pub voice_volume: u32,
    pub voice_muted: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            ai_provider: "anthropic".into(),
            anthropic_model: "claude-opus-5".into(),
            openai_model: String::new(),
            effort: "medium".into(),
            temperature: None,
            medium_requires_approval: true,
            default_mode: Mode::Ai,
            stream_max_width: 1600,
            stream_quality: 70,
            ai_screenshot_max_width: 1366,
            default_browser: "system".into(),
            search_engine: "google".into(),
            memory_enabled: true,
            animations: true,
            density: "comfortable".into(),
            language: "fr".into(),
            calendar_client_id: String::new(),
            companion_enabled: true,
            companion_show_on_start: true,
            companion_always_on_top: true,
            companion_position: None,
            companion_animation: "full".into(),
            companion_sounds: false,
            companion_accent: "sky".into(),
            companion_actions: ["home", "chat", "task", "files", "control", "settings"].iter().map(|s| s.to_string()).collect(),
            companion_shortcut: "Ctrl+Alt+N".into(),
            start_with_windows: false,
            close_to_tray: true,
            start_minimized: false,
            voice_enabled: false,
            voice_model: "small".into(),
            voice_shortcut: "Ctrl+Alt+V".into(),
            voice_speak_replies: true,
            voice_name: String::new(),
            voice_rate: 1.0,
            voice_device: String::new(),
            voice_volume: 100,
            voice_muted: false,
        }
    }
}

const KEY: &str = "app";

pub fn load(db: &Db) -> Settings {
    db.get_setting(KEY)
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

pub fn save(db: &Db, s: &Settings) -> Result<()> {
    db.set_setting(KEY, &serde_json::to_value(s)?)
}
