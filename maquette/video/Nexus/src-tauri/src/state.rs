//! The shared NEXUS runtime: database, control, approvals, event emission, logging.

use crate::control::{AgentStatus, Control};
use crate::db::{now, Db};
use crate::permissions::Risk;
use crate::settings::{self, Settings};
use crate::win::system::SysMon;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, RwLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub kind: String,
    pub action: String,
    pub tool: Option<String>,
    pub status: String,
    pub risk: Option<String>,
    pub permission: Option<String>,
    pub result: Option<String>,
    pub error: Option<String>,
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalChoice {
    Deny,
    Once,
    Always,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: String,
    pub tool: String,
    pub summary: String,
    pub details: Vec<(String, String)>,
    pub risk: Risk,
    pub scope: String,
    pub reason: String,
    pub allow_always: bool,
    pub task_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    pub monitor: usize,
    /// Normalised 0..1 coordinates on the monitor, so any preview size can draw it.
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub label: String,
    pub screen_x: i32,
    pub screen_y: i32,
}

pub struct Nexus {
    pub app: AppHandle,
    pub db: Db,
    pub control: Control,
    pub sys: SysMon,
    pub http: reqwest::Client,
    pub data_dir: PathBuf,
    pub settings: RwLock<Settings>,
    pub approvals: Mutex<HashMap<String, (ApprovalRequest, oneshot::Sender<ApprovalChoice>)>>,
    /// Size of the last screenshot the AI saw per monitor, used to map its coordinates.
    pub ai_frames: Mutex<HashMap<usize, (u32, u32)>>,
    pub highlight: Mutex<Option<Highlight>>,
    pub agent_running: AtomicBool,
    /// Global shortcut currently bound to toggle the Companion.
    pub companion_shortcut: Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>,
    /// Result of the last real AI connection test in this session.
    pub ai_test: Mutex<Option<Value>>,
    pub last_pos_save: Mutex<std::time::Instant>,
    pub voice: crate::voice::Voice,
    pub studio: crate::studio::Studio,
    /// Global push-to-talk shortcut currently bound.
    pub voice_shortcut: Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>,
}

impl Nexus {
    pub fn new(app: AppHandle, db: Db, data_dir: PathBuf) -> Self {
        let s = settings::load(&db);
        Nexus {
            control: Control::new(s.default_mode),
            app,
            db,
            sys: SysMon::new(),
            http: reqwest::Client::builder()
                .user_agent("NEXUS/0.1 (Windows desktop agent)")
                .connect_timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("http client"),
            data_dir,
            settings: RwLock::new(s),
            approvals: Mutex::new(HashMap::new()),
            ai_frames: Mutex::new(HashMap::new()),
            highlight: Mutex::new(None),
            agent_running: AtomicBool::new(false),
            companion_shortcut: Mutex::new(None),
            ai_test: Mutex::new(None),
            last_pos_save: Mutex::new(std::time::Instant::now()),
            voice: Default::default(),
            studio: Default::default(),
            voice_shortcut: Mutex::new(None),
        }
    }

    pub fn settings(&self) -> Settings {
        self.settings.read().unwrap().clone()
    }

    pub fn emit<S: Serialize + Clone>(&self, event: &str, payload: S) {
        let _ = self.app.emit(event, payload);
    }

    pub fn set_status(&self, s: AgentStatus) {
        // STOPPED is sticky until re-arm so a finishing loop can't hide it.
        if self.control.is_stopped() && s != AgentStatus::Stopped {
            return;
        }
        self.control.set_status(s);
        self.emit("nexus://status", s);
    }

    pub fn log(&self, a: Activity) {
        let ts = now();
        let _ = self.db.with(|c| {
            c.execute(
                "INSERT INTO activity_logs(ts,kind,action,tool,status,risk,permission,result,error,task_id)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                rusqlite::params![ts, a.kind, a.action, a.tool, a.status, a.risk, a.permission, a.result, a.error, a.task_id],
            )
        });
        let mut v = serde_json::to_value(&a).unwrap_or(Value::Null);
        v["ts"] = Value::String(ts);
        self.emit("nexus://activity", v);
    }
}
