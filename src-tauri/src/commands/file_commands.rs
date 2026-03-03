use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::ipc::Channel;
use tauri::State;

use crate::connection::ConnectionManager;
use crate::error::AppError;
use crate::provider::{
    FileEntry, FileInfo, FilePropertyUpdate, OwnershipOptions, ProviderCapabilities,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum TransferEvent {
    Started {
        total_bytes: u64,
    },
    Progress {
        bytes_transferred: u64,
        total_bytes: u64,
    },
    Completed,
    Failed {
        error: String,
    },
}

fn remote_basename(remote_path: &str) -> String {
    let trimmed = remote_path.trim_end_matches('/');
    if trimmed.is_empty() || trimmed == "/" {
        return "download".to_string();
    }

    Path::new(trimmed)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "download".to_string())
}

fn join_remote_path(base: &str, name: &str) -> String {
    let base = base.trim_end_matches('/');
    if base.is_empty() || base == "/" {
        format!("/{}", name)
    } else {
        format!("{}/{}", base, name)
    }
}

async fn is_remote_directory(
    manager: &ConnectionManager,
    connection_id: &str,
    remote_path: &str,
) -> Result<bool, AppError> {
    match manager.get_info(connection_id, remote_path).await {
        Ok(info) => Ok(info.is_dir),
        Err(original_err) => {
            // Some providers don't expose virtual directories via get_info.
            match manager.list_dir(connection_id, remote_path).await {
                Ok(_) => Ok(true),
                Err(_) => Err(original_err),
            }
        }
    }
}

async fn ensure_remote_directory(
    manager: &ConnectionManager,
    connection_id: &str,
    remote_path: &str,
) -> Result<(), AppError> {
    match manager.get_info(connection_id, remote_path).await {
        Ok(info) => {
            if info.is_dir {
                return Ok(());
            }
            return Err(AppError::TransferFailed(format!(
                "Remote path exists and is not a directory: {}",
                remote_path
            )));
        }
        Err(_) => {}
    }

    manager.mkdir(connection_id, remote_path).await
}

async fn download_remote_directory(
    manager: &ConnectionManager,
    connection_id: &str,
    remote_root: &str,
    local_root: &Path,
) -> Result<(), AppError> {
    tokio::fs::create_dir_all(local_root)
        .await
        .map_err(|e| AppError::TransferFailed(e.to_string()))?;

    let mut stack: Vec<(String, PathBuf)> =
        vec![(remote_root.to_string(), local_root.to_path_buf())];

    while let Some((remote_dir, local_dir)) = stack.pop() {
        tokio::fs::create_dir_all(&local_dir)
            .await
            .map_err(|e| AppError::TransferFailed(e.to_string()))?;

        let entries = manager.list_dir(connection_id, &remote_dir).await?;
        for entry in entries {
            let local_child = local_dir.join(&entry.name);
            if entry.is_dir {
                stack.push((entry.path, local_child));
            } else {
                if let Some(parent) = local_child.parent() {
                    tokio::fs::create_dir_all(parent)
                        .await
                        .map_err(|e| AppError::TransferFailed(e.to_string()))?;
                }
                manager
                    .download(connection_id, &entry.path, &local_child, None)
                    .await?;
            }
        }
    }

    Ok(())
}

async fn upload_local_directory(
    manager: &ConnectionManager,
    connection_id: &str,
    local_root: &Path,
    remote_root: &str,
) -> Result<(), AppError> {
    ensure_remote_directory(manager, connection_id, remote_root).await?;

    let mut stack: Vec<(PathBuf, String)> =
        vec![(local_root.to_path_buf(), remote_root.to_string())];

    while let Some((local_dir, remote_dir)) = stack.pop() {
        let mut read_dir = tokio::fs::read_dir(&local_dir)
            .await
            .map_err(|e| AppError::TransferFailed(e.to_string()))?;

        while let Some(entry) = read_dir
            .next_entry()
            .await
            .map_err(|e| AppError::TransferFailed(e.to_string()))?
        {
            let local_child = entry.path();
            let metadata = tokio::fs::metadata(&local_child)
                .await
                .map_err(|e| AppError::TransferFailed(e.to_string()))?;

            let name = entry.file_name().to_string_lossy().to_string();
            let remote_child = join_remote_path(&remote_dir, &name);

            if metadata.is_dir() {
                ensure_remote_directory(manager, connection_id, &remote_child).await?;
                stack.push((local_child, remote_child));
            } else if metadata.is_file() {
                manager
                    .upload(connection_id, &local_child, &remote_child, None)
                    .await?;
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn list_dir(
    connection_id: String,
    path: String,
    manager: State<'_, ConnectionManager>,
) -> Result<Vec<FileEntry>, AppError> {
    manager.list_dir(&connection_id, &path).await
}

#[tauri::command]
pub async fn get_file_info(
    connection_id: String,
    path: String,
    manager: State<'_, ConnectionManager>,
) -> Result<FileInfo, AppError> {
    manager.get_info(&connection_id, &path).await
}

#[tauri::command]
pub async fn get_provider_capabilities(
    connection_id: String,
    manager: State<'_, ConnectionManager>,
) -> Result<ProviderCapabilities, AppError> {
    manager.capabilities(&connection_id).await
}

#[tauri::command]
pub async fn list_ownership_options(
    connection_id: String,
    manager: State<'_, ConnectionManager>,
) -> Result<OwnershipOptions, AppError> {
    manager.list_ownership_options(&connection_id).await
}

#[tauri::command]
pub async fn set_file_properties(
    connection_id: String,
    path: String,
    update: FilePropertyUpdate,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AppError> {
    manager
        .set_file_properties(&connection_id, &path, update)
        .await
}

#[tauri::command]
pub async fn download_file(
    connection_id: String,
    remote_path: String,
    local_path: String,
    on_event: Channel<TransferEvent>,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AppError> {
    let local = PathBuf::from(&local_path);
    let channel = on_event.clone();

    let progress_cb: Option<crate::provider::ProgressCallback> =
        Some(Box::new(move |transferred, total| {
            let _ = channel.send(TransferEvent::Progress {
                bytes_transferred: transferred,
                total_bytes: total,
            });
        }));

    let _ = on_event.send(TransferEvent::Started { total_bytes: 0 });

    let transfer_result =
        if is_remote_directory(manager.inner(), &connection_id, &remote_path).await? {
            download_remote_directory(manager.inner(), &connection_id, &remote_path, &local).await
        } else {
            manager
                .download(&connection_id, &remote_path, &local, progress_cb)
                .await
        };

    match transfer_result {
        Ok(()) => {
            let _ = on_event.send(TransferEvent::Completed);
            Ok(())
        }
        Err(e) => {
            let _ = on_event.send(TransferEvent::Failed {
                error: e.to_string(),
            });
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn upload_file(
    connection_id: String,
    local_path: String,
    remote_path: String,
    on_event: Channel<TransferEvent>,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AppError> {
    let local = PathBuf::from(&local_path);
    let channel = on_event.clone();

    let progress_cb: Option<crate::provider::ProgressCallback> =
        Some(Box::new(move |transferred, total| {
            let _ = channel.send(TransferEvent::Progress {
                bytes_transferred: transferred,
                total_bytes: total,
            });
        }));

    let _ = on_event.send(TransferEvent::Started { total_bytes: 0 });

    let local_metadata = tokio::fs::metadata(&local)
        .await
        .map_err(|e| AppError::TransferFailed(e.to_string()));

    let transfer_result = match local_metadata {
        Ok(metadata) if metadata.is_dir() => {
            upload_local_directory(manager.inner(), &connection_id, &local, &remote_path).await
        }
        Ok(_) => {
            manager
                .upload(&connection_id, &local, &remote_path, progress_cb)
                .await
        }
        Err(e) => Err(e),
    };

    match transfer_result {
        Ok(()) => {
            let _ = on_event.send(TransferEvent::Completed);
            Ok(())
        }
        Err(e) => {
            let _ = on_event.send(TransferEvent::Failed {
                error: e.to_string(),
            });
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn delete_file(
    connection_id: String,
    path: String,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AppError> {
    manager.delete_file(&connection_id, &path).await
}

#[tauri::command]
pub async fn delete_dir(
    connection_id: String,
    path: String,
    recursive: bool,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AppError> {
    manager.delete_dir(&connection_id, &path, recursive).await
}

#[tauri::command]
pub async fn rename_item(
    connection_id: String,
    from: String,
    to: String,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AppError> {
    manager.rename(&connection_id, &from, &to).await
}

#[tauri::command]
pub async fn create_dir(
    connection_id: String,
    path: String,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AppError> {
    manager.mkdir(&connection_id, &path).await
}

#[tauri::command]
pub async fn ensure_drag_icon() -> Result<String, AppError> {
    let temp_dir = std::env::temp_dir().join("everythingbrowser");
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| AppError::TransferFailed(format!("Failed to create temp dir: {}", e)))?;

    let icon_path = temp_dir.join("drag_icon.png");
    if !icon_path.exists() {
        let png_data = include_bytes!("../../icons/32x32.png");
        tokio::fs::write(&icon_path, png_data)
            .await
            .map_err(|e| AppError::TransferFailed(format!("Failed to write icon: {}", e)))?;
    }

    icon_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::TransferFailed("Invalid icon path".into()))
}

#[tauri::command]
pub async fn download_to_temp(
    connection_id: String,
    remote_path: String,
    manager: State<'_, ConnectionManager>,
) -> Result<String, AppError> {
    let file_name = remote_basename(&remote_path);

    let temp_dir = std::env::temp_dir().join("everythingbrowser");
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| AppError::TransferFailed(format!("Failed to create temp dir: {}", e)))?;

    let local_path = temp_dir.join(&file_name);
    let remote_is_dir = is_remote_directory(manager.inner(), &connection_id, &remote_path).await?;

    if let Ok(metadata) = tokio::fs::metadata(&local_path).await {
        if metadata.is_dir() {
            tokio::fs::remove_dir_all(&local_path)
                .await
                .map_err(|e| AppError::TransferFailed(e.to_string()))?;
        } else {
            tokio::fs::remove_file(&local_path)
                .await
                .map_err(|e| AppError::TransferFailed(e.to_string()))?;
        }
    }

    if remote_is_dir {
        download_remote_directory(manager.inner(), &connection_id, &remote_path, &local_path)
            .await?;
    } else {
        manager
            .download(&connection_id, &remote_path, &local_path, None)
            .await?;
    }

    local_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::TransferFailed("Invalid temp path".into()))
}
