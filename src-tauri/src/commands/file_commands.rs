use serde::Serialize;
use std::collections::HashMap;
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


fn dedupe_export_name(name: &str, used_names: &mut HashMap<String, usize>) -> String {
    let count = used_names.entry(name.to_string()).or_insert(0);
    if *count == 0 {
        *count = 1;
        return name.to_string();
    }

    let suffix = *count;
    *count += 1;

    let path = Path::new(name);
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| name.to_string());

    match path.extension().map(|value| value.to_string_lossy().to_string()) {
        Some(extension) if !extension.is_empty() => format!("{} ({}).{}", stem, suffix, extension),
        _ => format!("{} ({})", stem, suffix),
    }
}

async fn cleanup_old_clipboard_exports(root: &Path) {
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(24 * 60 * 60))
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

    let Ok(mut entries) = tokio::fs::read_dir(root).await else {
        return;
    };

    loop {
        let Ok(Some(entry)) = entries.next_entry().await else {
            break;
        };

        let Ok(metadata) = entry.metadata().await else {
            continue;
        };

        let Ok(modified) = metadata.modified() else {
            continue;
        };

        if modified >= cutoff {
            continue;
        }

        let path = entry.path();
        if metadata.is_dir() {
            let _ = tokio::fs::remove_dir_all(path).await;
        } else {
            let _ = tokio::fs::remove_file(path).await;
        }
    }
}

#[cfg(windows)]
fn set_windows_file_clipboard(paths: &[PathBuf]) -> Result<(), AppError> {
    use std::mem::size_of;
    use std::ptr::{copy_nonoverlapping, null_mut};
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
    };
    use windows_sys::Win32::UI::Shell::DROPFILES;

    const CF_HDROP_FORMAT: u32 = 15;

    if paths.is_empty() {
        return Ok(());
    }

    let mut wide_paths: Vec<u16> = Vec::new();
    for path in paths {
        wide_paths.extend(path.to_string_lossy().encode_utf16());
        wide_paths.push(0);
    }
    wide_paths.push(0);

    let dropfiles_size = size_of::<DROPFILES>();
    let path_bytes = wide_paths.len() * size_of::<u16>();
    let total_size = dropfiles_size + path_bytes;

    unsafe {
        if OpenClipboard(null_mut()) == 0 {
            return Err(AppError::Internal(
                "Failed to open Windows clipboard".to_string(),
            ));
        }

        if EmptyClipboard() == 0 {
            let _ = CloseClipboard();
            return Err(AppError::Internal(
                "Failed to clear Windows clipboard".to_string(),
            ));
        }

        let hglobal = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, total_size);
        if hglobal.is_null() {
            let _ = CloseClipboard();
            return Err(AppError::Internal(
                "Failed to allocate clipboard memory".to_string(),
            ));
        }

        let ptr = GlobalLock(hglobal) as *mut u8;
        if ptr.is_null() {
            let _ = GlobalFree(hglobal);
            let _ = CloseClipboard();
            return Err(AppError::Internal(
                "Failed to lock clipboard memory".to_string(),
            ));
        }

        let dropfiles_ptr = ptr as *mut DROPFILES;
        (*dropfiles_ptr).pFiles = dropfiles_size as u32;
        (*dropfiles_ptr).pt.x = 0;
        (*dropfiles_ptr).pt.y = 0;
        (*dropfiles_ptr).fNC = 0;
        (*dropfiles_ptr).fWide = 1;

        let files_ptr = ptr.add(dropfiles_size) as *mut u16;
        copy_nonoverlapping(wide_paths.as_ptr(), files_ptr, wide_paths.len());

        let _ = GlobalUnlock(hglobal);

        if SetClipboardData(CF_HDROP_FORMAT, hglobal).is_null() {
            let _ = GlobalFree(hglobal);
            let _ = CloseClipboard();
            return Err(AppError::Internal(
                "Failed to set Windows clipboard data".to_string(),
            ));
        }

        let _ = CloseClipboard();
    }

    Ok(())
}

#[cfg(not(windows))]
fn set_windows_file_clipboard(_paths: &[PathBuf]) -> Result<(), AppError> {
    Err(AppError::UnsupportedProvider(
        "Explorer paste is only available on Windows".to_string(),
    ))
}

#[cfg(windows)]
fn get_windows_file_clipboard() -> Result<Vec<String>, AppError> {
    use std::ptr::null_mut;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    use windows_sys::Win32::UI::Shell::DROPFILES;

    const CF_HDROP_FORMAT: u32 = 15;

    unsafe {
        if IsClipboardFormatAvailable(CF_HDROP_FORMAT) == 0 {
            return Ok(vec![]);
        }

        if OpenClipboard(null_mut()) == 0 {
            return Ok(vec![]);
        }

        let hglobal = GetClipboardData(CF_HDROP_FORMAT);
        if hglobal.is_null() {
            let _ = CloseClipboard();
            return Ok(vec![]);
        }

        let ptr = GlobalLock(hglobal) as *const u8;
        if ptr.is_null() {
            let _ = CloseClipboard();
            return Ok(vec![]);
        }

        let dropfiles = &*(ptr as *const DROPFILES);
        let is_wide = dropfiles.fWide != 0;
        let offset = dropfiles.pFiles as usize;

        let mut paths = Vec::new();

        if is_wide {
            let mut current = ptr.add(offset) as *const u16;
            loop {
                let mut len = 0;
                while *current.add(len) != 0 {
                    len += 1;
                }
                if len == 0 {
                    break;
                }
                let slice = std::slice::from_raw_parts(current, len);
                paths.push(String::from_utf16_lossy(slice));
                current = current.add(len + 1);
            }
        } else {
            let mut current = ptr.add(offset);
            loop {
                let mut len = 0;
                while *current.add(len) != 0 {
                    len += 1;
                }
                if len == 0 {
                    break;
                }
                let slice = std::slice::from_raw_parts(current, len);
                paths.push(String::from_utf8_lossy(slice).to_string());
                current = current.add(len + 1);
            }
        }

        let _ = GlobalUnlock(hglobal);
        let _ = CloseClipboard();

        Ok(paths)
    }
}

#[cfg(not(windows))]
fn get_windows_file_clipboard() -> Result<Vec<String>, AppError> {
    Ok(vec![])
}

#[tauri::command]
pub async fn get_clipboard_files() -> Result<Vec<String>, AppError> {
    tokio::task::spawn_blocking(get_windows_file_clipboard)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
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
pub async fn copy_between_connections(
    source_connection_id: String,
    source_path: String,
    target_connection_id: String,
    target_path: String,
    on_event: Channel<TransferEvent>,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AppError> {
    let channel = on_event.clone();
    let progress_cb: Option<crate::provider::ProgressCallback> =
        Some(Box::new(move |transferred, total| {
            let _ = channel.send(TransferEvent::Progress {
                bytes_transferred: transferred,
                total_bytes: total,
            });
        }));

    let _ = on_event.send(TransferEvent::Started { total_bytes: 0 });

    let temp_root = std::env::temp_dir()
        .join("everythingbrowser")
        .join("clipboard")
        .join(uuid::Uuid::new_v4().to_string());

    tokio::fs::create_dir_all(&temp_root)
        .await
        .map_err(|e| AppError::TransferFailed(e.to_string()))?;

    let local_name = remote_basename(&source_path);
    let local_temp_path = temp_root.join(local_name);

    let transfer_result = async {
        if is_remote_directory(manager.inner(), &source_connection_id, &source_path).await? {
            download_remote_directory(
                manager.inner(),
                &source_connection_id,
                &source_path,
                &local_temp_path,
            )
            .await?;
            upload_local_directory(
                manager.inner(),
                &target_connection_id,
                &local_temp_path,
                &target_path,
            )
            .await?;
        } else {
            manager
                .download(
                    &source_connection_id,
                    &source_path,
                    &local_temp_path,
                    progress_cb,
                )
                .await?;
            manager
                .upload(&target_connection_id, &local_temp_path, &target_path, None)
                .await?;
        }
        Ok::<(), AppError>(())
    }
    .await;

    let _ = tokio::fs::remove_dir_all(&temp_root).await;

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
pub async fn copy_to_system_clipboard(
    connection_id: String,
    remote_paths: Vec<String>,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AppError> {
    if remote_paths.is_empty() {
        return Ok(());
    }

    let clipboard_root = std::env::temp_dir()
        .join("everythingbrowser")
        .join("clipboard_exports");
    tokio::fs::create_dir_all(&clipboard_root)
        .await
        .map_err(|e| AppError::TransferFailed(e.to_string()))?;

    cleanup_old_clipboard_exports(&clipboard_root).await;

    let export_dir = clipboard_root.join(uuid::Uuid::new_v4().to_string());
    tokio::fs::create_dir_all(&export_dir)
        .await
        .map_err(|e| AppError::TransferFailed(e.to_string()))?;

    let mut used_names: HashMap<String, usize> = HashMap::new();
    let mut local_paths: Vec<PathBuf> = Vec::new();

    for remote_path in remote_paths {
        let base_name = remote_basename(&remote_path);
        let local_name = dedupe_export_name(&base_name, &mut used_names);
        let local_path = export_dir.join(local_name);

        if is_remote_directory(manager.inner(), &connection_id, &remote_path).await? {
            download_remote_directory(manager.inner(), &connection_id, &remote_path, &local_path)
                .await?;
        } else {
            manager
                .download(&connection_id, &remote_path, &local_path, None)
                .await?;
        }

        local_paths.push(local_path);
    }

    set_windows_file_clipboard(&local_paths)
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
