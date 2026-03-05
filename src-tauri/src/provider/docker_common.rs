use bollard::container::{DownloadFromContainerOptions, LogOutput, UploadToContainerOptions};
use bollard::exec::{CreateExecOptions, StartExecResults};
use bollard::Docker;
use futures_util::StreamExt;
use std::path::PathBuf;
use std::sync::Arc;

use crate::error::AppError;

use super::{FileEntry, FileInfo, FilePropertyUpdate, ProgressCallback};

/// Shared Docker exec-based file operations used by both DockerVolume and DockerExec providers.
pub struct DockerExecOps {
    docker: Arc<Docker>,
    container_id: String,
    /// The root path inside the container. For volume provider this is "/mnt/volume",
    /// for exec provider this is "/" or the configured default path.
    root_prefix: String,
}

impl DockerExecOps {
    pub fn new(docker: Arc<Docker>, container_id: String, root_prefix: String) -> Self {
        Self {
            docker,
            container_id,
            root_prefix,
        }
    }

    pub fn docker(&self) -> &Docker {
        &self.docker
    }

    /// Resolve a user-facing path to the actual container path.
    fn resolve_path(&self, path: &str) -> String {
        if self.root_prefix == "/" {
            path.to_string()
        } else {
            let clean = path.trim_start_matches('/');
            if clean.is_empty() {
                self.root_prefix.clone()
            } else {
                format!("{}/{}", self.root_prefix, clean)
            }
        }
    }

    /// Execute a command in the container and return stdout.
    async fn exec_cmd(&self, cmd: Vec<&str>) -> Result<String, AppError> {
        let exec = self
            .docker
            .create_exec(
                &self.container_id,
                CreateExecOptions {
                    attach_stdout: Some(true),
                    attach_stderr: Some(true),
                    cmd: Some(cmd.iter().map(|s| s.to_string()).collect()),
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| AppError::FileOperationFailed(format!("Docker exec create failed: {}", e)))?;

        let output = self
            .docker
            .start_exec(&exec.id, None)
            .await
            .map_err(|e| AppError::FileOperationFailed(format!("Docker exec start failed: {}", e)))?;

        let mut stdout = String::new();
        let mut stderr = String::new();

        if let StartExecResults::Attached { mut output, .. } = output {
            while let Some(msg) = output.next().await {
                match msg {
                    Ok(LogOutput::StdOut { message }) => {
                        stdout.push_str(&String::from_utf8_lossy(&message));
                    }
                    Ok(LogOutput::StdErr { message }) => {
                        stderr.push_str(&String::from_utf8_lossy(&message));
                    }
                    Err(e) => {
                        return Err(AppError::FileOperationFailed(format!(
                            "Docker exec stream error: {}",
                            e
                        )));
                    }
                    _ => {}
                }
            }
        }

        // Check exit code
        let inspect = self
            .docker
            .inspect_exec(&exec.id)
            .await
            .map_err(|e| AppError::FileOperationFailed(format!("Docker exec inspect failed: {}", e)))?;

        if let Some(code) = inspect.exit_code {
            if code != 0 {
                return Err(AppError::FileOperationFailed(format!(
                    "Command failed (exit {}): {}",
                    code,
                    stderr.trim()
                )));
            }
        }

        Ok(stdout)
    }

    pub async fn list_dir(&self, path: &str) -> Result<Vec<FileEntry>, AppError> {
        let resolved = self.resolve_path(path);
        // Use stat-based output for reliable parsing
        // Format: type|permissions|size|mtime|name
        let cmd = format!(
            r#"dir="{}"; ls -1A "$dir" | while IFS= read -r name; do stat -c '%F|%a|%s|%Y|%n' "$dir/$name" 2>/dev/null || echo "unknown|000|0|0|$name"; done"#,
            resolved.replace('"', r#"\""#)
        );
        let output = self
            .exec_cmd(vec!["sh", "-c", &cmd])
            .await?;

        let mut entries: Vec<FileEntry> = output
            .lines()
            .filter(|l| !l.is_empty())
            .filter_map(|line| {
                let parts: Vec<&str> = line.splitn(5, '|').collect();
                if parts.len() < 5 {
                    return None;
                }
                let file_type = parts[0];
                let permissions = parts[1];
                let size: u64 = parts[2].parse().unwrap_or(0);
                let mtime: i64 = parts[3].parse().unwrap_or(0);
                let name = parts[4]
                    .rsplit('/')
                    .next()
                    .unwrap_or(parts[4])
                    .to_string();

                if name == "." || name == ".." {
                    return None;
                }

                let is_dir = file_type.contains("directory");
                let full_path = if path == "/" {
                    format!("/{}", name)
                } else {
                    format!("{}/{}", path.trim_end_matches('/'), name)
                };

                Some(FileEntry {
                    name,
                    path: full_path,
                    is_dir,
                    size,
                    modified: Some(mtime),
                    permissions: Some(permissions.to_string()),
                })
            })
            .collect();

        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(entries)
    }

    pub async fn get_info(&self, path: &str) -> Result<FileInfo, AppError> {
        let resolved = self.resolve_path(path);
        let output = self
            .exec_cmd(vec![
                "stat",
                "-c",
                "%F|%a|%s|%Y|%W|%U|%G",
                &resolved,
            ])
            .await?;

        let line = output.trim();
        let parts: Vec<&str> = line.splitn(7, '|').collect();
        if parts.len() < 7 {
            return Err(AppError::FileOperationFailed(format!(
                "Failed to parse stat output: {}",
                line
            )));
        }

        let name = std::path::Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string());

        Ok(FileInfo {
            name,
            path: path.to_string(),
            is_dir: parts[0].contains("directory"),
            size: parts[2].parse().unwrap_or(0),
            modified: parts[3].parse().ok(),
            created: parts[4].parse::<i64>().ok().filter(|&v| v > 0),
            permissions: Some(parts[1].to_string()),
            owner: Some(parts[5].to_string()),
            group: Some(parts[6].to_string()),
            mime_type: None,
        })
    }

    pub async fn download(
        &self,
        remote_path: &str,
        local_path: &PathBuf,
        on_progress: Option<ProgressCallback>,
    ) -> Result<(), AppError> {
        let resolved = self.resolve_path(remote_path);

        // Get file size first
        let size_output = self
            .exec_cmd(vec!["stat", "-c", "%s", &resolved])
            .await?;
        let total_size: u64 = size_output.trim().parse().unwrap_or(0);

        // Download via Docker API (returns a tar stream)
        let stream = self
            .docker
            .download_from_container(
                &self.container_id,
                Some(DownloadFromContainerOptions { path: &resolved }),
            );

        let mut tar_bytes: Vec<u8> = Vec::new();
        let mut stream = stream;
        while let Some(chunk) = stream.next().await {
            let data = chunk.map_err(|e| AppError::TransferFailed(format!("Download failed: {}", e)))?;
            tar_bytes.extend_from_slice(&data);
        }

        // Extract the single file from the tar
        let mut archive = tar::Archive::new(&tar_bytes[..]);
        for entry in archive.entries().map_err(|e| AppError::TransferFailed(e.to_string()))? {
            let mut entry = entry.map_err(|e| AppError::TransferFailed(e.to_string()))?;
            let mut file = std::fs::File::create(local_path)
                .map_err(|e| AppError::TransferFailed(e.to_string()))?;
            std::io::copy(&mut entry, &mut file)
                .map_err(|e| AppError::TransferFailed(e.to_string()))?;
            if let Some(ref cb) = on_progress {
                cb(total_size, total_size);
            }
            break; // Only take the first file
        }

        Ok(())
    }

    pub async fn upload(
        &self,
        local_path: &PathBuf,
        remote_path: &str,
        on_progress: Option<ProgressCallback>,
    ) -> Result<(), AppError> {
        let resolved = self.resolve_path(remote_path);

        let file_name = std::path::Path::new(&resolved)
            .file_name()
            .ok_or_else(|| AppError::TransferFailed("Invalid remote path".into()))?
            .to_string_lossy()
            .to_string();

        let parent_dir = std::path::Path::new(&resolved)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "/".to_string());

        let local_data = std::fs::read(local_path)
            .map_err(|e| AppError::TransferFailed(e.to_string()))?;
        let total_size = local_data.len() as u64;

        // Create a tar archive in memory
        let mut tar_buffer = Vec::new();
        {
            let mut tar_builder = tar::Builder::new(&mut tar_buffer);
            let mut header = tar::Header::new_gnu();
            header.set_size(total_size);
            header.set_mode(0o644);
            header.set_cksum();
            tar_builder
                .append_data(&mut header, &file_name, &local_data[..])
                .map_err(|e| AppError::TransferFailed(e.to_string()))?;
            tar_builder
                .finish()
                .map_err(|e| AppError::TransferFailed(e.to_string()))?;
        }

        self.docker
            .upload_to_container(
                &self.container_id,
                Some(UploadToContainerOptions {
                    path: parent_dir,
                    no_overwrite_dir_non_dir: String::new(),
                }),
                tar_buffer.into(),
            )
            .await
            .map_err(|e| AppError::TransferFailed(format!("Upload failed: {}", e)))?;

        if let Some(ref cb) = on_progress {
            cb(total_size, total_size);
        }

        Ok(())
    }

    pub async fn delete_file(&self, path: &str) -> Result<(), AppError> {
        let resolved = self.resolve_path(path);
        self.exec_cmd(vec!["rm", "-f", &resolved]).await?;
        Ok(())
    }

    pub async fn delete_dir(&self, path: &str, recursive: bool) -> Result<(), AppError> {
        let resolved = self.resolve_path(path);
        if recursive {
            self.exec_cmd(vec!["rm", "-rf", &resolved]).await?;
        } else {
            self.exec_cmd(vec!["rmdir", &resolved]).await?;
        }
        Ok(())
    }

    pub async fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
        let resolved_from = self.resolve_path(from);
        let resolved_to = self.resolve_path(to);
        self.exec_cmd(vec!["mv", &resolved_from, &resolved_to]).await?;
        Ok(())
    }

    pub async fn mkdir(&self, path: &str) -> Result<(), AppError> {
        let resolved = self.resolve_path(path);
        self.exec_cmd(vec!["mkdir", "-p", &resolved]).await?;
        Ok(())
    }

    pub async fn set_file_properties(
        &self,
        path: &str,
        update: FilePropertyUpdate,
    ) -> Result<(), AppError> {
        let resolved = self.resolve_path(path);
        if let Some(perms) = update.permissions {
            let mode = format!("{:o}", perms & 0o7777);
            self.exec_cmd(vec!["chmod", &mode, &resolved]).await?;
        }
        if let Some(owner) = update.owner_id {
            self.exec_cmd(vec!["chown", &owner.to_string(), &resolved]).await?;
        }
        if let Some(group) = update.group_id {
            self.exec_cmd(vec![
                "chgrp",
                &group.to_string(),
                &resolved,
            ])
            .await?;
        }
        Ok(())
    }

    pub async fn ping(&self) -> Result<bool, AppError> {
        match self.exec_cmd(vec!["echo", "ok"]).await {
            Ok(output) => Ok(output.trim() == "ok"),
            Err(_) => Ok(false),
        }
    }
}
