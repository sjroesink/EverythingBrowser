use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::connection::ConnectionManager;
use crate::error::AppError;
use crate::provider::{FileEntry, FileInfo};

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
pub async fn download_file(
    connection_id: String,
    remote_path: String,
    local_path: String,
    on_event: Channel<TransferEvent>,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AppError> {
    let local = std::path::PathBuf::from(&local_path);
    let channel = on_event.clone();

    let progress_cb: Option<crate::provider::ProgressCallback> =
        Some(Box::new(move |transferred, total| {
            let _ = channel.send(TransferEvent::Progress {
                bytes_transferred: transferred,
                total_bytes: total,
            });
        }));

    let _ = on_event.send(TransferEvent::Started { total_bytes: 0 });

    match manager
        .download(&connection_id, &remote_path, &local, progress_cb)
        .await
    {
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
    let local = std::path::PathBuf::from(&local_path);
    let channel = on_event.clone();

    let progress_cb: Option<crate::provider::ProgressCallback> =
        Some(Box::new(move |transferred, total| {
            let _ = channel.send(TransferEvent::Progress {
                bytes_transferred: transferred,
                total_bytes: total,
            });
        }));

    let _ = on_event.send(TransferEvent::Started { total_bytes: 0 });

    match manager
        .upload(&connection_id, &local, &remote_path, progress_cb)
        .await
    {
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
