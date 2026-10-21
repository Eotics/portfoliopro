# NEXUS

*Your computer. Your agent. Your control.* — a Windows 11 desktop AI agent (Tauri 2 · Rust · React/TypeScript · SQLite).

## Run

```bash
npm install
npm run app            # tauri dev (Rust backend + Vite frontend)
```

Then open **Paramètres → IA**, paste an Anthropic API key (stored in Windows Credential Manager, never in the DB or UI) and press *Tester la connexion*.

Tests: `cd src-tauri && cargo test --lib` (unit) · `cargo test --lib win_integration -- --ignored --nocapture` (real monitors, cursor, app discovery — moves the mouse briefly).

Rust build output goes to `%LOCALAPPDATA%\nexus-build\target` (kept out of OneDrive, see `src-tauri/.cargo/config.toml`). App data: `%APPDATA%\com.nexus.agent\nexus.db`.

## Architecture

```
USER → Chat → agent::run (src-tauri/src/agent) → Anthropic Messages API (streamed, tools)
                 ↓ tool_use
         tools::run_tool  VALIDATE → ASSESS → permissions::decide → APPROVAL? → EXECUTE → VERIFY → LOG
                 ↓
         win::{input, capture, windows, apps, system}   (SendInput, xcap, EnumWindows, Start Menu/AUMID)
```

- The model never touches the OS: it can only request tools from `tools::registry()`. `permissions::decide` is a pure, unit-tested policy (mode, scope status, app allowlist, workspace containment, taint after reading untrusted content, STOP).
- **STOP NEXUS** (button or global `Ctrl+Alt+Backspace`) cancels a shared `CancellationToken` that every HTTP stream, approval wait and input loop selects on, denies pending approvals, releases held keys/buttons, and latches until re-armed.
- Filesystem tools are confined to authorized folders; system folders, credential stores and NEXUS's own data dir are hard-denied; delete = Recycle Bin.
- Web/file/screen content returned to the model is wrapped in `<untrusted_content>` and marks the run as tainted.

## Status

| Area | State |
|---|---|
| Chat + Anthropic provider (streaming, tool use, adaptive thinking) | Implemented — needs your API key to run |
| OpenAI provider | Interface only, explicitly reported as not implemented |
| Windows control (apps, windows, mouse, keyboard, screenshots, system info) | Implemented, integration-tested |
| Control Panel (live multi-monitor view, real mouse/keyboard, modes, CO-PILOT highlight, STOP) | Implemented |
| Permissions, approvals, activity log, tasks, memory, projects | Implemented |
| Filesystem (workspaces) | Implemented |
| Browser: open / search / read page | Implemented · DOM automation driver (CDP): not yet |
| Microsoft Calendar | Not yet (needs a Microsoft Entra app registration) |
| Automations, terminal execution, multi-agent | Not yet |
