pub mod putty;
pub mod winscp;

use serde::{Deserialize, Serialize};
use crate::connection::config::{ConnectionConfig, SftpConfig, SftpAuthMethod};
use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSource {
    pub id: String,
    pub name: String,
    pub session_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportableSession {
    pub source: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: SftpAuthMethod,
    pub default_path: Option<String>,
}

impl ImportableSession {
    pub fn to_connection_config(&self) -> ConnectionConfig {
        ConnectionConfig::Sftp(SftpConfig {
            id: uuid::Uuid::new_v4().to_string(),
            name: self.name.clone(),
            host: self.host.clone(),
            port: self.port,
            username: self.username.clone(),
            auth_method: self.auth_method.clone(),
            use_ssh_agent: false,
            default_path: self.default_path.clone(),
        })
    }
}

#[tauri::command]
pub fn detect_import_sources() -> Result<Vec<ImportSource>, AppError> {
    let mut sources = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(count) = putty::count_sessions() {
            if count > 0 {
                sources.push(ImportSource {
                    id: "putty".into(),
                    name: "PuTTY".into(),
                    session_count: count,
                });
            }
        }

        if let Ok(count) = winscp::count_sessions() {
            if count > 0 {
                sources.push(ImportSource {
                    id: "winscp".into(),
                    name: "WinSCP".into(),
                    session_count: count,
                });
            }
        }
    }

    Ok(sources)
}

#[tauri::command]
pub fn get_importable_sessions(source_id: String) -> Result<Vec<ImportableSession>, AppError> {
    #[cfg(target_os = "windows")]
    {
        match source_id.as_str() {
            "putty" => putty::get_sessions(),
            "winscp" => winscp::get_sessions(),
            _ => Err(AppError::Internal(format!("Unknown import source: {}", source_id))),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = source_id;
        Ok(Vec::new())
    }
}

#[tauri::command]
pub fn import_sessions(sessions: Vec<ImportableSession>) -> Result<Vec<ConnectionConfig>, AppError> {
    let configs: Vec<ConnectionConfig> = sessions
        .iter()
        .map(|s| s.to_connection_config())
        .collect();
    Ok(configs)
}
