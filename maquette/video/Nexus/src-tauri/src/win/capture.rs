//! Monitor enumeration and screen capture (xcap → resize → JPEG/base64).

use anyhow::{anyhow, Result};
use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::DynamicImage;
use serde::Serialize;
use xcap::Monitor;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    /// 1-based index in enumeration order, stable for the session.
    pub index: usize,
    pub id: u32,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
    pub primary: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub monitor: MonitorInfo,
    pub width: u32,
    pub height: u32,
    pub media_type: &'static str,
    pub data: String,
    pub capture_ms: u128,
}

pub fn monitors() -> Result<Vec<MonitorInfo>> {
    let all = Monitor::all().map_err(|e| anyhow!("Could not enumerate monitors: {e}"))?;
    let mut out = Vec::new();
    for (i, m) in all.iter().enumerate() {
        out.push(MonitorInfo {
            index: i + 1,
            id: m.id().unwrap_or(0),
            name: m.name().unwrap_or_else(|_| format!("Monitor {}", i + 1)),
            x: m.x().unwrap_or(0),
            y: m.y().unwrap_or(0),
            width: m.width().unwrap_or(0),
            height: m.height().unwrap_or(0),
            scale_factor: m.scale_factor().unwrap_or(1.0),
            primary: m.is_primary().unwrap_or(false),
        });
    }
    // Primary first is what users expect "Monitor 1" to be.
    out.sort_by_key(|m| (!m.primary, m.x, m.y));
    for (i, m) in out.iter_mut().enumerate() {
        m.index = i + 1;
    }
    Ok(out)
}

pub fn monitor_by_index(index: usize) -> Result<MonitorInfo> {
    let list = monitors()?;
    list.into_iter()
        .find(|m| m.index == index)
        .ok_or_else(|| anyhow!("Monitor {index} does not exist"))
}

/// Captures a monitor, downscales to at most `max_width`, encodes JPEG.
pub fn capture(index: usize, max_width: u32, quality: u8) -> Result<Frame> {
    let t = std::time::Instant::now();
    let info = monitor_by_index(index)?;
    let mon = Monitor::all()?
        .into_iter()
        .find(|m| m.id().ok() == Some(info.id))
        .ok_or_else(|| anyhow!("Monitor {index} disappeared"))?;
    let rgba = mon.capture_image().map_err(|e| anyhow!("Screen capture failed: {e}"))?;
    let mut img = DynamicImage::ImageRgba8(rgba);
    if img.width() > max_width && max_width > 0 {
        let h = (img.height() as u64 * max_width as u64 / img.width() as u64) as u32;
        img = img.resize_exact(max_width, h.max(1), FilterType::Triangle);
    }
    let rgb = img.to_rgb8();
    let mut buf = Vec::with_capacity(256 * 1024);
    JpegEncoder::new_with_quality(&mut buf, quality.clamp(20, 95)).encode_image(&rgb)?;
    Ok(Frame {
        width: rgb.width(),
        height: rgb.height(),
        monitor: info,
        media_type: "image/jpeg",
        data: base64::engine::general_purpose::STANDARD.encode(&buf),
        capture_ms: t.elapsed().as_millis(),
    })
}

/// Maps a point in a (possibly downscaled) frame to physical desktop coordinates.
pub fn frame_to_screen(m: &MonitorInfo, frame_w: u32, frame_h: u32, x: f64, y: f64) -> (i32, i32) {
    let sx = m.width as f64 / frame_w.max(1) as f64;
    let sy = m.height as f64 / frame_h.max(1) as f64;
    let px = (x * sx).round().clamp(0.0, m.width as f64 - 1.0);
    let py = (y * sy).round().clamp(0.0, m.height as f64 - 1.0);
    (m.x + px as i32, m.y + py as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_frame_coordinates_to_monitor() {
        let m = MonitorInfo {
            index: 2, id: 0, name: String::new(), x: 1920, y: 0, width: 2560, height: 1440,
            scale_factor: 1.0, primary: false,
        };
        assert_eq!(frame_to_screen(&m, 1280, 720, 640.0, 360.0), (1920 + 1280, 720));
        assert_eq!(frame_to_screen(&m, 1280, 720, 5000.0, -3.0), (1920 + 2559, 0));
    }
}
