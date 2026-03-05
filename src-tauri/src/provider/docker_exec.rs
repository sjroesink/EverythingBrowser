use async_trait::async_trait;
use bollard::Docker;
use std::path::PathBuf;
use std::sync::Arc;

use crate::connection::config::DockerExecConfig;
use crate::error::AppError;

use super::docker_common::DockerExecOps;
use super::{FileEntry, FileInfo, FilePropertyUpdate, ProgressCallback, ProviderCapabilities, StorageProvider};

pub struct DockerExecProvider {
    ops: DockerExecOps,
    #[allow(dead_code)]
    config: DockerExecConfig,
}

impl DockerExecProvider {
    pub async fn connect(config: DockerExecConfig) -> Result<Self, AppError> {
        let docker = Docker::connect_with_local_defaults()
            .map_err(|e| AppError::ConnectionFailed(format!("Docker connect failed: {}", e)))?;

        // Verify container exists and is running
        let info = docker
            .inspect_container(&config.container, None)
            .await
            .map_err(|e| {
                AppError::ConnectionFailed(format!(
                    "Container '{}' not found: {}",
                    config.container, e
                ))
            })?;

        let is_running = info
            .state
            .as_ref()
            .and_then(|s| s.running)
            .unwrap_or(false);

        if !is_running {
            return Err(AppError::ConnectionFailed(format!(
                "Container '{}' is not running",
                config.container
            )));
        }

        let container_id = info.id.unwrap_or_else(|| config.container.clone());
        let default_path = config.default_path.clone().unwrap_or_else(|| "/".to_string());

        let ops = DockerExecOps::new(Arc::new(docker), container_id, default_path);

        Ok(Self { ops, config })
    }
}

#[async_trait]
impl StorageProvider for DockerExecProvider {
    fn provider_type(&self) -> &'static str {
        "DockerExec"
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            file_properties: true,
            set_permissions: true,
            set_owner_group: false,
            list_ownership_options: false,
        }
    }

    async fn list_dir(&self, path: &str) -> Result<Vec<FileEntry>, AppError> {
        self.ops.list_dir(path).await
    }

    async fn get_info(&self, path: &str) -> Result<FileInfo, AppError> {
        self.ops.get_info(path).await
    }

    async fn download(
        &self,
        remote_path: &str,
        local_path: &PathBuf,
        on_progress: Option<ProgressCallback>,
    ) -> Result<(), AppError> {
        self.ops.download(remote_path, local_path, on_progress).await
    }

    async fn upload(
        &self,
        local_path: &PathBuf,
        remote_path: &str,
        on_progress: Option<ProgressCallback>,
    ) -> Result<(), AppError> {
        self.ops.upload(local_path, remote_path, on_progress).await
    }

    async fn delete_file(&self, path: &str) -> Result<(), AppError> {
        self.ops.delete_file(path).await
    }

    async fn delete_dir(&self, path: &str, recursive: bool) -> Result<(), AppError> {
        self.ops.delete_dir(path, recursive).await
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
        self.ops.rename(from, to).await
    }

    async fn mkdir(&self, path: &str) -> Result<(), AppError> {
        self.ops.mkdir(path).await
    }

    async fn set_file_properties(
        &self,
        path: &str,
        update: FilePropertyUpdate,
    ) -> Result<(), AppError> {
        self.ops.set_file_properties(path, update).await
    }

    async fn ping(&self) -> Result<bool, AppError> {
        self.ops.ping().await
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        // We don't own the container, so nothing to clean up
        Ok(())
    }
}
