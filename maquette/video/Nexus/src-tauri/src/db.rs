//! SQLite persistence. One connection behind a mutex: every query NEXUS makes is
//! short, and serialising them keeps migrations and writes trivially consistent.

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::path::Path;
use std::sync::{Arc, Mutex};

const MIGRATIONS: &[&str] = &[
    // 1 — initial schema
    r#"
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE permissions (
        scope TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'default',   -- default | always | deny
        last_used TEXT,
        use_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE applications (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        exe_path TEXT,
        launch_target TEXT NOT NULL,
        launch_args TEXT,
        source TEXT NOT NULL,
        install_dir TEXT,
        expected_process TEXT,
        status TEXT NOT NULL DEFAULT 'ask',        -- ask | allowed | blocked
        last_seen TEXT NOT NULL
    );
    CREATE TABLE workspaces (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE messages (
        id INTEGER PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX idx_messages_conv ON messages(conversation_id, id);
    CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE project_files (
        id INTEGER PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        added_at TEXT NOT NULL
    );
    CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        project_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        due_date TEXT,
        progress REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE task_steps (
        id INTEGER PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        idx INTEGER NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        tool_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE tool_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        conversation_id TEXT,
        tool TEXT NOT NULL,
        input TEXT NOT NULL,
        status TEXT NOT NULL,
        risk TEXT NOT NULL,
        permission TEXT NOT NULL,
        decision TEXT,
        summary TEXT,
        result TEXT,
        error TEXT,
        verified INTEGER,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_ms INTEGER
    );
    CREATE INDEX idx_tool_runs_conv ON tool_runs(conversation_id);
    CREATE TABLE activity_logs (
        id INTEGER PRIMARY KEY,
        ts TEXT NOT NULL,
        kind TEXT NOT NULL,
        action TEXT NOT NULL,
        tool TEXT,
        status TEXT NOT NULL,
        risk TEXT,
        permission TEXT,
        result TEXT,
        error TEXT,
        task_id TEXT
    );
    CREATE INDEX idx_activity_ts ON activity_logs(ts DESC);
    CREATE TABLE memory (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,                        -- long_term | project
        project_id TEXT,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE automations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        trigger TEXT NOT NULL,
        prompt TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run TEXT,
        last_status TEXT,
        created_at TEXT NOT NULL
    );
    CREATE TABLE calendar_cache (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        fetched_at TEXT NOT NULL
    );
    "#,
    // 2 — honest task verdicts
    r#"
    ALTER TABLE tasks ADD COLUMN outcome TEXT;
    "#,
    // 3 — Companion Studio
    r#"
    CREATE TABLE companion_combos (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        current_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE companion_combo_versions (
        combo_id TEXT NOT NULL REFERENCES companion_combos(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (combo_id, version)
    );
    CREATE TABLE companion_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE companion_asset_meta (
        asset_id TEXT PRIMARY KEY,
        favorite INTEGER NOT NULL DEFAULT 0,
        last_used TEXT
    );
    "#,
];

#[derive(Clone)]
pub struct Db(Arc<Mutex<Connection>>);

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path).with_context(|| format!("opening {}", path.display()))?;
        Self::init(conn)
    }

    #[cfg(test)]
    pub fn memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")?;
        let version: usize = conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? as usize;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(version) {
            conn.execute_batch(&format!("BEGIN; {sql}; PRAGMA user_version = {}; COMMIT;", i + 1))
                .with_context(|| format!("migration {}", i + 1))?;
        }
        Ok(Db(Arc::new(Mutex::new(conn))))
    }

    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T> {
        let conn = self.0.lock().map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
        Ok(f(&conn)?)
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<Value>> {
        let raw: Option<String> = self.with(|c| {
            c.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0)).optional()
        })?;
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn set_setting(&self, key: &str, value: &Value) -> Result<()> {
        let s = value.to_string();
        self.with(|c| {
            c.execute(
                "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![key, s],
            )
        })?;
        Ok(())
    }
}

pub fn now() -> String {
    chrono::Local::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_and_settings_roundtrip() {
        let db = Db::memory().unwrap();
        let v: i64 = db.with(|c| c.query_row("PRAGMA user_version", [], |r| r.get(0))).unwrap();
        assert_eq!(v as usize, MIGRATIONS.len());
        db.set_setting("x", &serde_json::json!({"a": 1})).unwrap();
        assert_eq!(db.get_setting("x").unwrap().unwrap()["a"], 1);
        assert!(db.get_setting("missing").unwrap().is_none());
    }
}
