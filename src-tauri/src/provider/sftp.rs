use async_trait::async_trait;
use russh::client;
use russh::keys::agent::client::AgentClient;
use russh::keys::load_secret_key;
use russh::Disconnect;
use russh_sftp::client::SftpSession;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::connection::config::{SftpAuthMethod, SftpConfig};
use crate::error::AppError;

use super::{FileEntry, FileInfo, ProgressCallback, StorageProvider};

/// Minimal SSH client handler that accepts all host keys.
struct SshHandler;

#[async_trait]
impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

pub struct SftpProvider {
    session: client::Handle<SshHandler>,
    sftp: SftpSession,
    #[allow(dead_code)]
    config: SftpConfig,
}

/// Try authenticating with keys from an SSH agent.
/// Returns Ok(true) if a key was accepted, Ok(false) if no key matched.
async fn try_agent_keys<S>(
    session: &mut client::Handle<SshHandler>,
    username: &str,
    agent: &mut AgentClient<S>,
) -> Result<bool, AppError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let keys = agent
        .request_identities()
        .await
        .map_err(|e| AppError::AuthenticationFailed(format!("Agent key listing failed: {}", e)))?;

    for key in keys {
        match session
            .authenticate_publickey_with(username, key, agent)
            .await
        {
            Ok(true) => return Ok(true),
            _ => continue,
        }
    }

    Ok(false)
}

/// Try all available SSH agents on the current platform.
/// On Windows: tries OpenSSH named pipe, then Pageant.
/// On Unix: tries SSH_AUTH_SOCK.
#[cfg(windows)]
async fn try_agent_auth(
    session: &mut client::Handle<SshHandler>,
    username: &str,
) -> Result<bool, AppError> {
    // Try Windows OpenSSH agent (named pipe) first
    if let Ok(mut agent) =
        AgentClient::connect_named_pipe("\\\\.\\pipe\\openssh-ssh-agent").await
    {
        match try_agent_keys(session, username, &mut agent).await {
            Ok(true) => return Ok(true),
            _ => {} // Fall through to Pageant
        }
    }

    // Try Pageant
    let mut agent = AgentClient::connect_pageant().await;
    try_agent_keys(session, username, &mut agent).await
}

#[cfg(unix)]
async fn try_agent_auth(
    session: &mut client::Handle<SshHandler>,
    username: &str,
) -> Result<bool, AppError> {
    let mut agent = AgentClient::connect_env()
        .await
        .map_err(|e| AppError::AuthenticationFailed(format!("SSH agent not available: {}", e)))?;
    try_agent_keys(session, username, &mut agent).await
}

impl SftpProvider {
    pub async fn connect(
        config: SftpConfig,
        password_or_passphrase: Option<String>,
    ) -> Result<Self, AppError> {
        let ssh_config = client::Config::default();
        let handler = SshHandler;

        let mut session = client::connect(
            Arc::new(ssh_config),
            (config.host.as_str(), config.port),
            handler,
        )
        .await
        .map_err(|e| AppError::ConnectionFailed(format!("SSH connect failed: {}", e)))?;

        // If SSH agent is enabled, try it first before other auth methods
        let mut authenticated = false;
        if config.use_ssh_agent {
            match try_agent_auth(&mut session, &config.username).await {
                Ok(true) => authenticated = true,
                _ => {} // Agent failed, fall through to configured auth method
            }
        }

        // If agent didn't authenticate, use the configured auth method
        if !authenticated {
            match &config.auth_method {
                SftpAuthMethod::Password => {
                    let pw = password_or_passphrase
                        .as_deref()
                        .ok_or(AppError::AuthenticationFailed(
                            "Password required".into(),
                        ))?;
                    authenticated = session
                        .authenticate_password(&config.username, pw)
                        .await
                        .map_err(|e| AppError::AuthenticationFailed(e.to_string()))?;
                }
                SftpAuthMethod::PrivateKey {
                    key_path,
                    passphrase_protected: _,
                } => {
                    let key =
                        load_secret_key(key_path, password_or_passphrase.as_deref()).map_err(
                            |e| {
                                AppError::AuthenticationFailed(format!(
                                    "Failed to load key: {}",
                                    e
                                ))
                            },
                        )?;
                    authenticated = session
                        .authenticate_publickey(&config.username, Arc::new(key))
                        .await
                        .map_err(|e| AppError::AuthenticationFailed(e.to_string()))?;
                }
                SftpAuthMethod::KeyboardInteractive => {
                    let otp = password_or_passphrase.unwrap_or_default();
                    let response = session
                        .authenticate_keyboard_interactive_start(
                            &config.username,
                            None::<String>,
                        )
                        .await
                        .map_err(|e| AppError::AuthenticationFailed(e.to_string()))?;

                    match response {
                        client::KeyboardInteractiveAuthResponse::Success => {
                            authenticated = true;
                        }
                        client::KeyboardInteractiveAuthResponse::Failure => {}
                        client::KeyboardInteractiveAuthResponse::InfoRequest { .. } => {
                            let result = session
                                .authenticate_keyboard_interactive_respond(vec![otp])
                                .await
                                .map_err(|e| AppError::AuthenticationFailed(e.to_string()))?;
                            if let client::KeyboardInteractiveAuthResponse::Success = result {
                                authenticated = true;
                            }
                        }
                    }
                }
            }
        }

        if !authenticated {
            return Err(AppError::AuthenticationFailed(
                "Authentication failed".into(),
            ));
        }

        // Open SFTP subsystem
        let channel = session
            .channel_open_session()
            .await
            .map_err(|e| AppError::ConnectionFailed(format!("Channel open failed: {}", e)))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| {
                AppError::ConnectionFailed(format!("SFTP subsystem request failed: {}", e))
            })?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| {
                AppError::ConnectionFailed(format!("SFTP session init failed: {}", e))
            })?;

        Ok(Self {
            session,
            sftp,
            config,
        })
    }
}

#[async_trait]
impl StorageProvider for SftpProvider {
    fn provider_type(&self) -> &'static str {
        "SFTP"
    }

    async fn list_dir(&self, path: &str) -> Result<Vec<FileEntry>, AppError> {
        let read_dir = self
            .sftp
            .read_dir(path)
            .await
            .map_err(|e| AppError::FileOperationFailed(e.to_string()))?;

        let mut result: Vec<FileEntry> = read_dir
            .into_iter()
            .filter_map(|entry| {
                let name = entry.file_name();
                if name == "." || name == ".." {
                    return None;
                }
                let meta = entry.metadata();
                let full_path = if path == "/" {
                    format!("/{}", name)
                } else {
                    format!("{}/{}", path, name)
                };
                Some(FileEntry {
                    name,
                    path: full_path,
                    is_dir: meta.is_dir(),
                    size: meta.size.unwrap_or(0),
                    modified: meta.mtime.map(|t| t as i64),
                    permissions: meta.permissions.map(|p| format!("{:o}", p)),
                })
            })
            .collect();

        // Sort: directories first, then alphabetical
        result.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(result)
    }

    async fn get_info(&self, path: &str) -> Result<FileInfo, AppError> {
        let meta = self
            .sftp
            .metadata(path)
            .await
            .map_err(|e| AppError::FileOperationFailed(e.to_string()))?;

        let name = std::path::Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string());

        Ok(FileInfo {
            name,
            path: path.to_string(),
            is_dir: meta.is_dir(),
            size: meta.size.unwrap_or(0),
            modified: meta.mtime.map(|t| t as i64),
            created: None,
            permissions: meta.permissions.map(|p| format!("{:o}", p)),
            owner: meta.uid.map(|u| u.to_string()),
            group: meta.gid.map(|g| g.to_string()),
            mime_type: None,
        })
    }

    async fn download(
        &self,
        remote_path: &str,
        local_path: &PathBuf,
        on_progress: Option<ProgressCallback>,
    ) -> Result<(), AppError> {
        let meta = self
            .sftp
            .metadata(remote_path)
            .await
            .map_err(|e| AppError::TransferFailed(e.to_string()))?;
        let total_size = meta.size.unwrap_or(0);

        let mut remote_file = self
            .sftp
            .open(remote_path)
            .await
            .map_err(|e| AppError::TransferFailed(e.to_string()))?;

        let mut local_file = tokio::fs::File::create(local_path)
            .await
            .map_err(|e| AppError::TransferFailed(e.to_string()))?;

        let mut buf = vec![0u8; 32 * 1024];
        let mut transferred: u64 = 0;

        loop {
            let n = remote_file
                .read(&mut buf)
                .await
                .map_err(|e| AppError::TransferFailed(e.to_string()))?;
            if n == 0 {
                break;
            }
            local_file
                .write_all(&buf[..n])
                .await
                .map_err(|e| AppError::TransferFailed(e.to_string()))?;
            transferred += n as u64;
            if let Some(ref cb) = on_progress {
                cb(transferred, total_size);
            }
        }

        Ok(())
    }

    async fn upload(
        &self,
        local_path: &PathBuf,
        remote_path: &str,
        on_progress: Option<ProgressCallback>,
    ) -> Result<(), AppError> {
        let metadata = tokio::fs::metadata(local_path)
            .await
            .map_err(|e| AppError::TransferFailed(e.to_string()))?;
        let total_size = metadata.len();

        let mut local_file = tokio::fs::File::open(local_path)
            .await
            .map_err(|e| AppError::TransferFailed(e.to_string()))?;

        let mut remote_file = self
            .sftp
            .create(remote_path)
            .await
            .map_err(|e| AppError::TransferFailed(e.to_string()))?;

        let mut buf = vec![0u8; 32 * 1024];
        let mut transferred: u64 = 0;

        loop {
            let n = local_file
                .read(&mut buf)
                .await
                .map_err(|e| AppError::TransferFailed(e.to_string()))?;
            if n == 0 {
                break;
            }
            remote_file
                .write_all(&buf[..n])
                .await
                .map_err(|e| AppError::TransferFailed(e.to_string()))?;
            transferred += n as u64;
            if let Some(ref cb) = on_progress {
                cb(transferred, total_size);
            }
        }

        remote_file
            .flush()
            .await
            .map_err(|e| AppError::TransferFailed(e.to_string()))?;

        Ok(())
    }

    async fn delete_file(&self, path: &str) -> Result<(), AppError> {
        self.sftp
            .remove_file(path)
            .await
            .map_err(|e| AppError::FileOperationFailed(e.to_string()))
    }

    async fn delete_dir(&self, path: &str, recursive: bool) -> Result<(), AppError> {
        if recursive {
            let entries = self.list_dir(path).await?;
            for entry in entries {
                if entry.is_dir {
                    Box::pin(self.delete_dir(&entry.path, true)).await?;
                } else {
                    self.delete_file(&entry.path).await?;
                }
            }
        }

        self.sftp
            .remove_dir(path)
            .await
            .map_err(|e| AppError::FileOperationFailed(e.to_string()))
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
        self.sftp
            .rename(from, to)
            .await
            .map_err(|e| AppError::FileOperationFailed(e.to_string()))
    }

    async fn mkdir(&self, path: &str) -> Result<(), AppError> {
        self.sftp
            .create_dir(path)
            .await
            .map_err(|e| AppError::FileOperationFailed(e.to_string()))
    }

    async fn ping(&self) -> Result<bool, AppError> {
        match self.sftp.canonicalize(".").await {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        let _ = self.sftp.close().await;
        let _ = self
            .session
            .disconnect(Disconnect::ByApplication, "Goodbye", "en")
            .await;
        Ok(())
    }
}
