//! Installed-application discovery and launching.
//!
//! Sources: Start Menu shortcuts (.lnk resolved via IShellLink, .url for
//! Steam-style launchers) and packaged Store/UWP apps via Get-StartApps.

use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use windows::core::{Interface, HSTRING, PCWSTR};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    STGM_READ,
};
use windows::Win32::UI::Shell::{IShellLinkW, ShellExecuteW, ShellLink};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredApp {
    pub id: String,
    pub name: String,
    pub exe_path: Option<String>,
    pub launch_target: String,
    pub launch_args: Option<String>,
    pub source: String,
    pub install_dir: Option<String>,
    pub expected_process: Option<String>,
}

fn stable_id(s: &str) -> String {
    // FNV-1a: stable across runs, unlike std's randomised hasher.
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.to_lowercase().bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

struct Com;
impl Com {
    fn init() -> Self {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
        Com
    }
}
impl Drop for Com {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

fn resolve_lnk(path: &Path) -> Option<(String, String)> {
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let pf: IPersistFile = link.cast().ok()?;
        pf.Load(&HSTRING::from(path.as_os_str()), STGM_READ).ok()?;
        let mut target = [0u16; 1024];
        link.GetPath(&mut target, std::ptr::null_mut(), 0).ok()?;
        let mut args = [0u16; 1024];
        let _ = link.GetArguments(&mut args);
        let t = String::from_utf16_lossy(&target[..target.iter().position(|&c| c == 0).unwrap_or(0)]);
        let a = String::from_utf16_lossy(&args[..args.iter().position(|&c| c == 0).unwrap_or(0)]);
        Some((t, a))
    }
}

const NOISE: &[&str] = &["uninstall", "désinstaller", "readme", "release notes", "documentation", "help", "aide", "license", "website"];

fn is_noise(name: &str, target: &str) -> bool {
    let n = name.to_lowercase();
    let t = target.to_lowercase();
    NOISE.iter().any(|w| n.contains(w))
        || [".chm", ".txt", ".pdf", ".html", ".htm", ".url", ".ini"].iter().any(|e| t.ends_with(e))
        || t.contains("unins")
}

/// Squirrel-style launchers (Discord, Teams classic…) run Update.exe --processStart X.exe.
fn expected_process(target: &str, args: &str) -> Option<String> {
    let re = regex::Regex::new(r#"(?i)--processStart\s+"?([^"\s]+\.exe)"#).ok()?;
    if let Some(c) = re.captures(args) {
        return Some(c[1].to_string());
    }
    Path::new(target).file_name().map(|f| f.to_string_lossy().to_string()).filter(|f| f.to_lowercase().ends_with(".exe"))
}

fn start_menu_dirs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(p) = std::env::var("ProgramData") {
        v.push(PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    if let Ok(p) = std::env::var("APPDATA") {
        v.push(PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    v
}

fn scan_start_menu(out: &mut Vec<DiscoveredApp>) {
    let _com = Com::init();
    for dir in start_menu_dirs() {
        for entry in walkdir::WalkDir::new(&dir).max_depth(4).into_iter().flatten() {
            let p = entry.path();
            let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            let name = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            match ext.as_str() {
                "lnk" => {
                    let Some((target, args)) = resolve_lnk(p) else { continue };
                    if target.is_empty() || is_noise(&name, &target) {
                        continue;
                    }
                    let exe = target.to_lowercase().ends_with(".exe").then(|| target.clone());
                    out.push(DiscoveredApp {
                        id: stable_id(&format!("lnk:{}", p.display())),
                        expected_process: expected_process(&target, &args),
                        install_dir: Path::new(&target).parent().map(|d| d.display().to_string()),
                        exe_path: exe,
                        // Launch the shortcut itself: keeps its working dir and arguments.
                        launch_target: p.display().to_string(),
                        launch_args: (!args.is_empty()).then_some(args),
                        source: "Start Menu".into(),
                        name,
                    });
                }
                "url" => {
                    let Ok(text) = std::fs::read_to_string(p) else { continue };
                    let Some(url) = text.lines().find_map(|l| l.strip_prefix("URL=")) else { continue };
                    // Only launcher protocols (steam://, com.epicgames…), not web links.
                    if url.starts_with("http") || NOISE.iter().any(|w| name.to_lowercase().contains(w)) {
                        continue;
                    }
                    out.push(DiscoveredApp {
                        id: stable_id(&format!("url:{}", p.display())),
                        name,
                        exe_path: None,
                        launch_target: p.display().to_string(),
                        launch_args: None,
                        source: "Start Menu (launcher link)".into(),
                        install_dir: None,
                        expected_process: None,
                    });
                }
                _ => {}
            }
        }
    }
}

#[derive(Deserialize)]
struct StartApp {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "AppID")]
    app_id: String,
}

fn scan_packaged(out: &mut Vec<DiscoveredApp>) -> Result<()> {
    use std::os::windows::process::CommandExt;
    let o = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json -Compress"])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()?;
    if !o.status.success() {
        bail!("Get-StartApps failed: {}", String::from_utf8_lossy(&o.stderr));
    }
    let apps: Vec<StartApp> = serde_json::from_slice(&o.stdout)?;
    for a in apps {
        // Packaged apps have an AUMID (Family!AppId); others were covered by the .lnk scan.
        if !a.app_id.contains('!') || a.app_id.contains('\\') {
            continue;
        }
        if is_noise(&a.name, "") {
            continue;
        }
        out.push(DiscoveredApp {
            id: stable_id(&format!("aumid:{}", a.app_id)),
            name: a.name,
            exe_path: None,
            launch_target: format!("shell:AppsFolder\\{}", a.app_id),
            launch_args: None,
            source: "Microsoft Store / packaged".into(),
            install_dir: None,
            expected_process: None,
        });
    }
    Ok(())
}

pub fn discover() -> (Vec<DiscoveredApp>, Vec<String>) {
    let mut out = Vec::new();
    let mut warnings = Vec::new();
    scan_start_menu(&mut out);
    if let Err(e) = scan_packaged(&mut out) {
        warnings.push(format!("Packaged app scan failed: {e}"));
    }
    // De-duplicate by name, preferring entries that expose an executable.
    let mut by_name: HashMap<String, DiscoveredApp> = HashMap::new();
    for a in out {
        let k = a.name.to_lowercase();
        match by_name.get(&k) {
            Some(prev) if prev.exe_path.is_some() || a.exe_path.is_none() => {}
            _ => {
                by_name.insert(k, a);
            }
        }
    }
    let mut v: Vec<_> = by_name.into_values().collect();
    // A launcher shared by several entries (Overwolf apps, cmd.exe prompts…)
    // says nothing about which of them is running: don't use it to verify.
    let mut counts: HashMap<String, usize> = HashMap::new();
    for a in &v {
        if let Some(p) = &a.expected_process {
            *counts.entry(p.to_lowercase()).or_default() += 1;
        }
    }
    for a in &mut v {
        if a.expected_process.as_ref().map(|p| counts[&p.to_lowercase()] > 1).unwrap_or(false) {
            a.expected_process = None;
            a.install_dir = None;
        }
    }
    v.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    (v, warnings)
}

/// ShellExecute the target (shortcut, exe, shell:AppsFolder\AUMID, or URL).
pub fn shell_open(target: &str, args: Option<&str>) -> Result<()> {
    let _com = Com::init();
    let (file, params) = if target.starts_with("shell:AppsFolder") {
        ("explorer.exe".to_string(), Some(target.to_string()))
    } else {
        (target.to_string(), args.map(|a| a.to_string()))
    };
    let f = HSTRING::from(file.as_str());
    let p = params.as_deref().map(HSTRING::from);
    let r = unsafe {
        ShellExecuteW(
            None,
            &HSTRING::from("open"),
            &f,
            p.as_ref().map(|h| PCWSTR(h.as_ptr())).unwrap_or(PCWSTR::null()),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecute returns a value > 32 on success.
    if r.0 as isize <= 32 {
        return Err(anyhow!("ShellExecute failed with code {}", r.0 as isize));
    }
    Ok(())
}
