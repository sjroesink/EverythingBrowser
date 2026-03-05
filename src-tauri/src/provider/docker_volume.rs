use async_trait::async_trait;
use bollard::container::{
    Config, CreateContainerOptions, RemoveContainerOptions, StartContainerOptions,
};
use bollard::Docker;
use std::path::PathBuf;
use std::sync::Arc;

use crate::connection::config::DockerVolumeConfig;
use crate::error::AppError;

use super::docker_common::DockerExecOps;
use super::{FileEntry, FileInfo, FilePropertyUpdate, ProgressCallback, ProviderCapabilities, StorageProvider};

pub struct DockerVolumeProvider {
    ops: DockerExecOps,
    container_id: String,
    #[allow(dead_code)]
    config: DockerVolumeConfig,
}

impl DockerVolumeProvider {
    pub async fn connect(config: DockerVolumeConfig) -> Result<Self, AppError> {
        let docker = Docker::connect_with_local_defaults()
            .map_err(|e| AppError::ConnectionFailed(format!("Docker connect failed: {}", e)))?;

        let image = config.image.clone().unwrap_or_else(|| "alpine:latest".to_string());

        // Pull the image if not present
        use bollard::image::CreateImageOptions;
        use futures_util::StreamExt;

        let mut pull_stream = docker.create_image(
            Some(CreateImageOptions {
                from_image: image.as_str(),
                ..Default::default()
            }),
            None,
            None,
        );
        while let Some(result) = pull_stream.next().await {
            result.map_err(|e| {
                AppError::ConnectionFailed(format!("Failed to pull image {}: {}", image, e))
            })?;
        }

        // Create a helper container with the volume mounted
        let container_name = format!("eb-vol-{}-{}", config.volume_name, uuid::Uuid::new_v4().as_simple());

        let host_config = bollard::models::HostConfig {
            binds: Some(vec![format!("{}:/mnt/volume", config.volume_name)]),
            ..Default::default()
        };

        let container_config = Config {
            image: Some(image.clone()),
            cmd: Some(vec!["sleep".to_string(), "infinity".to_string()]),
            host_config: Some(host_config),
            ..Default::default()
        };

        let create_result = docker
            .create_container(
                Some(CreateContainerOptions {
                    name: &container_name,
                    platform: None,
                }),
                container_config,
            )
            .await
            .map_err(|e| AppError::ConnectionFailed(format!("Failed to create container: {}", e)))?;

        let container_id = create_result.id;

        docker
            .start_container(&container_id, None::<StartContainerOptions<String>>)
            .await
            .map_err(|e| AppError::ConnectionFailed(format!("Failed to start container: {}", e)))?;

        let ops = DockerExecOps::new(Arc::new(docker), container_id.clone(), "/mnt/volume".to_string());

        Ok(Self {
            ops,
            container_id,
            config,
        })
    }
}

#[async_trait]
impl StorageProvider for DockerVolumeProvider {
    fn provider_type(&self) -> &'static str {
        "DockerVolume"
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
        // Stop and remove the helper container
        let docker = self.ops.docker();
        let _ = docker
            .remove_container(
                &self.container_id,
                Some(RemoveContainerOptions {
                    force: true,
                    ..Default::default()
                }),
            )
            .await;
        Ok(())
    }
}
