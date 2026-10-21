//! API keys and OAuth tokens live in the Windows Credential Manager, never in
//! SQLite, settings, memory, or anything the frontend can read back.

use anyhow::{anyhow, Result};

const PREFIX: &str = "NEXUS/";

/// Names the frontend may set/clear. Values are write-only from the UI.
pub const ALLOWED: &[&str] = &["anthropic_api_key", "openai_api_key", "ms_graph_token"];

#[cfg(windows)]
mod imp {
    use super::*;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_FLAGS, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn set(name: &str, value: &str) -> Result<()> {
        let target = wide(&format!("{PREFIX}{name}"));
        let user = wide("nexus");
        let blob = value.as_bytes();
        let cred = CREDENTIALW {
            Flags: CRED_FLAGS(0),
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target.as_ptr() as *mut u16),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_ptr() as *mut u8,
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: PWSTR(user.as_ptr() as *mut u16),
            ..Default::default()
        };
        unsafe { CredWriteW(&cred, 0) }.map_err(|e| anyhow!("CredWrite failed: {e}"))
    }

    pub fn get(name: &str) -> Result<Option<String>> {
        let target = wide(&format!("{PREFIX}{name}"));
        let mut out: *mut CREDENTIALW = std::ptr::null_mut();
        match unsafe { CredReadW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None, &mut out) } {
            Ok(()) => unsafe {
                let c = &*out;
                let bytes = std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize).to_vec();
                CredFree(out as *const _);
                Ok(Some(String::from_utf8(bytes)?))
            },
            Err(_) => Ok(None),
        }
    }

    pub fn delete(name: &str) -> Result<()> {
        let target = wide(&format!("{PREFIX}{name}"));
        let _ = unsafe { CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None) };
        Ok(())
    }
}

#[cfg(windows)]
pub use imp::{delete, get, set};

pub fn has(name: &str) -> bool {
    matches!(get(name), Ok(Some(v)) if !v.is_empty())
}
