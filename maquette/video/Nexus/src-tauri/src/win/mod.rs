pub mod apps;
pub mod capture;
pub mod input;
pub mod system;
pub mod windows;

/// Real-hardware checks. Run with: cargo test --lib win_integration -- --ignored --nocapture
#[cfg(test)]
mod win_integration {
    use super::*;

    #[test]
    #[ignore]
    fn monitors_and_capture() {
        let m = capture::monitors().unwrap();
        assert!(!m.is_empty());
        println!("monitors: {m:?}");
        let t = std::time::Instant::now();
        let f = capture::capture(1, 1600, 70).unwrap();
        println!("frame {}x{} jpeg {} KB in {} ms (total {} ms)", f.width, f.height, f.data.len() * 3 / 4 / 1024, f.capture_ms, t.elapsed().as_millis());
        assert!(f.width > 0 && f.data.len() > 1000);
    }

    #[test]
    #[ignore]
    fn real_cursor_moves_and_is_restored() {
        let orig = input::cursor_pos().unwrap();
        let m = capture::monitor_by_index(1).unwrap();
        let target = (m.x + m.width as i32 / 2, m.y + m.height as i32 / 2);
        input::move_to(target.0, target.1).unwrap();
        let got = input::cursor_pos().unwrap();
        input::move_to(orig.0, orig.1).unwrap();
        println!("moved to {target:?}, read back {got:?}, restored {orig:?}");
        assert_eq!(got, target);
    }

    #[test]
    #[ignore]
    fn discovers_apps_and_windows() {
        let (apps, warn) = apps::discover();
        println!("{} apps, warnings {warn:?}", apps.len());
        for a in apps.iter().take(400) {
            println!("  {:<40} {:<28} proc={:?}", a.name, a.source, a.expected_process);
        }
        assert!(apps.len() > 5);
        let w = windows::list();
        println!("{} windows; foreground: {:?}", w.len(), windows::foreground().map(|f| f.title));
        assert!(!w.is_empty());
    }
}
