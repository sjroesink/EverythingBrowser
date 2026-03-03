#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

use crate::connection::config::SftpAuthMethod;
use crate::error::AppError;
use super::ImportableSession;

const WINSCP_SESSIONS_PATH: &str = r"Software\Martin Prikryl\WinSCP 2\Sessions";

#[cfg(target_os = "windows")]
pub fn count_sessions() -> Result<usize, AppError> {
    // Try registry first
    if let Ok(count) = count_sessions_registry() {
        if count > 0 {
            return Ok(count);
        }
    }
    // Fallback to INI file
    count_sessions_ini()
}

#[cfg(not(target_os = "windows"))]
pub fn count_sessions() -> Result<usize, AppError> {
    Ok(0)
}

#[cfg(target_os = "windows")]
pub fn get_sessions() -> Result<Vec<ImportableSession>, AppError> {
    // Try registry first
    if let Ok(sessions) = get_sessions_registry() {
        if !sessions.is_empty() {
            return Ok(sessions);
        }
    }
    // Fallback to INI file
    get_sessions_ini()
}

#[cfg(not(target_os = "windows"))]
pub fn get_sessions() -> Result<Vec<ImportableSession>, AppError> {
    Ok(Vec::new())
}

#[cfg(target_os = "windows")]
fn count_sessions_registry() -> Result<usize, AppError> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let sessions_key = hkcu.open_subkey(WINSCP_SESSIONS_PATH)
        .map_err(|e| AppError::Internal(format!("Failed to open WinSCP registry: {}", e)))?;

    let count = sessions_key.enum_keys()
        .filter_map(|k| k.ok())
        .filter(|name| name != "Default%20Settings")
        .count();

    Ok(count)
}

#[cfg(target_os = "windows")]
fn get_sessions_registry() -> Result<Vec<ImportableSession>, AppError> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let sessions_key = hkcu.open_subkey(WINSCP_SESSIONS_PATH)
        .map_err(|e| AppError::Internal(format!("Failed to open WinSCP registry: {}", e)))?;

    let mut sessions = Vec::new();

    for key_name in sessions_key.enum_keys().filter_map(|k| k.ok()) {
        if key_name == "Default%20Settings" {
            continue;
        }

        if let Ok(session_key) = sessions_key.open_subkey(&key_name) {
            if let Some(session) = parse_winscp_session_registry(&key_name, &session_key) {
                sessions.push(session);
            }
        }
    }

    Ok(sessions)
}

#[cfg(target_os = "windows")]
fn parse_winscp_session_registry(key_name: &str, session_key: &RegKey) -> Option<ImportableSession> {
    let host: String = session_key.get_value("HostName").unwrap_or_default();
    if host.is_empty() {
        return None;
    }

    // Filter: only SFTP/SSH sessions (FSProtocol=5 is SFTP, Protocol=0 is SSH)
    let fs_protocol: u32 = session_key.get_value("FSProtocol").unwrap_or(5);
    if fs_protocol != 5 {
        return None;
    }

    let port: u32 = session_key.get_value("PortNumber").unwrap_or(22);
    let username: String = session_key.get_value("UserName").unwrap_or_default();
    let public_key_file: String = session_key.get_value("PublicKeyFile").unwrap_or_default();
    let remote_dir: String = session_key.get_value("RemoteDirectory").unwrap_or_default();

    let display_name = url_decode(key_name);

    let auth_method = if !public_key_file.is_empty() {
        SftpAuthMethod::PrivateKey {
            key_path: public_key_file,
            passphrase_protected: false,
        }
    } else {
        SftpAuthMethod::Password
    };

    let default_path = if remote_dir.is_empty() {
        None
    } else {
        Some(remote_dir)
    };

    Some(ImportableSession {
        source: "winscp".into(),
        name: display_name,
        host,
        port: port as u16,
        username,
        auth_method,
        default_path,
    })
}

// --- INI file fallback ---

fn get_winscp_ini_path() -> Option<String> {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let path = format!(r"{}\WinSCP.ini", appdata);
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }
    // Also check next to WinSCP executable
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        let path = format!(r"{}\WinSCP\WinSCP.ini", program_files);
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }
    if let Ok(program_files) = std::env::var("ProgramFiles(x86)") {
        let path = format!(r"{}\WinSCP\WinSCP.ini", program_files);
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }
    None
}

fn count_sessions_ini() -> Result<usize, AppError> {
    let path = match get_winscp_ini_path() {
        Some(p) => p,
        None => return Ok(0),
    };

    let content = std::fs::read_to_string(&path)
        .map_err(|e| AppError::Internal(format!("Failed to read WinSCP.ini: {}", e)))?;

    let count = content.lines()
        .filter(|line| {
            line.starts_with("[Sessions\\") && !line.contains("Default%20Settings")
        })
        .count();

    Ok(count)
}

fn get_sessions_ini() -> Result<Vec<ImportableSession>, AppError> {
    let path = match get_winscp_ini_path() {
        Some(p) => p,
        None => return Ok(Vec::new()),
    };

    let content = std::fs::read_to_string(&path)
        .map_err(|e| AppError::Internal(format!("Failed to read WinSCP.ini: {}", e)))?;

    let mut sessions = Vec::new();
    let mut current_section: Option<String> = None;
    let mut props: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for line in content.lines() {
        let line = line.trim();

        if line.starts_with('[') && line.ends_with(']') {
            // Process previous section
            if let Some(ref section) = current_section {
                if let Some(session) = parse_winscp_ini_section(section, &props) {
                    sessions.push(session);
                }
            }
            props.clear();

            let section_name = &line[1..line.len() - 1];
            if section_name.starts_with("Sessions\\") && !section_name.contains("Default%20Settings") {
                current_section = Some(section_name["Sessions\\".len()..].to_string());
            } else {
                current_section = None;
            }
        } else if current_section.is_some() {
            if let Some(eq_pos) = line.find('=') {
                let key = line[..eq_pos].trim().to_string();
                let value = line[eq_pos + 1..].trim().to_string();
                props.insert(key, value);
            }
        }
    }

    // Process last section
    if let Some(ref section) = current_section {
        if let Some(session) = parse_winscp_ini_section(section, &props) {
            sessions.push(session);
        }
    }

    Ok(sessions)
}

fn parse_winscp_ini_section(
    name: &str,
    props: &std::collections::HashMap<String, String>,
) -> Option<ImportableSession> {
    let host = props.get("HostName")?;
    if host.is_empty() {
        return None;
    }

    // Filter SFTP only
    if let Some(fs_protocol) = props.get("FSProtocol") {
        if fs_protocol != "5" {
            return None;
        }
    }

    let port = props.get("PortNumber")
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(22);

    let username = props.get("UserName").cloned().unwrap_or_default();
    let public_key_file = props.get("PublicKeyFile").cloned().unwrap_or_default();
    let remote_dir = props.get("RemoteDirectory").cloned().unwrap_or_default();

    let display_name = url_decode(name);

    let auth_method = if !public_key_file.is_empty() {
        SftpAuthMethod::PrivateKey {
            key_path: public_key_file,
            passphrase_protected: false,
        }
    } else {
        SftpAuthMethod::Password
    };

    let default_path = if remote_dir.is_empty() {
        None
    } else {
        Some(remote_dir)
    };

    Some(ImportableSession {
        source: "winscp".into(),
        name: display_name,
        host: host.clone(),
        port,
        username,
        auth_method,
        default_path,
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
