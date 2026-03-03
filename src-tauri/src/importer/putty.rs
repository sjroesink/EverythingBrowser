#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

use crate::connection::config::SftpAuthMethod;
use crate::error::AppError;
use super::ImportableSession;

const PUTTY_SESSIONS_PATH: &str = r"Software\SimonTatham\PuTTY\Sessions";

#[cfg(target_os = "windows")]
pub fn count_sessions() -> Result<usize, AppError> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let sessions_key = hkcu.open_subkey(PUTTY_SESSIONS_PATH)
        .map_err(|e| AppError::Internal(format!("Failed to open PuTTY registry: {}", e)))?;

    let count = sessions_key.enum_keys()
        .filter_map(|k| k.ok())
        .filter(|name| name != "Default%20Settings")
        .count();

    Ok(count)
}

#[cfg(not(target_os = "windows"))]
pub fn count_sessions() -> Result<usize, AppError> {
    Ok(0)
}

#[cfg(target_os = "windows")]
pub fn get_sessions() -> Result<Vec<ImportableSession>, AppError> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let sessions_key = hkcu.open_subkey(PUTTY_SESSIONS_PATH)
        .map_err(|e| AppError::Internal(format!("Failed to open PuTTY registry: {}", e)))?;

    let mut sessions = Vec::new();

    for key_name in sessions_key.enum_keys().filter_map(|k| k.ok()) {
        if key_name == "Default%20Settings" {
            continue;
        }

        if let Ok(session_key) = sessions_key.open_subkey(&key_name) {
            if let Some(session) = parse_putty_session(&key_name, &session_key) {
                sessions.push(session);
            }
        }
    }

    Ok(sessions)
}

#[cfg(not(target_os = "windows"))]
pub fn get_sessions() -> Result<Vec<ImportableSession>, AppError> {
    Ok(Vec::new())
}

#[cfg(target_os = "windows")]
fn parse_putty_session(key_name: &str, session_key: &RegKey) -> Option<ImportableSession> {
    let host: String = session_key.get_value("HostName").unwrap_or_default();
    if host.is_empty() {
        return None;
    }

    let port: u32 = session_key.get_value("PortNumber").unwrap_or(22);
    let username: String = session_key.get_value("UserName").unwrap_or_default();
    let public_key_file: String = session_key.get_value("PublicKeyFile").unwrap_or_default();

    // Decode session name (PuTTY URL-encodes session names)
    let display_name = url_decode(key_name);

    let auth_method = if !public_key_file.is_empty() {
        SftpAuthMethod::PrivateKey {
            key_path: public_key_file,
            passphrase_protected: false,
        }
    } else {
        SftpAuthMethod::Password
    };

    Some(ImportableSession {
        source: "putty".into(),
        name: display_name,
        host,
        port: port as u16,
        username,
        auth_method,
        default_path: None,
    })
}

fn url_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                result.push(byte as char);
            } else {
                result.push('%');
                result.push_str(&hex);
            }
        } else {
            result.push(c);
        }
    }
    result
}
