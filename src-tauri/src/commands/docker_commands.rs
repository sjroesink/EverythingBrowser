use bollard::container::{ListContainersOptions, RemoveContainerOptions};
use bollard::Docker;
use bollard::volume::ListVolumesOptions;
use serde::Serialize;
use std::collections::HashMap;

use crate::error::AppError;

/// Prefix used for helper containers created by the DockerVolume provider.
pub const HELPER_CONTAINER_PREFIX: &str = "eb-vol-";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerVolumeInfo {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
}

#[tauri::command]
pub async fn list_docker_volumes() -> Result<Vec<DockerVolumeInfo>, AppError> {
    let docker = Docker::connect_with_local_defaults()
        .map_err(|e| AppError::ConnectionFailed(format!("Docker connect failed: {}", e)))?;

    let volumes = docker
        .list_volumes(None::<ListVolumesOptions<String>>)
        .await
        .map_err(|e| AppError::ConnectionFailed(format!("Failed to list volumes: {}", e)))?;

    let result = volumes
        .volumes
        .unwrap_or_default()
        .into_iter()
        .map(|v| DockerVolumeInfo {
            name: v.name,
            driver: v.driver,
            mountpoint: v.mountpoint,
        })
        .collect();

    Ok(result)
}

/// Remove all orphaned `eb-vol-*` helper containers.
/// Called on app startup to clean up containers from previous sessions.
pub async fn cleanup_orphaned_helper_containers() {
    let docker = match Docker::connect_with_local_defaults() {
        Ok(d) => d,
        Err(_) => return, // Docker not available, nothing to clean
    };

    let mut filters = HashMap::new();
    filters.insert("name".to_string(), vec![HELPER_CONTAINER_PREFIX.to_string()]);

    let containers = match docker
        .list_containers(Some(ListContainersOptions {
            all: true,
            filters,
            ..Default::default()
        }))
        .await
    {
        Ok(c) => c,
        Err(_) => return,
    };

    for container in containers {
        if let Some(id) = container.id {
            let _ = docker
                .remove_container(
                    &id,
                    Some(RemoveContainerOptions {
                        force: true,
                        ..Default::default()
                    }),
                )
                .await;
        }
    }
}
