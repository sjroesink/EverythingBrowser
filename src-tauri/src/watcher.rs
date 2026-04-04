use notify_debouncer_mini::{new_debouncer, DebouncedEventKind, Debouncer};
use notify::RecursiveMode;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Payload emitted to the frontend when an edited file changes on disk.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditedFileChanged {
    pub temp_path: String,
    pub connection_id: String,
    pub remote_path: String,
}

struct WatcherEntry {
    /// Keep the debouncer alive — dropping it stops the watcher.
    _debouncer: Debouncer<notify::RecommendedWatcher>,
    last_activity: Arc<Mutex<Instant>>,
}

pub struct FileWatcherManager {
    watchers: Arc<Mutex<HashMap<String, WatcherEntry>>>,
}

impl FileWatcherManager {
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Start watching `temp_path` for modifications. On each save,
    /// emits an `edited-file-changed` Tauri event with the connection
    /// and remote path so the frontend can re-upload.
    pub fn watch(
        &self,
        app: AppHandle,
        temp_path: String,
        connection_id: String,
        remote_path: String,
    ) -> Result<(), String> {
        let path = PathBuf::from(&temp_path);
        if !path.exists() {
            return Err(format!("File does not exist: {}", temp_path));
        }

        // Shared timestamp for inactivity timeout
        let last_activity = Arc::new(Mutex::new(Instant::now()));
        let last_activity_clone = last_activity.clone();
        let temp_path_for_event = temp_path.clone();
        let connection_id_for_event = connection_id.clone();
        let remote_path_for_event = remote_path.clone();

        let mut debouncer = new_debouncer(
            Duration::from_millis(500),
            move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
                if let Ok(events) = result {
                    let has_modify = events
                        .iter()
                        .any(|e| matches!(e.kind, DebouncedEventKind::Any));
                    if has_modify {
                        *last_activity_clone.lock().unwrap() = Instant::now();
                        let _ = app.emit(
                            "edited-file-changed",
                            EditedFileChanged {
                                temp_path: temp_path_for_event.clone(),
                                connection_id: connection_id_for_event.clone(),
                                remote_path: remote_path_for_event.clone(),
                            },
                        );
                    }
                }
            },
        )
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

        debouncer
            .watcher()
            .watch(path.as_ref(), RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch file: {}", e))?;

        let entry = WatcherEntry {
            _debouncer: debouncer,
            last_activity: last_activity.clone(),
        };

        // Replace any existing watcher for the same temp path
        self.watchers
            .lock()
            .unwrap()
            .insert(temp_path.clone(), entry);

        // Spawn inactivity timeout (30 min)
        let temp_path_for_timeout = temp_path;
        let watchers_for_timeout = self.watchers.clone();
        tokio::spawn(async move {
            let timeout = Duration::from_secs(30 * 60);
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;
                let should_remove = {
                    let map = watchers_for_timeout.lock().unwrap();
                    match map.get(&temp_path_for_timeout) {
                        Some(entry) => {
                            entry.last_activity.lock().unwrap().elapsed() >= timeout
                        }
                        None => true, // Already removed
                    }
                };
                if should_remove {
                    watchers_for_timeout
                        .lock()
                        .unwrap()
                        .remove(&temp_path_for_timeout);
                    break;
                }
            }
        });

        Ok(())
    }

    /// Stop watching a specific file.
    pub fn stop(&self, temp_path: &str) {
        self.watchers.lock().unwrap().remove(temp_path);
    }

    /// Stop all active watchers.
    pub fn stop_all(&self) {
        self.watchers.lock().unwrap().clear();
    }
}
