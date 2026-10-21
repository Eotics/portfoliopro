//! Voice input: microphone capture (cpal/WASAPI) + local speech-to-text (whisper.cpp).
//!
//! Privacy rules:
//! - Off by default; nothing here runs unless the user enabled voice in Settings.
//! - The microphone is opened only on an explicit user action (button / held
//!   shortcut / conversation mode the user started) and closed right after.
//! - Audio never leaves the PC; only the transcript is sent to the AI, exactly
//!   like a typed message.
//! Speech output (TTS) is done in the UI with the Windows voices.

use crate::state::{Activity, Nexus};
use anyhow::{anyhow, bail, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::State;

type S<'a> = State<'a, Arc<Nexus>>;
type R<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    format!("{err:#}")
}

pub const MODELS: &[(&str, &str, u64)] = &[
    // (id, file, approximate size in bytes)
    ("base", "ggml-base.bin", 147_951_465),
    ("small", "ggml-small.bin", 487_601_967),
];

const MAX_SECONDS: u64 = 60;

#[derive(Default)]
pub struct Voice {
    recording: AtomicBool,
    stop_tx: Mutex<Option<mpsc::Sender<()>>>,
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: Mutex<u32>,
    ctx: Mutex<Option<(String, Arc<whisper_rs::WhisperContext>)>>,
    downloading: AtomicBool,
}

fn models_dir(nx: &Nexus) -> PathBuf {
    nx.data_dir.join("models")
}

fn model_path(nx: &Nexus, id: &str) -> Option<PathBuf> {
    MODELS.iter().find(|m| m.0 == id).map(|m| models_dir(nx).join(m.1))
}

fn model_ready(nx: &Nexus, id: &str) -> bool {
    model_path(nx, id).and_then(|p| std::fs::metadata(p).ok()).map(|m| m.len() > 10_000_000).unwrap_or(false)
}

/// Downmix interleaved frames to mono.
fn to_mono(data: &[f32], channels: usize) -> impl Iterator<Item = f32> + '_ {
    data.chunks(channels.max(1)).map(move |f| f.iter().sum::<f32>() / f.len() as f32)
}

/// Linear resampling to 16 kHz, the rate Whisper expects.
pub fn resample_16k(input: &[f32], rate: u32) -> Vec<f32> {
    if rate == 16_000 || input.is_empty() {
        return input.to_vec();
    }
    let ratio = rate as f64 / 16_000.0;
    let n = (input.len() as f64 / ratio) as usize;
    (0..n)
        .map(|i| {
            let pos = i as f64 * ratio;
            let i0 = pos.floor() as usize;
            let i1 = (i0 + 1).min(input.len() - 1);
            let t = (pos - i0 as f64) as f32;
            input[i0] * (1.0 - t) + input[i1] * t
        })
        .collect()
}

fn rms(s: &[f32]) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
}

/// Energy-based end-of-speech detection for conversation mode: true once speech
/// was heard and has been followed by `silence_ms` of quiet.
pub fn speech_ended(samples: &[f32], rate: u32, silence_ms: u32) -> bool {
    let frame = (rate / 50).max(1) as usize; // 20 ms
    let levels: Vec<f32> = samples.chunks(frame).map(rms).collect();
    // Adapt to the room/microphone noise floor (sensitive mics pick up a lot of
    // background), so the end of a sentence is detected promptly.
    let mut sorted = levels.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let floor = sorted.get(sorted.len() / 5).copied().unwrap_or(0.0);
    let thr = (floor * 2.5).max(0.015);
    let Some(first_speech) = levels.iter().position(|l| *l > thr) else { return false };
    let quiet_frames = (silence_ms / 20) as usize;
    let tail = &levels[first_speech..];
    tail.len() > quiet_frames && tail[tail.len() - quiet_frames..].iter().all(|l| *l <= thr)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    enabled: bool,
    model: String,
    model_ready: bool,
    models: Vec<Value>,
    recording: bool,
    downloading: bool,
    microphone: Option<String>,
    devices: Vec<String>,
}

#[tauri::command]
pub fn voice_status(nx: S) -> VoiceStatus {
    let s = nx.settings();
    let host = cpal::default_host();
    let devices: Vec<String> = host.input_devices().map(|it| it.filter_map(|d| d.name().ok()).collect()).unwrap_or_default();
    let mic = if s.voice_device.is_empty() { host.default_input_device().and_then(|d| d.name().ok()) } else { Some(s.voice_device.clone()) };
    VoiceStatus {
        enabled: s.voice_enabled,
        model: s.voice_model.clone(),
        model_ready: model_ready(&nx, &s.voice_model),
        models: MODELS.iter().map(|m| json!({"id": m.0, "sizeMB": m.2 / 1_000_000, "ready": model_ready(&nx, m.0)})).collect(),
        recording: nx.voice.recording.load(Ordering::SeqCst),
        downloading: nx.voice.downloading.load(Ordering::SeqCst),
        microphone: mic,
        devices,
    }
}

/// User-initiated download of the Whisper model from the official whisper.cpp repository.
#[tauri::command]
pub async fn voice_download_model(nx: S<'_>, model: String) -> R<()> {
    let (_, file, expected) = *MODELS.iter().find(|m| m.0 == model).ok_or("Unknown model")?;
    if nx.voice.downloading.swap(true, Ordering::SeqCst) {
        return Err("A download is already running".into());
    }
    let res = download(&nx, file, expected).await;
    nx.voice.downloading.store(false, Ordering::SeqCst);
    match &res {
        Ok(()) => nx.log(Activity { kind: "system".into(), action: format!("Voice model '{model}' downloaded"), status: "ok".into(), ..Default::default() }),
        Err(err) => nx.log(Activity { kind: "system".into(), action: format!("Voice model '{model}' download failed"), status: "error".into(), error: Some(format!("{err:#}")), ..Default::default() }),
    }
    nx.emit("nexus://voice", json!({"type": "status"}));
    res.map_err(e)
}

async fn download(nx: &Nexus, file: &str, expected: u64) -> Result<()> {
    let dir = models_dir(nx);
    std::fs::create_dir_all(&dir)?;
    let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{file}");
    let resp = nx.http.get(&url).timeout(Duration::from_secs(3600)).send().await.context("Could not reach huggingface.co")?;
    if !resp.status().is_success() {
        bail!("Download failed: HTTP {}", resp.status());
    }
    let total = resp.content_length().unwrap_or(expected);
    let tmp = dir.join(format!("{file}.part"));
    let mut f = tokio::fs::File::create(&tmp).await?;
    let mut done: u64 = 0;
    let mut last = Instant::now();
    let mut stream = resp.bytes_stream();
    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("Download interrupted")?;
        f.write_all(&chunk).await?;
        done += chunk.len() as u64;
        if last.elapsed() > Duration::from_millis(250) {
            last = Instant::now();
            nx.emit("nexus://voice", json!({"type": "download", "done": done, "total": total}));
        }
    }
    f.flush().await?;
    drop(f);
    // Sanity check: a truncated or HTML error page is far smaller than a model.
    if done < expected * 9 / 10 {
        let _ = std::fs::remove_file(&tmp);
        bail!("Downloaded file is too small ({done} bytes); try again");
    }
    std::fs::rename(&tmp, dir.join(file))?;
    nx.emit("nexus://voice", json!({"type": "download", "done": done, "total": total, "finished": true}));
    Ok(())
}

/// Opens the microphone. `auto_stop`: end automatically after speech + 1.2 s of silence.
#[tauri::command]
pub fn voice_start(nx: S, auto_stop: Option<bool>) -> R<()> {
    start(nx.inner(), auto_stop.unwrap_or(false))
}

pub fn start(nx: &Arc<Nexus>, auto: bool) -> R<()> {
    let s = nx.settings();
    if !s.voice_enabled {
        return Err("Voice is disabled. Enable it in Settings → Voice.".into());
    }
    if !model_ready(&nx, &s.voice_model) {
        return Err("The voice model is not downloaded yet (Settings → Voice).".into());
    }
    if nx.control.is_stopped() {
        return Err("NEXUS is stopped. Re-arm it first.".into());
    }
    if nx.voice.recording.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let (tx, rx) = mpsc::channel::<()>();
    *nx.voice.stop_tx.lock().unwrap() = Some(tx);
    nx.voice.samples.lock().unwrap().clear();
    let samples = nx.voice.samples.clone();
    let nx2: Arc<Nexus> = nx.clone();
    let wanted = s.voice_device.clone();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<u32, String>>();

    // cpal streams are not Send: own the stream on a dedicated thread.
    std::thread::spawn(move || {
        let run = || -> Result<()> {
            let host = cpal::default_host();
            let dev = if wanted.is_empty() {
                host.default_input_device().ok_or_else(|| anyhow!("No microphone found"))?
            } else {
                host.input_devices()?
                    .find(|d| d.name().map(|n| n == wanted).unwrap_or(false))
                    .ok_or_else(|| anyhow!("Microphone '{wanted}' is not connected (Settings → Voice)"))?
            };
            let cfg = dev.default_input_config().context("Could not read the microphone configuration")?;
            let rate = cfg.sample_rate().0;
            let ch = cfg.channels() as usize;
            let buf = samples.clone();
            let err_fn = |err| eprintln!("microphone error: {err}");
            let stream = match cfg.sample_format() {
                cpal::SampleFormat::F32 => dev.build_input_stream(&cfg.into(), move |d: &[f32], _| buf.lock().unwrap().extend(to_mono(d, ch)), err_fn, None)?,
                cpal::SampleFormat::I16 => dev.build_input_stream(&cfg.into(), move |d: &[i16], _| {
                    let f: Vec<f32> = d.iter().map(|x| *x as f32 / 32768.0).collect();
                    buf.lock().unwrap().extend(to_mono(&f, ch));
                }, err_fn, None)?,
                other => bail!("Unsupported microphone sample format {other:?}"),
            };
            stream.play().context("Could not start the microphone")?;
            let _ = ready_tx.send(Ok(rate));
            let started = Instant::now();
            loop {
                match rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
                let (level, ended) = {
                    let s = samples.lock().unwrap();
                    let tail = &s[s.len().saturating_sub(rate as usize / 10)..];
                    (rms(tail), auto && speech_ended(&s, rate, 1200))
                };
                nx2.emit("nexus://voice", json!({"type": "level", "level": level}));
                if ended || started.elapsed() > Duration::from_secs(MAX_SECONDS) || nx2.control.is_stopped() {
                    nx2.emit("nexus://voice", json!({"type": "autostop"}));
                    // Wait for the UI to call voice_stop (or a STOP) to collect the audio.
                    let _ = rx.recv_timeout(Duration::from_secs(5));
                    break;
                }
            }
            drop(stream); // closes the microphone
            Ok(())
        };
        if let Err(err) = run() {
            let _ = ready_tx.send(Err(format!("{err:#}")));
        }
        nx2.voice.recording.store(false, Ordering::SeqCst);
        nx2.emit("nexus://voice", json!({"type": "mic", "open": false}));
    });

    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(rate)) => {
            *nx.voice.sample_rate.lock().unwrap() = rate;
            nx.emit("nexus://voice", json!({"type": "mic", "open": true}));
            Ok(())
        }
        Ok(Err(err)) => {
            nx.voice.recording.store(false, Ordering::SeqCst);
            Err(err)
        }
        Err(_) => {
            nx.voice.recording.store(false, Ordering::SeqCst);
            Err("The microphone did not start".into())
        }
    }
}

/// Closes the microphone and discards the audio.
pub fn cancel(nx: &Nexus) {
    if let Some(tx) = nx.voice.stop_tx.lock().unwrap().take() {
        let _ = tx.send(());
    }
    nx.voice.samples.lock().unwrap().clear();
    nx.emit("nexus://voice", json!({"type": "cancel"}));
}

#[tauri::command]
pub fn voice_cancel(nx: S) {
    cancel(&nx);
}

/// Closes the microphone and transcribes what was said, locally.
#[tauri::command]
pub async fn voice_stop(nx: S<'_>) -> R<String> {
    stop(nx.inner()).await
}

pub async fn stop(nx: &Arc<Nexus>) -> R<String> {
    if let Some(tx) = nx.voice.stop_tx.lock().unwrap().take() {
        let _ = tx.send(());
    }
    let rate = *nx.voice.sample_rate.lock().unwrap();
    let audio = std::mem::take(&mut *nx.voice.samples.lock().unwrap());
    if audio.len() < rate as usize / 3 {
        return Ok(String::new());
    }
    if rms(&audio) < 0.003 {
        return Ok(String::new()); // silence: nothing to transcribe
    }
    let s = nx.settings();
    let model = s.voice_model.clone();
    let lang = if s.language == "en" { "en" } else { "fr" };
    let path = model_path(nx, &model).ok_or("Unknown voice model")?;
    nx.emit("nexus://voice", json!({"type": "transcribing"}));
    let ctx = {
        let cached = nx.voice.ctx.lock().unwrap().clone();
        match cached {
            Some((m, c)) if m == model => c,
            _ => {
                let p = path.clone();
                let c = tokio::task::spawn_blocking(move || {
                    whisper_rs::WhisperContext::new_with_params(&p.display().to_string(), whisper_rs::WhisperContextParameters::default())
                })
                .await
                .map_err(e)?
                .map_err(|err| format!("Could not load the voice model: {err}"))?;
                let c = Arc::new(c);
                *nx.voice.ctx.lock().unwrap() = Some((model.clone(), c.clone()));
                c
            }
        }
    };
    let pcm = resample_16k(&audio, rate);
    let secs = pcm.len() as f32 / 16_000.0;
    let t = Instant::now();
    let text = tokio::task::spawn_blocking(move || -> Result<String> {
        let mut st = ctx.create_state()?;
        let mut p = whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
        p.set_language(Some(lang));
        p.set_n_threads(std::thread::available_parallelism().map(|n| n.get().min(8) as i32).unwrap_or(4));
        p.set_no_context(true);
        p.set_no_timestamps(true);
        p.set_suppress_blank(true);
        p.set_print_progress(false);
        p.set_print_realtime(false);
        p.set_print_special(false);
        p.set_print_timestamps(false);
        st.full(p, &pcm)?;
        let mut out = String::new();
        for i in 0..st.full_n_segments() {
            if let Some(seg) = st.get_segment(i) {
                out.push_str(&seg.to_str_lossy()?);
            }
        }
        Ok(out.trim().to_string())
    })
    .await
    .map_err(e)?
    .map_err(e)?;
    // Whisper emits markers like "[Musique]" or "(silence)" on non-speech audio.
    let cleaned = regex::Regex::new(r"[\[\(][^\]\)]{0,40}[\]\)]").unwrap().replace_all(&text, "").trim().to_string();
    nx.log(Activity {
        kind: "manual".into(),
        action: format!("Voice transcribed locally ({secs:.1} s of audio in {:.1} s)", t.elapsed().as_secs_f32()),
        status: "ok".into(),
        result: Some(cleaned.chars().take(120).collect()),
        ..Default::default()
    });
    nx.emit("nexus://voice", json!({"type": "transcript", "text": cleaned}));
    Ok(cleaned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resamples_to_16k() {
        let src: Vec<f32> = (0..48_000).map(|i| i as f32 / 48_000.0).collect();
        let out = resample_16k(&src, 48_000);
        assert_eq!(out.len(), 16_000);
        assert!((out[8_000] - 0.5).abs() < 0.001);
        assert_eq!(resample_16k(&src[..10], 16_000).len(), 10);
    }

    #[test]
    fn detects_end_of_speech_after_silence() {
        let rate = 16_000;
        let speech: Vec<f32> = (0..rate).map(|i| ((i as f32) * 0.3).sin() * 0.2).collect();
        let silence = vec![0.0f32; (rate as usize) * 2];
        assert!(!speech_ended(&silence, rate, 1200), "silence alone is not speech");
        assert!(!speech_ended(&speech, rate, 1200), "still speaking");
        let mut both = speech.clone();
        both.extend(&silence);
        assert!(speech_ended(&both, rate, 1200));
        // With steady background noise (sensitive microphone), the end is still detected.
        let noisy = |v: f32, n: usize| (0..n).map(move |i| v * if i % 2 == 0 { 1.0 } else { -1.0 });
        let room: Vec<f32> = noisy(0.03, rate as usize).chain(noisy(0.3, rate as usize)).chain(noisy(0.03, 2 * rate as usize)).collect();
        assert!(speech_ended(&room, rate, 1200), "speech then room noise counts as the end");
    }

    #[test]
    fn downmixes_stereo() {
        let m: Vec<f32> = to_mono(&[1.0, 0.0, 0.5, 0.5], 2).collect();
        assert_eq!(m, vec![0.5, 0.5]);
    }
}
