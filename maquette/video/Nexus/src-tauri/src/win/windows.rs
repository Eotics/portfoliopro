//! Top-level window enumeration, focus and graceful close.

use anyhow::{anyhow, Result};
use serde::Serialize;
use windows::core::PWSTR;
use windows::core::BOOL;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT, WPARAM};
use windows::Win32::System::Threading::{
    AttachThreadInput, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{SetFocus, VK_MENU};
use windows::Win32::UI::WindowsAndMessaging::*;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub hwnd: isize,
    pub title: String,
    pub pid: u32,
    pub process: String,
    pub exe_path: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub minimized: bool,
}

pub fn exe_path_of(pid: u32) -> Option<String> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(h);
        ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }
}

fn title_of(hwnd: HWND) -> String {
    unsafe {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; len as usize + 1];
        let n = GetWindowTextW(hwnd, &mut buf);
        String::from_utf16_lossy(&buf[..n as usize])
    }
}

fn info(hwnd: HWND) -> WindowInfo {
    let mut pid = 0u32;
    let mut r = RECT::default();
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let _ = GetWindowRect(hwnd, &mut r);
    }
    let exe = exe_path_of(pid).unwrap_or_default();
    let process = exe.rsplit('\\').next().unwrap_or("").to_string();
    WindowInfo {
        hwnd: hwnd.0 as isize,
        title: title_of(hwnd),
        pid,
        process,
        exe_path: exe,
        x: r.left,
        y: r.top,
        width: r.right - r.left,
        height: r.bottom - r.top,
        minimized: unsafe { IsIconic(hwnd).as_bool() },
    }
}

unsafe extern "system" fn enum_cb(hwnd: HWND, lp: LPARAM) -> BOOL {
    let out = &mut *(lp.0 as *mut Vec<HWND>);
    if IsWindowVisible(hwnd).as_bool() && GetWindowTextLengthW(hwnd) > 0 {
        // Skip tool windows and owned popups: users think in terms of app windows.
        let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        let owner = GetWindow(hwnd, GW_OWNER).unwrap_or_default();
        if ex & WS_EX_TOOLWINDOW.0 == 0 && owner.0.is_null() {
            out.push(hwnd);
        }
    }
    BOOL(1)
}

pub fn list() -> Vec<WindowInfo> {
    let mut hwnds: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(enum_cb), LPARAM(&mut hwnds as *mut _ as isize));
    }
    hwnds
        .into_iter()
        .map(info)
        // Cloaked UWP shells report a title but no size.
        .filter(|w| w.width > 0 && w.height > 0)
        .collect()
}

pub fn foreground() -> Option<WindowInfo> {
    let h = unsafe { GetForegroundWindow() };
    (!h.0.is_null()).then(|| info(h))
}

pub fn focus(hwnd: isize) -> Result<WindowInfo> {
    let h = HWND(hwnd as *mut _);
    unsafe {
        if !IsWindow(Some(h)).as_bool() {
            return Err(anyhow!("Window no longer exists"));
        }
        if IsIconic(h).as_bool() {
            let _ = ShowWindow(h, SW_RESTORE);
        }
        // Windows only lets the foreground thread change focus; attach to it
        // and tap ALT (the documented workaround) so the request is honoured.
        let fg = GetForegroundWindow();
        let fg_thread = GetWindowThreadProcessId(fg, None);
        let me = GetCurrentThreadId();
        let attached = fg_thread != 0 && fg_thread != me && AttachThreadInput(me, fg_thread, true).as_bool();
        let _ = crate::win::input::key_state(VK_MENU, true);
        let _ = crate::win::input::key_state(VK_MENU, false);
        let _ = BringWindowToTop(h);
        let _ = SetForegroundWindow(h);
        let _ = SetFocus(Some(h));
        if attached {
            let _ = AttachThreadInput(me, fg_thread, false);
        }
    }
    std::thread::sleep(std::time::Duration::from_millis(150));
    let now = unsafe { GetForegroundWindow() };
    if now == h {
        Ok(info(h))
    } else {
        Err(anyhow!("Windows refused to bring the window to the foreground"))
    }
}

/// Asks a window to close (same as clicking X). Apps may prompt to save.
pub fn request_close(hwnd: isize) -> Result<()> {
    unsafe { PostMessageW(Some(HWND(hwnd as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0)) }
        .map_err(|e| anyhow!("PostMessage(WM_CLOSE) failed: {e}"))
}

/// If NEXUS itself is in the foreground, give focus back to the topmost other
/// app window so injected keystrokes reach what the user was working in.
/// Returns the window that received focus, if a switch was needed.
pub fn ensure_external_foreground() -> Option<WindowInfo> {
    let me = std::process::id();
    let fg = foreground()?;
    if fg.pid != me {
        return None;
    }
    // EnumWindows yields top-level windows in z-order, topmost first.
    let target = list().into_iter().find(|w| w.pid != me && !w.minimized)?;
    focus(target.hwnd).ok()
}

/// The window that will receive keystrokes (see `ensure_external_foreground`), without changing focus.
pub fn keyboard_target_preview() -> Option<WindowInfo> {
    let me = std::process::id();
    let fg = foreground()?;
    if fg.pid != me {
        return Some(fg);
    }
    list().into_iter().find(|w| w.pid != me && !w.minimized)
}
