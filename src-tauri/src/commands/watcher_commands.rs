use crate::error::AppError;
use crate::watcher::FileWatcherManager;
use tauri::State;

#[tauri::command]
pub fn watch_edited_file(
    temp_path: String,
    connection_id: String,
    remote_path: String,
    app: tauri::AppHandle,
    manager: State<'_, FileWatcherManager>,
) -> Result<(), AppError> {
    manager
        .watch(app, temp_path, connection_id, remote_path)
        .map_err(AppError::Internal)
}

#[tauri::command]
pub fn stop_watching_file(
    temp_path: String,
    manager: State<'_, FileWatcherManager>,
) -> Result<(), AppError> {
    manager.stop(&temp_path);
    Ok(())
}

#[tauri::command]
pub fn stop_all_watchers(
    manager: State<'_, FileWatcherManager>,
) -> Result<(), AppError> {
    manager.stop_all();
    Ok(())
}
