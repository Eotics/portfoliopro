//! Real mouse/keyboard injection through Win32 SendInput / SetCursorPos.
//! Coordinates are physical virtual-desktop pixels (the process is
//! per-monitor DPI aware), the same space xcap reports monitor bounds in.

use anyhow::{anyhow, bail, Result};
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use windows::Win32::Foundation::POINT;
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetCursorPos};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Button {
    Left,
    Right,
    Middle,
}

fn send(inputs: &[INPUT]) -> Result<()> {
    let n = unsafe { SendInput(inputs, std::mem::size_of::<INPUT>() as i32) };
    if n as usize != inputs.len() {
        // SendInput is blocked by UIPI when the foreground window is elevated.
        bail!(
            "Windows rejected the input ({} of {} events injected). The target window may be running as administrator.",
            n,
            inputs.len()
        );
    }
    Ok(())
}

fn mouse_input(flags: MOUSE_EVENT_FLAGS, data: i32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: data as u32, dwFlags: flags, time: 0, dwExtraInfo: 0 },
        },
    }
}

fn key_input(vk: VIRTUAL_KEY, scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

pub fn cursor_pos() -> Result<(i32, i32)> {
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p) }?;
    Ok((p.x, p.y))
}

pub fn move_to(x: i32, y: i32) -> Result<()> {
    unsafe { SetCursorPos(x, y) }.map_err(|e| anyhow!("SetCursorPos failed: {e}"))?;
    Ok(())
}

pub fn button(b: Button, down: bool) -> Result<()> {
    let f = match (b, down) {
        (Button::Left, true) => MOUSEEVENTF_LEFTDOWN,
        (Button::Left, false) => MOUSEEVENTF_LEFTUP,
        (Button::Right, true) => MOUSEEVENTF_RIGHTDOWN,
        (Button::Right, false) => MOUSEEVENTF_RIGHTUP,
        (Button::Middle, true) => MOUSEEVENTF_MIDDLEDOWN,
        (Button::Middle, false) => MOUSEEVENTF_MIDDLEUP,
    };
    send(&[mouse_input(f, 0)])
}

pub fn click(b: Button, count: u32) -> Result<()> {
    for i in 0..count.max(1) {
        if i > 0 {
            std::thread::sleep(Duration::from_millis(60));
        }
        button(b, true)?;
        button(b, false)?;
    }
    Ok(())
}

/// Positive `dy` scrolls up (away from the user), like WHEEL_DELTA.
pub fn scroll(dx: i32, dy: i32) -> Result<()> {
    let mut v = Vec::new();
    if dy != 0 {
        v.push(mouse_input(MOUSEEVENTF_WHEEL, dy * 120));
    }
    if dx != 0 {
        v.push(mouse_input(MOUSEEVENTF_HWHEEL, dx * 120));
    }
    if v.is_empty() {
        return Ok(());
    }
    send(&v)
}

/// Smooth drag so applications see intermediate WM_MOUSEMOVE events.
pub async fn drag(from: (i32, i32), to: (i32, i32), b: Button, cancel: &CancellationToken) -> Result<()> {
    move_to(from.0, from.1)?;
    button(b, true)?;
    let steps = 20;
    let mut res = Ok(());
    for i in 1..=steps {
        if cancel.is_cancelled() {
            res = Err(anyhow!("Drag interrupted by STOP NEXUS"));
            break;
        }
        let x = from.0 + (to.0 - from.0) * i / steps;
        let y = from.1 + (to.1 - from.1) * i / steps;
        if let Err(e) = move_to(x, y) {
            res = Err(e);
            break;
        }
        tokio::time::sleep(Duration::from_millis(12)).await;
    }
    // Always release the button, even when interrupted.
    button(b, false)?;
    res
}

/// Types arbitrary Unicode text (accents, emoji) independent of keyboard layout.
pub async fn type_text(text: &str, cancel: &CancellationToken) -> Result<usize> {
    let mut sent = 0usize;
    for ch in text.chars() {
        if cancel.is_cancelled() {
            bail!("Typing interrupted by STOP NEXUS after {sent} characters");
        }
        if ch == '\n' {
            press_combo(&[VK_RETURN])?;
        } else if ch == '\t' {
            press_combo(&[VK_TAB])?;
        } else {
            let mut buf = [0u16; 2];
            let mut v = Vec::new();
            for unit in ch.encode_utf16(&mut buf).iter() {
                v.push(key_input(VIRTUAL_KEY(0), *unit, KEYEVENTF_UNICODE));
                v.push(key_input(VIRTUAL_KEY(0), *unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
            }
            send(&v)?;
        }
        sent += 1;
        tokio::time::sleep(Duration::from_millis(4)).await;
    }
    Ok(sent)
}

fn is_extended(vk: VIRTUAL_KEY) -> bool {
    matches!(
        vk,
        VK_LEFT | VK_RIGHT | VK_UP | VK_DOWN | VK_HOME | VK_END | VK_PRIOR | VK_NEXT | VK_INSERT | VK_DELETE
            | VK_LWIN | VK_RWIN | VK_RCONTROL | VK_RMENU | VK_APPS | VK_DIVIDE | VK_NUMLOCK
    )
}

/// Presses modifiers + key together and releases them in reverse order.
pub fn press_combo(keys: &[VIRTUAL_KEY]) -> Result<()> {
    let mut v = Vec::new();
    for k in keys {
        let f = if is_extended(*k) { KEYEVENTF_EXTENDEDKEY } else { KEYBD_EVENT_FLAGS(0) };
        v.push(key_input(*k, 0, f));
    }
    for k in keys.iter().rev() {
        let f = if is_extended(*k) { KEYEVENTF_EXTENDEDKEY } else { KEYBD_EVENT_FLAGS(0) };
        v.push(key_input(*k, 0, f | KEYEVENTF_KEYUP));
    }
    send(&v)
}

pub fn key_state(vk: VIRTUAL_KEY, down: bool) -> Result<()> {
    let f = if is_extended(vk) { KEYEVENTF_EXTENDEDKEY } else { KEYBD_EVENT_FLAGS(0) };
    send(&[key_input(vk, 0, if down { f } else { f | KEYEVENTF_KEYUP })])
}

/// Releases every modifier, used by STOP so no key is left held down.
pub fn release_modifiers() {
    for vk in [VK_LSHIFT, VK_RSHIFT, VK_LCONTROL, VK_RCONTROL, VK_LMENU, VK_RMENU, VK_LWIN, VK_RWIN] {
        let _ = key_state(vk, false);
    }
    for b in [Button::Left, Button::Right, Button::Middle] {
        let _ = button(b, false);
    }
}

/// Maps a key name ("ctrl", "enter", "f5", "a", "ArrowLeft", "KeyA") to a virtual key.
pub fn parse_key(name: &str) -> Result<VIRTUAL_KEY> {
    let n = name.trim();
    let l = n.to_ascii_lowercase();
    let vk = match l.as_str() {
        "ctrl" | "control" | "controlleft" => VK_CONTROL,
        "controlright" => VK_RCONTROL,
        "alt" | "menu" | "altleft" => VK_MENU,
        "altright" | "altgr" => VK_RMENU,
        "shift" | "shiftleft" => VK_SHIFT,
        "shiftright" => VK_RSHIFT,
        "win" | "windows" | "meta" | "super" | "cmd" | "metaleft" | "osleft" => VK_LWIN,
        "metaright" | "osright" => VK_RWIN,
        "enter" | "return" | "numpadenter" => VK_RETURN,
        "esc" | "escape" => VK_ESCAPE,
        "tab" => VK_TAB,
        "space" | " " => VK_SPACE,
        "backspace" => VK_BACK,
        "delete" | "del" => VK_DELETE,
        "insert" | "ins" => VK_INSERT,
        "home" => VK_HOME,
        "end" => VK_END,
        "pageup" | "pgup" => VK_PRIOR,
        "pagedown" | "pgdn" => VK_NEXT,
        "left" | "arrowleft" => VK_LEFT,
        "right" | "arrowright" => VK_RIGHT,
        "up" | "arrowup" => VK_UP,
        "down" | "arrowdown" => VK_DOWN,
        "capslock" => VK_CAPITAL,
        "printscreen" | "prtsc" => VK_SNAPSHOT,
        "contextmenu" | "apps" => VK_APPS,
        "volumeup" => VK_VOLUME_UP,
        "volumedown" => VK_VOLUME_DOWN,
        "volumemute" | "mute" => VK_VOLUME_MUTE,
        "mediaplaypause" | "playpause" => VK_MEDIA_PLAY_PAUSE,
        "medianext" => VK_MEDIA_NEXT_TRACK,
        "mediaprev" | "mediaprevious" => VK_MEDIA_PREV_TRACK,
        "minus" | "-" => VK_OEM_MINUS,
        "equal" | "plus" | "=" => VK_OEM_PLUS,
        "comma" | "," => VK_OEM_COMMA,
        "period" | "." => VK_OEM_PERIOD,
        _ => {
            if let Some(f) = l.strip_prefix('f').and_then(|d| d.parse::<u16>().ok()) {
                if (1..=24).contains(&f) {
                    return Ok(VIRTUAL_KEY(VK_F1.0 + f - 1));
                }
            }
            // "KeyA" / "Digit1" (DOM KeyboardEvent.code) and bare "a" / "1"
            let s = l.strip_prefix("key").or_else(|| l.strip_prefix("digit")).unwrap_or(&l);
            let s = s.strip_prefix("numpad").map(|d| format!("np{d}")).unwrap_or_else(|| s.to_string());
            if let Some(d) = s.strip_prefix("np").and_then(|d| d.parse::<u16>().ok()) {
                if d <= 9 {
                    return Ok(VIRTUAL_KEY(VK_NUMPAD0.0 + d));
                }
            }
            let mut chars = s.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) if c.is_ascii_alphanumeric() => VIRTUAL_KEY(c.to_ascii_uppercase() as u16),
                _ => bail!("Unknown key name: {n}"),
            }
        }
    };
    Ok(vk)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_key_names() {
        assert_eq!(parse_key("ctrl").unwrap(), VK_CONTROL);
        assert_eq!(parse_key("Enter").unwrap(), VK_RETURN);
        assert_eq!(parse_key("F12").unwrap(), VK_F12);
        assert_eq!(parse_key("KeyA").unwrap(), VIRTUAL_KEY('A' as u16));
        assert_eq!(parse_key("Digit5").unwrap(), VIRTUAL_KEY('5' as u16));
        assert_eq!(parse_key("ArrowLeft").unwrap(), VK_LEFT);
        assert!(parse_key("nonsense").is_err());
    }
}
