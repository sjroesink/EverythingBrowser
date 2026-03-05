use tauri::State;

use crate::connection::config::ConnectionConfig;
use crate::connection::ConnectionManager;
use crate::error::AppError;
use crate::provider::registry::create_provider;

#[tauri::command]
pub async fn connect(
    config: ConnectionConfig,
    secret: Option<String>,
    manager: State<'_, ConnectionManager>,
) -> Result<String, AppError> {
    manager.connect(&config, secret).await
}

#[tauri::command]
pub async fn disconnect(
    connection_id: String,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AppError> {
    manager.disconnect(&connection_id).await
}

#[tauri::command]
pub async fn test_connection(
    config: ConnectionConfig,
    secret: Option<String>,
) -> Result<bool, AppError> {
    // For Docker types, verify Docker API + resource existence without creating containers
    match &config {
        ConnectionConfig::DockerVolume(vol_config) => {
            let docker = bollard::Docker::connect_with_local_defaults()
                .map_err(|e| AppError::ConnectionFailed(format!("Docker connect failed: {}", e)))?;
            docker
                .inspect_volume(&vol_config.volume_name)
                .await
                .map_err(|e| {
                    AppError::ConnectionFailed(format!(
                        "Volume '{}' not found: {}",
                        vol_config.volume_name, e
                    ))
                })?;
            Ok(true)
        }
        ConnectionConfig::DockerExec(exec_config) => {
            let docker = bollard::Docker::connect_with_local_defaults()
                .map_err(|e| AppError::ConnectionFailed(format!("Docker connect failed: {}", e)))?;
            let info = docker
                .inspect_container(&exec_config.container, None)
                .await
                .map_err(|e| {
                    AppError::ConnectionFailed(format!(
                        "Container '{}' not found: {}",
                        exec_config.container, e
                    ))
                })?;
            let running = info.state.as_ref().and_then(|s| s.running).unwrap_or(false);
            if !running {
                return Err(AppError::ConnectionFailed(format!(
                    "Container '{}' is not running",
                    exec_config.container
                )));
            }
            Ok(true)
        }
        _ => {
            let provider = create_provider(&config, secret).await?;
            let result = provider.ping().await;
            let _ = provider.disconnect().await;
            result
        }
    }
}

#[tauri::command]
pub async fn is_connected(
    connection_id: String,
    manager: State<'_, ConnectionManager>,
) -> Result<bool, AppError> {
    Ok(manager.is_connected(&connection_id).await)
}
