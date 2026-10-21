//! Emergency stop, control mode and agent status.
//!
//! STOP is not a UI flag: it cancels the shared CancellationToken that every
//! agent loop, pending approval, HTTP stream and input-automation loop selects
//! on, and it latches `stopped` so no new privileged tool can start until the
//! user explicitly re-arms NEXUS.

use crate::settings::Mode;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentStatus {
    Idle,
    Thinking,
    Planning,
    WaitingPermission,
    Executing,
    Verifying,
    Completed,
    Error,
    Stopped,
}

pub struct Control {
    stopped: AtomicBool,
    token: Mutex<CancellationToken>,
    mode: RwLock<Mode>,
    status: Mutex<AgentStatus>,
}

impl Control {
    pub fn new(mode: Mode) -> Self {
        Control {
            stopped: AtomicBool::new(false),
            token: Mutex::new(CancellationToken::new()),
            mode: RwLock::new(mode),
            status: Mutex::new(AgentStatus::Idle),
        }
    }

    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    /// Token for a unit of work. Captured at start so a STOP that happens later
    /// is still observed after a re-arm hands out a fresh token.
    pub fn token(&self) -> CancellationToken {
        self.token.lock().unwrap().clone()
    }

    /// Returns true if this call transitioned NEXUS into the stopped state.
    pub fn stop(&self) -> bool {
        let was = self.stopped.swap(true, Ordering::SeqCst);
        self.token.lock().unwrap().cancel();
        !was
    }

    pub fn rearm(&self) {
        let mut t = self.token.lock().unwrap();
        if t.is_cancelled() {
            *t = CancellationToken::new();
        }
        self.stopped.store(false, Ordering::SeqCst);
    }

    pub fn mode(&self) -> Mode {
        *self.mode.read().unwrap()
    }

    pub fn set_mode(&self, m: Mode) {
        *self.mode.write().unwrap() = m;
    }

    pub fn status(&self) -> AgentStatus {
        *self.status.lock().unwrap()
    }

    pub fn set_status(&self, s: AgentStatus) {
        *self.status.lock().unwrap() = s;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_cancels_outstanding_tokens_and_latches() {
        let c = Control::new(Mode::Ai);
        let t = c.token();
        assert!(!t.is_cancelled());
        assert!(c.stop());
        assert!(t.is_cancelled());
        assert!(c.is_stopped());
        assert!(c.token().is_cancelled(), "no fresh token until re-armed");
        assert!(!c.stop(), "second stop is not a transition");
        c.rearm();
        assert!(!c.is_stopped());
        assert!(!c.token().is_cancelled());
        assert!(t.is_cancelled(), "old work stays cancelled after re-arm");
    }
}
