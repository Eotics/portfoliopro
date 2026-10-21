//! Read-only system information tools.

use super::{Assessment, RunCtx, ToolOutput, ToolSpec};
use crate::permissions::{Kind, Risk};
use crate::state::Nexus;
use crate::win::{system, windows as winwin};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::sync::Arc;

fn empty() -> Value {
    json!({"type":"object","properties":{},"additionalProperties":false})
}

pub fn specs() -> Vec<ToolSpec> {
    vec![
        ToolSpec { name: "system.get_info", description: "OS version, host name, CPU model and usage, memory usage, uptime.", scope: "system.read", risk: Risk::Low, kind: Kind::Read, schema: empty },
        ToolSpec { name: "system.get_battery", description: "Battery level and charging state.", scope: "system.read", risk: Risk::Low, kind: Kind::Read, schema: empty },
        ToolSpec {
            name: "system.running_processes",
            description: "List running processes (name, pid, memory), largest first. Optional case-insensitive name filter.",
            scope: "system.read", risk: Risk::Low, kind: Kind::Read,
            schema: || json!({"type":"object","properties":{"filter":{"type":"string","maxLength":100},"limit":{"type":"integer","minimum":1,"maximum":300}},"additionalProperties":false}),
        },
        ToolSpec {
            name: "system.list_installed_applications",
            description: "List applications NEXUS discovered on this PC (Start Menu and Microsoft Store), with running state and permission status. Optional name filter.",
            scope: "system.read", risk: Risk::Low, kind: Kind::Read,
            schema: || json!({"type":"object","properties":{"filter":{"type":"string","maxLength":100}},"additionalProperties":false}),
        },
        ToolSpec { name: "system.get_active_window", description: "The window currently in the foreground.", scope: "system.read", risk: Risk::Low, kind: Kind::Read, schema: empty },
    ]
}

pub fn assess(_nx: &Arc<Nexus>, spec: &ToolSpec, _input: &Value) -> Result<Assessment> {
    Ok(Assessment::new(spec, spec.description.split(['.', ',']).next().unwrap_or(spec.name).to_string()))
}

pub async fn call(nx: &Arc<Nexus>, _run: &RunCtx, name: &str, input: Value) -> Result<ToolOutput> {
    let filter = input.get("filter").and_then(|f| f.as_str()).map(|s| s.to_lowercase());
    match name {
        "system.get_info" => {
            let s = nx.sys.snapshot();
            Ok(ToolOutput::new(
                format!("CPU {:.0}%, RAM {:.1}/{:.1} GB", s.cpu_percent, s.memory_used as f64 / 1e9, s.memory_total as f64 / 1e9),
                json!(s),
            ))
        }
        "system.get_battery" => {
            let b = system::battery();
            let summary = match b.percent {
                Some(p) => format!("Battery {p}%{}", if b.charging { " (charging)" } else { "" }),
                None => "No battery detected (desktop PC or unavailable)".into(),
            };
            Ok(ToolOutput::new(summary, json!(b)))
        }
        "system.running_processes" => {
            let limit = input.get("limit").and_then(|l| l.as_u64()).unwrap_or(60) as usize;
            let p: Vec<_> = nx
                .sys
                .processes()
                .into_iter()
                .filter(|p| filter.as_ref().map(|f| p.name.to_lowercase().contains(f)).unwrap_or(true))
                .take(limit)
                .map(|p| json!({"pid": p.pid, "name": p.name, "memoryMB": p.memory / 1_048_576}))
                .collect();
            Ok(ToolOutput::new(format!("{} process(es)", p.len()), json!(p)))
        }
        "system.list_installed_applications" => {
            let apps: Vec<_> = super::desktop::list_apps(nx)?
                .into_iter()
                .filter(|a| filter.as_ref().map(|f| a.name.to_lowercase().contains(f)).unwrap_or(true))
                .map(|a| json!({"name": a.name, "source": a.source, "running": a.running, "permission": a.status}))
                .collect();
            Ok(ToolOutput::new(format!("{} installed application(s)", apps.len()), json!(apps)))
        }
        "system.get_active_window" => {
            let w = winwin::foreground();
            Ok(ToolOutput::new(
                w.as_ref().map(|w| format!("Active: {} ({})", w.title, w.process)).unwrap_or("No foreground window".into()),
                json!(w),
            )
            .untrusted())
        }
        _ => Err(anyhow!("Tool {name} is not implemented")),
    }
}
