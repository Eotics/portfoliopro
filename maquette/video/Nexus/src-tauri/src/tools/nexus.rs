//! NEXUS-internal tools: task planning and memory.

use super::{Assessment, RunCtx, ToolOutput, ToolSpec};
use crate::db::now;
use crate::permissions::{Kind, Risk};
use crate::state::Nexus;
use anyhow::{anyhow, bail, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Arc;

pub fn specs() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "nexus.set_plan",
            description: "Declare or update the step-by-step plan for the current multi-step request before executing it. Each step is a short imperative sentence. Mark progress with completed_steps (count of finished steps).",
            scope: "nexus.internal", risk: Risk::Low, kind: Kind::Read,
            schema: || json!({"type":"object","properties":{"steps":{"type":"array","items":{"type":"string","maxLength":200}},"completed_steps":{"type":"integer","minimum":0}},"required":["steps"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "memory.save",
            description: "Remember a durable fact or preference about the user for future conversations (never secrets, passwords or keys). Optional project name to file it under a project.",
            scope: "memory.write", risk: Risk::Low, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"content":{"type":"string","maxLength":1000},"project":{"type":"string","maxLength":200}},"required":["content"],"additionalProperties":false}),
        },
        ToolSpec {
            name: "memory.list",
            description: "List what NEXUS remembers (long-term and project memories).",
            scope: "nexus.internal", risk: Risk::Low, kind: Kind::Read,
            schema: || json!({"type":"object","properties":{},"additionalProperties":false}),
        },
        ToolSpec {
            name: "memory.delete",
            description: "Forget a memory by id.",
            scope: "memory.write", risk: Risk::Medium, kind: Kind::Act,
            schema: || json!({"type":"object","properties":{"id":{"type":"integer"}},"required":["id"],"additionalProperties":false}),
        },
    ]
}

/// Heuristic secret detector: memory must never become a credential store.
pub fn looks_secret(s: &str) -> bool {
    let pats = [
        r"(?i)\b(password|passwd|mot de passe|mdp|api[_ -]?key|secret|token|bearer|iban|cvv)\b\s*[:=]",
        r"\bsk-[A-Za-z0-9_-]{16,}",
        r"\bgh[pousr]_[A-Za-z0-9]{20,}",
        r"\bAKIA[0-9A-Z]{16}\b",
        r"\b(?:\d[ -]?){13,19}\b",
        r"[A-Za-z0-9+/=_-]{40,}",
    ];
    pats.iter().any(|p| regex::Regex::new(p).map(|re| re.is_match(s)).unwrap_or(false))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRow {
    pub id: i64,
    pub kind: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub content: String,
    pub created_at: String,
}

pub fn list_memory(nx: &Nexus) -> Result<Vec<MemoryRow>> {
    nx.db.with(|c| {
        let mut st = c.prepare(
            "SELECT m.id,m.kind,m.project_id,p.name,m.content,m.created_at FROM memory m LEFT JOIN projects p ON p.id=m.project_id ORDER BY m.id DESC",
        )?;
        let r = st.query_map([], |r| {
            Ok(MemoryRow { id: r.get(0)?, kind: r.get(1)?, project_id: r.get(2)?, project_name: r.get(3)?, content: r.get(4)?, created_at: r.get(5)? })
        })?;
        r.collect()
    })
}

pub fn save_memory(nx: &Nexus, content: &str, project: Option<&str>) -> Result<i64> {
    let content = content.trim();
    if content.is_empty() {
        bail!("Memory content is empty");
    }
    if looks_secret(content) {
        bail!("This looks like a secret (password, key, token or card number). NEXUS does not store secrets in memory.");
    }
    let project_id: Option<String> = match project {
        Some(name) => Some(
            nx.db
                .with(|c| {
                    c.query_row("SELECT id FROM projects WHERE lower(name)=lower(?1)", [name], |r| r.get::<_, String>(0))
                })
                .map_err(|_| anyhow!("No project named '{name}'"))?,
        ),
        None => None,
    };
    let kind = if project_id.is_some() { "project" } else { "long_term" };
    let id = nx.db.with(|c| {
        c.execute("INSERT INTO memory(kind,project_id,content,created_at) VALUES(?1,?2,?3,?4)", rusqlite::params![kind, project_id, content, now()])?;
        Ok(c.last_insert_rowid())
    })?;
    nx.emit("nexus://memory", json!({}));
    Ok(id)
}

pub fn delete_memory(nx: &Nexus, id: i64) -> Result<bool> {
    let n = nx.db.with(|c| c.execute("DELETE FROM memory WHERE id=?1", [id]))?;
    nx.emit("nexus://memory", json!({}));
    Ok(n > 0)
}

pub fn assess(_nx: &Arc<Nexus>, spec: &ToolSpec, input: &Value) -> Result<Assessment> {
    Ok(match spec.name {
        "memory.save" => {
            let c = input.get("content").and_then(|c| c.as_str()).unwrap_or("");
            Assessment::new(spec, "Remember something about you").detail("Memory", c)
        }
        "memory.delete" => Assessment::new(spec, format!("Forget memory #{}", input["id"])),
        "nexus.set_plan" => Assessment::new(spec, "Update the task plan"),
        _ => Assessment::new(spec, "Read memories"),
    })
}

pub async fn call(nx: &Arc<Nexus>, run: &RunCtx, name: &str, input: Value) -> Result<ToolOutput> {
    match name {
        "nexus.set_plan" => {
            let steps: Vec<String> = input["steps"].as_array().map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default();
            if steps.is_empty() || steps.len() > 30 {
                bail!("Provide 1 to 30 steps");
            }
            let done = input.get("completed_steps").and_then(|c| c.as_u64()).unwrap_or(0) as usize;
            let task = super::ensure_task(nx, run);
            let ts = now();
            let progress = (done.min(steps.len()) as f64) / steps.len() as f64;
            nx.db.with(|c| {
                c.execute("DELETE FROM task_steps WHERE task_id=?1 AND tool_run_id IS NULL", [&task])?;
                for (i, st) in steps.iter().enumerate() {
                    let status = if i < done { "COMPLETED" } else if i == done { "RUNNING" } else { "PLANNED" };
                    c.execute(
                        "INSERT INTO task_steps(task_id,idx,title,status,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5)",
                        rusqlite::params![task, i as i64, st, status, ts],
                    )?;
                }
                c.execute("UPDATE tasks SET progress=?1, updated_at=?2 WHERE id=?3", rusqlite::params![progress, ts, task])?;
                Ok(())
            })?;
            nx.emit("nexus://plan", json!({"conversationId": run.conversation_id, "taskId": task, "steps": steps, "completed": done}));
            nx.emit("nexus://tasks", json!({"id": task}));
            Ok(ToolOutput::new(format!("Plan with {} step(s), {} done", steps.len(), done.min(steps.len())), json!({"taskId": task})))
        }
        "memory.save" => {
            let content = input.get("content").and_then(|c| c.as_str()).unwrap_or("");
            if !nx.settings().memory_enabled {
                bail!("Memory is disabled in Settings");
            }
            let id = save_memory(nx, content, input.get("project").and_then(|p| p.as_str()))?;
            Ok(ToolOutput::new(format!("Remembered (#{id})"), json!({"id": id})).verified(true))
        }
        "memory.list" => {
            let m = list_memory(nx)?;
            Ok(ToolOutput::new(format!("{} memories", m.len()), json!(m)))
        }
        "memory.delete" => {
            let id = input["id"].as_i64().unwrap_or(-1);
            if !delete_memory(nx, id)? {
                bail!("No memory with id {id}");
            }
            Ok(ToolOutput::new(format!("Forgot memory #{id}"), json!({})).verified(true))
        }
        _ => Err(anyhow!("Tool {name} is not implemented")),
    }
}

#[cfg(test)]
mod tests {
    use super::looks_secret;

    #[test]
    fn detects_secrets() {
        assert!(looks_secret("my password: hunter2"));
        assert!(looks_secret("sk-ant-api03-abcdefghijklmnopqrstuvwxyz"));
        assert!(looks_secret("card 4111 1111 1111 1111"));
        assert!(!looks_secret("Prefers dark mode and answers in French"));
        assert!(!looks_secret("Uses Opera GX as the main browser"));
    }
}
