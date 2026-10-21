//! Coding tools: run a project's test suite.
//!
//! Not a shell: the model picks a runner from a fixed list and an optional
//! name filter; NEXUS builds the command itself. The project folder must be
//! inside an authorized workspace. Running tests executes project code, so
//! this is HIGH risk and asks for confirmation by default.

use super::{Assessment, RunCtx, ToolOutput, ToolSpec};
use crate::permissions::{Kind, Risk};
use crate::state::Nexus;
use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const RUNNERS: &[&str] = &["cargo", "npm", "pnpm", "yarn", "vitest", "pytest", "go", "dotnet"];

pub fn specs() -> Vec<ToolSpec> {
    vec![ToolSpec {
        name: "code.run_tests",
        description: "Run the test suite of a project folder inside an authorized workspace and return the real exit code and output. runner: cargo | npm | pnpm | yarn | vitest | pytest | go | dotnet (omit to auto-detect). Optional filter = test name filter.",
        scope: "code.execute",
        risk: Risk::High,
        kind: Kind::Act,
        schema: || json!({"type":"object","properties":{
            "path":{"type":"string","maxLength":1000},
            "runner":{"type":"string","enum":RUNNERS},
            "filter":{"type":"string","maxLength":100}
        },"required":["path"],"additionalProperties":false}),
    }]
}

pub fn detect_runner(dir: &Path) -> Option<&'static str> {
    let has = |f: &str| dir.join(f).exists();
    if has("Cargo.toml") {
        return Some("cargo");
    }
    if has("package.json") {
        let pkg = std::fs::read_to_string(dir.join("package.json")).unwrap_or_default();
        if has("pnpm-lock.yaml") {
            return Some("pnpm");
        }
        if has("yarn.lock") {
            return Some("yarn");
        }
        if !pkg.contains("\"test\"") && pkg.contains("vitest") {
            return Some("vitest");
        }
        return Some("npm");
    }
    if has("go.mod") {
        return Some("go");
    }
    if has("pytest.ini") || has("pyproject.toml") || has("setup.cfg") || has("tests") {
        return Some("pytest");
    }
    let dotnet = std::fs::read_dir(dir).ok()?.flatten().any(|e| {
        let n = e.file_name().to_string_lossy().to_lowercase();
        n.ends_with(".sln") || n.ends_with(".csproj")
    });
    dotnet.then_some("dotnet")
}

fn valid_filter(f: &str) -> bool {
    !f.is_empty() && f.chars().all(|c| c.is_ascii_alphanumeric() || "_:./-".contains(c)) && !f.starts_with('-')
}

/// (program, args) — never a shell string.
pub fn command_for(runner: &str, filter: Option<&str>) -> Result<(String, Vec<String>)> {
    if let Some(f) = filter {
        if !valid_filter(f) {
            bail!("filter may only contain letters, digits and _ : . / - and must not start with '-'");
        }
    }
    let f = filter.map(String::from);
    let (prog, mut args): (&str, Vec<String>) = match runner {
        "cargo" => ("cargo", vec!["test".into()]),
        "npm" => ("npm.cmd", vec!["test".into()]),
        "pnpm" => ("pnpm.cmd", vec!["test".into()]),
        "yarn" => ("yarn.cmd", vec!["test".into()]),
        "vitest" => ("npx.cmd", vec!["--no-install".into(), "vitest".into(), "run".into()]),
        "pytest" => ("python", vec!["-m".into(), "pytest".into(), "-q".into()]),
        "go" => ("go", vec!["test".into(), "./...".into()]),
        "dotnet" => ("dotnet", vec!["test".into()]),
        other => bail!("Unknown test runner '{other}'"),
    };
    if let Some(f) = f {
        match runner {
            "cargo" | "vitest" => args.push(f),
            "pytest" => args.extend(["-k".into(), f]),
            "go" => args.extend(["-run".into(), f]),
            "dotnet" => args.extend(["--filter".into(), f]),
            _ => bail!("A test filter is not supported for {runner}"),
        }
    }
    Ok((prog.to_string(), args))
}

fn tail(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut start = s.len() - max;
    while !s.is_char_boundary(start) {
        start += 1;
    }
    format!("… (output truncated) …\n{}", &s[start..])
}

pub fn assess(nx: &Arc<Nexus>, spec: &ToolSpec, input: &Value) -> Result<Assessment> {
    let r = super::fs::resolve(nx, input.get("path").and_then(|p| p.as_str()))?;
    if !r.path.is_dir() {
        bail!("{} is not a project folder", r.path.display());
    }
    let runner = match input.get("runner").and_then(|r| r.as_str()) {
        Some(x) => x,
        None => detect_runner(&r.path).ok_or_else(|| anyhow!("Could not detect a test runner in {}; pass runner explicitly", r.path.display()))?,
    };
    let (prog, args) = command_for(runner, input.get("filter").and_then(|f| f.as_str()))?;
    let mut a = Assessment::new(spec, format!("Run {runner} tests in {}", r.path.display()))
        .detail("Folder", r.path.display().to_string())
        .detail("Command", format!("{prog} {}", args.join(" ")))
        .detail("Consequence", "Executes the project's own test code on this PC");
    if !r.inside {
        // Executing code from arbitrary locations is never allowed.
        a.hard_deny = Some("Tests can only run in projects inside your authorized folders".into());
    }
    if let Some(why) = super::fs::protected(nx, &r.path) {
        a.hard_deny = Some(why);
    }
    Ok(a)
}

pub async fn call(nx: &Arc<Nexus>, run: &RunCtx, _name: &str, input: Value) -> Result<ToolOutput> {
    let r = super::fs::resolve(nx, input.get("path").and_then(|p| p.as_str()))?;
    if !r.inside {
        bail!("Project is outside authorized folders");
    }
    let runner = match input.get("runner").and_then(|r| r.as_str()) {
        Some(x) => x.to_string(),
        None => detect_runner(&r.path).ok_or_else(|| anyhow!("No test runner detected"))?.to_string(),
    };
    let (prog, args) = command_for(&runner, input.get("filter").and_then(|f| f.as_str()))?;
    let cmdline = format!("{prog} {}", args.join(" "));
    let started = Instant::now();
    let mut cmd = tokio::process::Command::new(&prog);
    cmd.args(&args)
        .current_dir(&r.path)
        .env("CI", "1")
        .env("NO_COLOR", "1")
        .env("CARGO_TERM_COLOR", "never")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let child = cmd.spawn().with_context(|| format!("Could not start '{prog}'. Is {runner} installed and on PATH?"))?;
    let out = tokio::select! {
        o = child.wait_with_output() => o?,
        _ = run.token.cancelled() => bail!("Test run interrupted by STOP NEXUS (process killed)"),
        _ = tokio::time::sleep(Duration::from_secs(900)) => bail!("Test run exceeded 15 minutes and was killed"),
    };
    let code = out.status.code();
    let passed = out.status.success();
    let mut text = String::from_utf8_lossy(&out.stdout).to_string();
    let err = String::from_utf8_lossy(&out.stderr);
    if !err.trim().is_empty() {
        text.push_str("\n--- stderr ---\n");
        text.push_str(&err);
    }
    let secs = started.elapsed().as_secs_f64();
    nx.emit("nexus://tests", json!({"path": r.path.display().to_string(), "runner": runner, "passed": passed, "exitCode": code}));
    // verified = the tests really ran and we have their exit status (not that they passed).
    Ok(ToolOutput::new(
        format!("{runner} tests {} (exit {}, {:.1} s)", if passed { "passed" } else { "FAILED" }, code.map(|c| c.to_string()).unwrap_or("?".into()), secs),
        json!({"runner": runner, "command": cmdline, "cwd": r.path.display().to_string(), "exitCode": code, "passed": passed, "durationSecs": secs, "output": tail(&text, 30_000)}),
    )
    .verified(true)
    .untrusted())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_fixed_commands_and_rejects_injection() {
        assert_eq!(command_for("cargo", None).unwrap(), ("cargo".into(), vec!["test".into()]));
        assert_eq!(command_for("pytest", Some("test_login")).unwrap().1, vec!["-m", "pytest", "-q", "-k", "test_login"]);
        assert!(command_for("cargo", Some("x; rm -rf /")).is_err());
        assert!(command_for("cargo", Some("--release")).is_err());
        assert!(command_for("cargo", Some("a&b")).is_err());
        assert!(command_for("bash", None).is_err());
        assert!(command_for("npm", Some("foo")).is_err());
    }

    #[test]
    fn detects_runner_from_project_files() {
        let d = std::env::temp_dir().join(format!("nexus-detect-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        assert_eq!(detect_runner(&d), None);
        std::fs::write(d.join("package.json"), r#"{"scripts":{"test":"vitest"}}"#).unwrap();
        assert_eq!(detect_runner(&d), Some("npm"));
        std::fs::write(d.join("Cargo.toml"), "[package]").unwrap();
        assert_eq!(detect_runner(&d), Some("cargo"));
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Real execution: builds and tests a throwaway crate. Run with --ignored.
    #[tokio::test]
    #[ignore]
    async fn really_runs_cargo_tests() {
        let d = std::env::temp_dir().join(format!("nexus-cargo-{}", std::process::id()));
        std::fs::create_dir_all(d.join("src")).unwrap();
        std::fs::write(d.join("Cargo.toml"), "[package]\nname=\"t\"\nversion=\"0.1.0\"\nedition=\"2021\"\n[workspace]\n").unwrap();
        std::fs::write(d.join("src/lib.rs"), "#[test] fn ok(){assert_eq!(1+1,2)} #[test] fn bad(){assert_eq!(1,2)}").unwrap();
        let (p, a) = command_for("cargo", None).unwrap();
        let o = tokio::process::Command::new(p).args(a).current_dir(&d).output().await.unwrap();
        let out = String::from_utf8_lossy(&o.stdout);
        println!("{out}");
        assert!(!o.status.success(), "one test fails on purpose");
        assert!(out.contains("1 passed; 1 failed"));
        let _ = std::fs::remove_dir_all(&d);
    }
}
