use async_trait::async_trait;
use russh::client;
use russh::keys::agent::client::AgentClient;
use russh::keys::load_secret_key;
use russh::{ChannelMsg, Disconnect};
use russh_sftp::client::SftpSession;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::connection::config::{SftpAuthMethod, SftpConfig};
use crate::error::AppError;

use super::{
    FileEntry, FileInfo, FilePropertyUpdate, OwnershipOption, OwnershipOptions, ProgressCallback,
    ProviderCapabilities, StorageProvider,
};

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

const OWNER_COMMANDS: [&str; 2] = [
    "getent passwd | awk -F: '{print $1\":\"$3}'",
    "cat /etc/passwd | awk -F: '{print $1\":\"$3}'",
];

const GROUP_COMMANDS: [&str; 2] = [
    "getent group | awk -F: '{print $1\":\"$3}'",
    "cat /etc/group | awk -F: '{print $1\":\"$3}'",
];

fn parse_name_id_lines(output: &str) -> Vec<OwnershipOption> {
    let mut seen: HashSet<(u32, String)> = HashSet::new();
    let mut entries = Vec::new();

    for raw_line in output.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        let mut parts = line.splitn(2, ':');
        let name = parts.next().unwrap_or_default().trim();
        let id_str = parts.next().unwrap_or_default().trim();
        if name.is_empty() || id_str.is_empty() {
            continue;
        }

        let Ok(id) = id_str.parse::<u32>() else {
            continue;
        };

        let owned_name = name.to_string();
        if seen.insert((id, owned_name.clone())) {
            entries.push(OwnershipOption {
                id,
                name: owned_name,
            });
        }
    }

    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    entries
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
    if let Ok(mut agent) = AgentClient::connect_named_pipe("\\\\.\\pipe\\openssh-ssh-agent").await {
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
                        .ok_or(AppError::AuthenticationFailed("Password required".into()))?;
                    authenticated = session
                        .authenticate_password(&config.username, pw)
                        .await
                        .map_err(|e| AppError::AuthenticationFailed(e.to_string()))?;
                }
                SftpAuthMethod::PrivateKey {
                    key_path,
                    passphrase_protected: _,
                } => {
                    let key = load_secret_key(key_path, password_or_passphrase.as_deref())
                        .map_err(|e| {
                            AppError::AuthenticationFailed(format!("Failed to load key: {}", e))
                        })?;
                    authenticated = session
                        .authenticate_publickey(&config.username, Arc::new(key))
                        .await
                        .map_err(|e| AppError::AuthenticationFailed(e.to_string()))?;
                }
                SftpAuthMethod::KeyboardInteractive => {
                    let otp = password_or_passphrase.unwrap_or_default();
                    let response = session
                        .authenticate_keyboard_interactive_start(&config.username, None::<String>)
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
        channel.request_subsystem(true, "sftp").await.map_err(|e| {
            AppError::ConnectionFailed(format!("SFTP subsystem request failed: {}", e))
        })?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| AppError::ConnectionFailed(format!("SFTP session init failed: {}", e)))?;

        Ok(Self {
            session,
            sftp,
            config,
        })
    }

    async fn exec_stdout(&self, command: &str) -> Result<String, AppError> {
        let mut channel = self.session.channel_open_session().await.map_err(|e| {
            AppError::FileOperationFailed(format!("Failed to open SSH channel: {}", e))
        })?;

        channel.exec(true, command).await.map_err(|e| {
            AppError::FileOperationFailed(format!("Failed to execute remote command: {}", e))
        })?;

        let mut stdout: Vec<u8> = Vec::new();
        let mut stderr: Vec<u8> = Vec::new();
        let mut exit_status: Option<u32> = None;

        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Data { data } => stdout.extend_from_slice(data.as_ref()),
                ChannelMsg::ExtendedData { data, .. } => stderr.extend_from_slice(data.as_ref()),
                ChannelMsg::ExitStatus {
                    exit_status: status,
                } => {
                    exit_status = Some(status);
                }
                ChannelMsg::Failure => {
                    let _ = channel.close().await;
                    return Err(AppError::UnsupportedProvider(
                        "Remote SSH exec requests are not supported by this server".into(),
                    ));
                }
                ChannelMsg::Close => break,
                _ => {}
            }
        }

        let _ = channel.close().await;

        if let Some(status) = exit_status {
            if status != 0 {
                let stderr_text = String::from_utf8_lossy(&stderr).trim().to_string();
                return Err(AppError::FileOperationFailed(format!(
                    "Remote command failed with exit code {}{}",
                    status,
                    if stderr_text.is_empty() {
                        String::new()
                    } else {
                        format!(": {}", stderr_text)
                    }
                )));
            }
        }

        Ok(String::from_utf8_lossy(&stdout).to_string())
    }

    async fn load_options_with_fallback(
        &self,
        commands: &[&str],
    ) -> Result<Vec<OwnershipOption>, AppError> {
        let mut last_error: Option<AppError> = None;

        for command in commands {
            match self.exec_stdout(command).await {
                Ok(output) => {
                    let parsed = parse_name_id_lines(&output);
                    if !parsed.is_empty() {
                        return Ok(parsed);
                    }
                }
                Err(err) => {
                    last_error = Some(err);
                }
            }
        }

        Err(last_error.unwrap_or_else(|| {
            AppError::FileOperationFailed("Could not retrieve ownership options".into())
        }))
    }
}

#[async_trait]
impl StorageProvider for SftpProvider {
    fn provider_type(&self) -> &'static str {
        "SFTP"
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            file_properties: true,
            set_permissions: true,
            set_owner_group: true,
            list_ownership_options: true,
        }
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
            owner: meta.user.or_else(|| meta.uid.map(|u| u.to_string())),
            group: meta.group.or_else(|| meta.gid.map(|g| g.to_string())),
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

    async fn list_ownership_options(&self) -> Result<OwnershipOptions, AppError> {
        let owners = self.load_options_with_fallback(&OWNER_COMMANDS).await?;
        let groups = self.load_options_with_fallback(&GROUP_COMMANDS).await?;
        Ok(OwnershipOptions { owners, groups })
    }

    async fn set_file_properties(
        &self,
        path: &str,
        update: FilePropertyUpdate,
    ) -> Result<(), AppError> {
        if update.permissions.is_none() && update.owner_id.is_none() && update.group_id.is_none() {
            return Ok(());
        }

        let mut metadata = self
            .sftp
            .metadata(path)
            .await
            .map_err(|e| AppError::FileOperationFailed(e.to_string()))?;

        if let Some(permissions) = update.permissions {
            let sanitized = permissions & 0o7777;
            let current_mode = metadata.permissions.unwrap_or(0);
            metadata.permissions = Some((current_mode & !0o7777) | sanitized);
        }
        if let Some(owner_id) = update.owner_id {
            metadata.uid = Some(owner_id);
        }
        if let Some(group_id) = update.group_id {
            metadata.gid = Some(group_id);
        }

        self.sftp
            .set_metadata(path, metadata)
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
