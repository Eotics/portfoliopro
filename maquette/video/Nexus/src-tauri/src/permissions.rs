//! Permission policy. `decide` is a pure function so the whole policy is unit
//! tested; the AI model never influences it except through the tool it asks for.

use crate::db::{now, Db};
use crate::settings::Mode;
use anyhow::Result;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Risk {
    Low,
    Medium,
    High,
}

impl Risk {
    pub fn as_str(&self) -> &'static str {
        match self {
            Risk::Low => "LOW",
            Risk::Medium => "MEDIUM",
            Risk::High => "HIGH",
        }
    }
}

/// Read tools only observe; Act tools change something on the machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Read,
    Act,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScopeStatus {
    Default,
    Always,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppStatus {
    Ask,
    Allowed,
    Blocked,
}

pub struct ScopeDef {
    pub scope: &'static str,
    pub description: &'static str,
    pub risk: Risk,
}

pub const SCOPES: &[ScopeDef] = &[
    ScopeDef { scope: "desktop.read", description: "See the screen, monitors, windows and cursor position", risk: Risk::Low },
    ScopeDef { scope: "desktop.control", description: "Launch, focus and close applications and windows", risk: Risk::Low },
    ScopeDef { scope: "desktop.mouse", description: "Move the mouse, click, drag and scroll", risk: Risk::Medium },
    ScopeDef { scope: "desktop.keyboard", description: "Type text and press keys or shortcuts", risk: Risk::Medium },
    ScopeDef { scope: "filesystem.read", description: "List, read and search files in authorized folders", risk: Risk::Low },
    ScopeDef { scope: "filesystem.write", description: "Create, modify, rename, move and copy files", risk: Risk::Medium },
    ScopeDef { scope: "filesystem.delete", description: "Move files to the Recycle Bin", risk: Risk::High },
    ScopeDef { scope: "browser.read", description: "Download and read web pages", risk: Risk::Low },
    ScopeDef { scope: "browser.control", description: "Open websites and run searches in a browser", risk: Risk::Low },
    ScopeDef { scope: "calendar.read", description: "Read Microsoft Calendar events", risk: Risk::Low },
    ScopeDef { scope: "calendar.write", description: "Create, update and delete Microsoft Calendar events", risk: Risk::Medium },
    ScopeDef { scope: "system.read", description: "Read CPU, memory, battery, processes and installed apps", risk: Risk::Low },
    ScopeDef { scope: "code.execute", description: "Run a project's test suite (executes the project's code)", risk: Risk::High },
    ScopeDef { scope: "memory.write", description: "Save or delete things NEXUS remembers about you", risk: Risk::Low },
];

/// Scopes where acting on attacker-controlled content could destroy or leak data.
const TAINT_SENSITIVE: &[&str] = &["filesystem.write", "filesystem.delete", "calendar.write", "code.execute"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Decision {
    Allow { reason: String },
    Ask { reason: String, allow_always: bool },
    Deny { reason: String },
}

pub struct DecideInput<'a> {
    pub stopped: bool,
    pub mode: Mode,
    pub kind: Kind,
    pub risk: Risk,
    pub scope: &'a str,
    pub scope_status: ScopeStatus,
    pub app_status: Option<AppStatus>,
    pub outside_workspace: bool,
    pub tainted: bool,
    pub medium_requires_approval: bool,
    pub hard_deny: Option<String>,
}

pub fn decide(i: &DecideInput) -> Decision {
    let allow = |r: &str| Decision::Allow { reason: r.into() };
    let ask = |r: &str, a: bool| Decision::Ask { reason: r.into(), allow_always: a };
    let deny = |r: &str| Decision::Deny { reason: r.into() };

    if let Some(r) = &i.hard_deny {
        return deny(r);
    }
    if i.stopped {
        return deny("NEXUS is stopped. Re-arm NEXUS before it can act again.");
    }
    if i.scope_status == ScopeStatus::Deny {
        return deny(&format!("Permission '{}' is denied in Permissions.", i.scope));
    }
    if i.app_status == Some(AppStatus::Blocked) {
        return deny("This application is blocked in Permissions → Applications.");
    }
    if i.mode == Mode::Manual && i.kind == Kind::Act {
        return deny("MANUAL mode: NEXUS may observe but not act. Switch to AI or CO-PILOT mode.");
    }
    if i.kind == Kind::Read && i.risk == Risk::Low && !i.outside_workspace {
        return allow("Read-only action within granted scope");
    }
    if i.outside_workspace {
        return ask("The path is outside your authorized folders.", false);
    }
    if i.mode == Mode::Copilot && i.kind == Kind::Act {
        return ask("CO-PILOT mode: every action needs your confirmation.", false);
    }
    if i.tainted && (i.risk == Risk::High || (i.risk == Risk::Medium && TAINT_SENSITIVE.contains(&i.scope))) {
        return ask(
            "NEXUS has read untrusted content (web page, file or screen) during this task, so this action needs your confirmation.",
            false,
        );
    }
    if i.app_status == Some(AppStatus::Ask) {
        return ask("NEXUS has not been allowed to control this application yet.", true);
    }
    if i.scope_status == ScopeStatus::Always {
        return allow("Always allowed in Permissions");
    }
    if i.app_status == Some(AppStatus::Allowed) {
        return allow("Application is allowed");
    }
    match i.risk {
        Risk::Low => allow("Low-risk action"),
        Risk::Medium if !i.medium_requires_approval => allow("Medium-risk actions are auto-approved in Settings"),
        Risk::Medium => ask("Medium-risk action", true),
        Risk::High => ask("High-risk action", true),
    }
}

pub fn scope_status(db: &Db, scope: &str) -> ScopeStatus {
    db.with(|c| c.query_row("SELECT status FROM permissions WHERE scope=?1", [scope], |r| r.get::<_, String>(0)).optional())
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_value(serde_json::Value::String(s)).ok())
        .unwrap_or(ScopeStatus::Default)
}

pub fn set_scope_status(db: &Db, scope: &str, status: ScopeStatus) -> Result<()> {
    let s = serde_json::to_value(status)?.as_str().unwrap_or("default").to_string();
    db.with(|c| {
        c.execute(
            "INSERT INTO permissions(scope,status) VALUES(?1,?2) ON CONFLICT(scope) DO UPDATE SET status=excluded.status",
            params![scope, s],
        )
    })?;
    Ok(())
}

pub fn touch_scope(db: &Db, scope: &str) {
    let _ = db.with(|c| {
        c.execute(
            "INSERT INTO permissions(scope,status,last_used,use_count) VALUES(?1,'default',?2,1)
             ON CONFLICT(scope) DO UPDATE SET last_used=excluded.last_used, use_count=use_count+1",
            params![scope, now()],
        )
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> DecideInput<'static> {
        DecideInput {
            stopped: false,
            mode: Mode::Ai,
            kind: Kind::Act,
            risk: Risk::Low,
            scope: "desktop.control",
            scope_status: ScopeStatus::Default,
            app_status: None,
            outside_workspace: false,
            tainted: false,
            medium_requires_approval: true,
            hard_deny: None,
        }
    }

    fn is_allow(d: &Decision) -> bool { matches!(d, Decision::Allow { .. }) }
    fn is_deny(d: &Decision) -> bool { matches!(d, Decision::Deny { .. }) }
    fn asks(d: &Decision, always: bool) -> bool {
        matches!(d, Decision::Ask { allow_always, .. } if *allow_always == always)
    }

    #[test]
    fn low_risk_runs_automatically_in_ai_mode() {
        assert!(is_allow(&decide(&base())));
    }

    #[test]
    fn stop_blocks_everything_even_always_allowed() {
        let i = DecideInput { stopped: true, scope_status: ScopeStatus::Always, kind: Kind::Read, ..base() };
        assert!(is_deny(&decide(&i)));
    }

    #[test]
    fn manual_mode_blocks_actions_but_not_reads() {
        assert!(is_deny(&decide(&DecideInput { mode: Mode::Manual, ..base() })));
        assert!(is_allow(&decide(&DecideInput { mode: Mode::Manual, kind: Kind::Read, ..base() })));
    }

    #[test]
    fn copilot_asks_for_every_action_without_always_option() {
        let i = DecideInput { mode: Mode::Copilot, scope_status: ScopeStatus::Always, ..base() };
        assert!(asks(&decide(&i), false));
    }

    #[test]
    fn medium_and_high_ask_by_default() {
        assert!(asks(&decide(&DecideInput { risk: Risk::Medium, ..base() }), true));
        assert!(asks(&decide(&DecideInput { risk: Risk::High, ..base() }), true));
        assert!(is_allow(&decide(&DecideInput { risk: Risk::Medium, medium_requires_approval: false, ..base() })));
    }

    #[test]
    fn denied_scope_and_blocked_app_are_denied() {
        assert!(is_deny(&decide(&DecideInput { scope_status: ScopeStatus::Deny, kind: Kind::Read, ..base() })));
        assert!(is_deny(&decide(&DecideInput { app_status: Some(AppStatus::Blocked), ..base() })));
    }

    #[test]
    fn unknown_app_asks_and_allowed_app_runs() {
        assert!(asks(&decide(&DecideInput { app_status: Some(AppStatus::Ask), ..base() }), true));
        assert!(is_allow(&decide(&DecideInput { app_status: Some(AppStatus::Allowed), ..base() })));
    }

    #[test]
    fn outside_workspace_always_asks_once_even_for_reads() {
        let i = DecideInput { outside_workspace: true, kind: Kind::Read, scope: "filesystem.read", scope_status: ScopeStatus::Always, ..base() };
        assert!(asks(&decide(&i), false));
    }

    #[test]
    fn taint_overrides_always_for_destructive_scopes() {
        let i = DecideInput { tainted: true, risk: Risk::High, scope: "filesystem.delete", scope_status: ScopeStatus::Always, ..base() };
        assert!(asks(&decide(&i), false));
        let w = DecideInput { tainted: true, risk: Risk::Medium, scope: "filesystem.write", scope_status: ScopeStatus::Always, ..base() };
        assert!(asks(&decide(&w), false));
        // UI clicks after reading the screen keep the user's normal policy.
        let m = DecideInput { tainted: true, risk: Risk::Medium, scope: "desktop.mouse", scope_status: ScopeStatus::Always, ..base() };
        assert!(is_allow(&decide(&m)));
    }

    #[test]
    fn hard_deny_wins() {
        let i = DecideInput { hard_deny: Some("protected".into()), scope_status: ScopeStatus::Always, ..base() };
        assert!(is_deny(&decide(&i)));
    }
}
