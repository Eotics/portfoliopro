//! CPU, memory, battery and process information.

use serde::Serialize;
use std::sync::Mutex;
use sysinfo::{ProcessesToUpdate, System};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

pub struct SysMon {
    sys: Mutex<System>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub cpu_percent: f32,
    pub cpu_count: usize,
    pub cpu_brand: String,
    pub memory_used: u64,
    pub memory_total: u64,
    pub os: String,
    pub host: String,
    pub uptime_secs: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    pub present: bool,
    pub percent: Option<u8>,
    pub charging: bool,
    pub on_ac: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Proc {
    pub pid: u32,
    pub name: String,
    pub exe: Option<String>,
    pub memory: u64,
    pub cpu: f32,
}

impl SysMon {
    pub fn new() -> Self {
        let mut s = System::new();
        s.refresh_cpu_all();
        s.refresh_memory();
        SysMon { sys: Mutex::new(s) }
    }

    /// CPU usage is a delta since the previous refresh, so the first call after
    /// startup may read 0 — callers poll this periodically.
    pub fn snapshot(&self) -> Snapshot {
        let mut s = self.sys.lock().unwrap();
        s.refresh_cpu_all();
        s.refresh_memory();
        Snapshot {
            cpu_percent: s.global_cpu_usage(),
            cpu_count: s.cpus().len(),
            cpu_brand: s.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
            memory_used: s.used_memory(),
            memory_total: s.total_memory(),
            os: System::long_os_version().unwrap_or_else(|| "Windows".into()),
            host: System::host_name().unwrap_or_default(),
            uptime_secs: System::uptime(),
        }
    }

    pub fn processes(&self) -> Vec<Proc> {
        let mut s = self.sys.lock().unwrap();
        s.refresh_processes(ProcessesToUpdate::All, true);
        let mut v: Vec<Proc> = s
            .processes()
            .values()
            .map(|p| Proc {
                pid: p.pid().as_u32(),
                name: p.name().to_string_lossy().to_string(),
                exe: p.exe().map(|e| e.display().to_string()),
                memory: p.memory(),
                cpu: p.cpu_usage(),
            })
            .collect();
        v.sort_by(|a, b| b.memory.cmp(&a.memory));
        v
    }

    /// Case-insensitive match on process image name, e.g. "Discord.exe".
    pub fn running_by_name(&self, image: &str) -> Vec<u32> {
        let want = image.to_lowercase();
        self.processes().into_iter().filter(|p| p.name.to_lowercase() == want).map(|p| p.pid).collect()
    }
}

pub fn battery() -> Battery {
    let mut st = SYSTEM_POWER_STATUS::default();
    if unsafe { GetSystemPowerStatus(&mut st) }.is_err() {
        return Battery { present: false, percent: None, charging: false, on_ac: false };
    }
    let present = st.BatteryFlag != 128 && st.BatteryFlag != 255;
    Battery {
        present,
        percent: (present && st.BatteryLifePercent <= 100).then_some(st.BatteryLifePercent),
        charging: st.BatteryFlag & 8 != 0,
        on_ac: st.ACLineStatus == 1,
    }
}
