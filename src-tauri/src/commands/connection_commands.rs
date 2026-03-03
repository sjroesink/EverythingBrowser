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
    let provider = create_provider(&config, secret).await?;
    let result = provider.ping().await?;
    let _ = provider.disconnect().await;
    Ok(result)
}

#[tauri::command]
pub async fn is_connected(
    connection_id: String,
    manager: State<'_, ConnectionManager>,
) -> Result<bool, AppError> {
    Ok(manager.is_connected(&connection_id).await)
}
