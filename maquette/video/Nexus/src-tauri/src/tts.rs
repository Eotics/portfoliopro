//! Natural spoken replies with Piper (local neural TTS, nothing leaves the PC).
//! Layout under <data>/voices: piper/piper.exe (+ its DLLs and espeak-ng-data)
//! and one `<voice>.onnx` + `<voice>.onnx.json` per installed voice.
//! A single Piper process is kept loaded so each reply starts quickly.

use crate::state::Nexus;
use base64::Engine;
use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::State;

type S<'a> = State<'a, Arc<Nexus>>;
type R<T> = Result<T, String>;

const MAX_CHARS: usize = 2000;

struct Piper {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    key: (String, u32),
}

impl Drop for Piper {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

static PROC: Mutex<Option<Piper>> = Mutex::new(None);

fn voices_dir(nx: &Nexus) -> PathBuf {
    nx.data_dir.join("voices")
}

fn exe(nx: &Nexus) -> PathBuf {
    voices_dir(nx).join("piper").join("piper.exe")
}

/// Installed voice ids (file stems with both the model and its config).
pub fn voices(nx: &Nexus) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(voices_dir(nx))
        .map(|it| {
            it.flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    let id = name.strip_suffix(".onnx")?.to_string();
                    voices_dir(nx).join(format!("{id}.onnx.json")).is_file().then_some(id)
                })
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

/// One line per utterance: Piper reads lines from stdin.
pub fn one_line(text: &str) -> String {
    let t: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    t.chars().take(MAX_CHARS).collect()
}

fn spawn(nx: &Nexus, voice: &str, rate: f32) -> Result<Piper, String> {
    let exe = exe(nx);
    if !exe.is_file() {
        return Err("Piper is not installed (voices\\piper\\piper.exe is missing)".into());
    }
    let model = voices_dir(nx).join(format!("{voice}.onnx"));
    if !model.is_file() {
        return Err(format!("Voice '{voice}' is not installed"));
    }
    let out_dir = voices_dir(nx).join("tmp");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    // Piper speeds up with a smaller length scale.
    let length_scale = (1.0 / rate.clamp(0.5, 2.0)).to_string();
    let mut cmd = Command::new(&exe);
    cmd.arg("--model").arg(&model).arg("--output_dir").arg(&out_dir).arg("--length_scale").arg(&length_scale).arg("--quiet")
        .current_dir(exe.parent().unwrap())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("Could not start Piper: {e}"))?;
    let stdin = child.stdin.take().ok_or("Piper stdin unavailable")?;
    let stdout = BufReader::new(child.stdout.take().ok_or("Piper stdout unavailable")?);
    Ok(Piper { child, stdin, stdout, key: (voice.to_string(), (rate * 100.0) as u32) })
}

fn synthesize(nx: &Nexus, text: &str, voice: &str, rate: f32) -> Result<Vec<u8>, String> {
    let line = one_line(text);
    if line.is_empty() {
        return Err("Nothing to say".into());
    }
    let mut guard = PROC.lock().unwrap();
    let key = (voice.to_string(), (rate * 100.0) as u32);
    let alive = guard.as_mut().map(|p| p.key == key && p.child.try_wait().ok().flatten().is_none()).unwrap_or(false);
    if !alive {
        *guard = Some(spawn(nx, voice, rate)?);
    }
    let p = guard.as_mut().unwrap();
    let res = (|| -> Result<Vec<u8>, String> {
        writeln!(p.stdin, "{line}").and_then(|_| p.stdin.flush()).map_err(|e| format!("Piper write failed: {e}"))?;
        let mut path = String::new();
        if p.stdout.read_line(&mut path).map_err(|e| e.to_string())? == 0 {
            return Err("Piper stopped unexpectedly".into());
        }
        let path = PathBuf::from(path.trim());
        let bytes = std::fs::read(&path).map_err(|e| format!("Piper output missing: {e}"))?;
        let _ = std::fs::remove_file(&path);
        Ok(bytes)
    })();
    if res.is_err() {
        *guard = None; // restart next time
    }
    res
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsStatus {
    available: bool,
    voices: Vec<String>,
}

#[tauri::command]
pub fn tts_status(nx: S) -> TtsStatus {
    TtsStatus { available: exe(&nx).is_file(), voices: voices(&nx) }
}

/// Returns the spoken audio as a WAV data URL.
#[tauri::command]
pub async fn tts_speak(nx: S<'_>, text: String, voice: String, rate: Option<f32>) -> R<String> {
    if !voices(&nx).contains(&voice) {
        return Err(format!("Voice '{voice}' is not installed"));
    }
    let nx = nx.inner().clone();
    let wav = tauri::async_runtime::spawn_blocking(move || synthesize(&nx, &text, &voice, rate.unwrap_or(1.0)))
        .await
        .map_err(|e| e.to_string())??;
    Ok(format!("data:audio/wav;base64,{}", base64::engine::general_purpose::STANDARD.encode(wav)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utterance_is_one_bounded_line() {
        assert_eq!(one_line("Bonjour,\n  je suis\tNEXUS. "), "Bonjour, je suis NEXUS.");
        assert_eq!(one_line(&"a".repeat(5000)).len(), MAX_CHARS);
        assert_eq!(one_line(" \n "), "");
    }
}
