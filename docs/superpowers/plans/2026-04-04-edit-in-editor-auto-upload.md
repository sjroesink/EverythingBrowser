# Edit in Editor: Auto-Upload on Save — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user edits a remote file in their local editor, automatically re-upload it on every save.

**Architecture:** A Rust `FileWatcherManager` (Tauri managed state) holds per-file `notify` watchers. After opening a temp file in the editor, the frontend calls `watch_edited_file` which starts a debounced file watcher. On modification, a Tauri event is emitted. The frontend listens globally and triggers a silent `uploadFile`. Watchers auto-expire after 30 min of inactivity.

**Tech Stack:** Rust `notify` crate (v7) with `notify-debouncer-mini`, Tauri events, existing `uploadFile` infrastructure.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src-tauri/Cargo.toml` | Modify | Add `notify` + `notify-debouncer-mini` deps |
| `src-tauri/src/watcher.rs` | Create | `FileWatcherManager` state, watcher lifecycle, timeout logic |
| `src-tauri/src/commands/watcher_commands.rs` | Create | Tauri commands: `watch_edited_file`, `stop_watching_file`, `stop_all_watchers` |
| `src-tauri/src/commands/mod.rs` | Modify | Add `pub mod watcher_commands;` |
| `src-tauri/src/lib.rs` | Modify | Register watcher state + commands |
| `src/services/file-service.ts` | Modify | Add `watchEditedFile`, `stopWatchingFile` exports |
| `src/components/browser/file-browser.tsx` | Modify | Call watcher after editor open, listen for events + upload |

---

### Task 1: Add `notify` dependencies to Cargo.toml

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add notify and notify-debouncer-mini to dependencies**

In `src-tauri/Cargo.toml`, add these two lines to the `[dependencies]` section (after the existing `futures-util` line):

```toml
notify = "7"
notify-debouncer-mini = "0.5"
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully (may download new crates).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: add notify crate for file watching"
```

---

### Task 2: Create `FileWatcherManager` in `src-tauri/src/watcher.rs`

**Files:**
- Create: `src-tauri/src/watcher.rs`

- [ ] **Step 1: Create the watcher module**

Create `src-tauri/src/watcher.rs` with the following content:

```rust
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
```

- [ ] **Step 2: Add `mod watcher;` to `src-tauri/src/lib.rs`**

At the top of `src-tauri/src/lib.rs`, add `mod watcher;` after the existing module declarations. The module list should read:

```rust
mod commands;
mod connection;
mod credentials;
mod error;
mod importer;
mod provider;
mod watcher;
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/watcher.rs src-tauri/src/lib.rs
git commit -m "feat: add FileWatcherManager for edit-in-editor file watching"
```

---

### Task 3: Create watcher Tauri commands

**Files:**
- Create: `src-tauri/src/commands/watcher_commands.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Create the watcher commands file**

Create `src-tauri/src/commands/watcher_commands.rs`:

```rust
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
```

- [ ] **Step 2: Register the module in `commands/mod.rs`**

Add this line to `src-tauri/src/commands/mod.rs`:

```rust
pub mod watcher_commands;
```

The full file should be:

```rust
pub mod connection_commands;
pub mod credential_commands;
pub mod docker_commands;
pub mod editor_commands;
pub mod file_commands;
pub mod watcher_commands;
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles (commands not yet registered in handler, but module compiles).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/watcher_commands.rs src-tauri/src/commands/mod.rs
git commit -m "feat: add Tauri commands for file watcher"
```

---

### Task 4: Register watcher state and commands in `lib.rs`

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `FileWatcherManager` to managed state**

In `src-tauri/src/lib.rs`, add this import at the top (after the existing `use` statements):

```rust
use watcher::FileWatcherManager;
```

Then add `.manage(FileWatcherManager::new())` after the existing `.manage(CliLaunchState(...))` line. The chain should read:

```rust
        .manage(ConnectionManager::new())
        .manage(CliLaunchState(Mutex::new(None)))
        .manage(FileWatcherManager::new())
```

- [ ] **Step 2: Register the three watcher commands**

Add these three lines to the `invoke_handler(tauri::generate_handler![...])` block, after the `detect_editors` line:

```rust
            commands::watcher_commands::watch_edited_file,
            commands::watcher_commands::stop_watching_file,
            commands::watcher_commands::stop_all_watchers,
```

- [ ] **Step 3: Add `stop_all_watchers` call on app exit**

In the `.run(|app, event| { ... })` closure, add `stop_all_watchers` before the disconnect call. The closure should become:

```rust
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Stop all file watchers
                let watcher_mgr: tauri::State<'_, FileWatcherManager> = app.state();
                watcher_mgr.stop_all();
                // Disconnect all active connections (cleans up Docker helper containers)
                let manager: tauri::State<'_, ConnectionManager> = app.state();
                tauri::async_runtime::block_on(async {
                    let _ = manager.disconnect_all().await;
                });
            }
        });
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully with no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: register FileWatcherManager state and commands"
```

---

### Task 5: Add frontend service functions

**Files:**
- Modify: `src/services/file-service.ts`

- [ ] **Step 1: Add `watchEditedFile` and `stopWatchingFile` exports**

Add the following two functions at the end of `src/services/file-service.ts` (before the closing of the file, after `detectEditors`):

```typescript
export async function watchEditedFile(
  tempPath: string,
  connectionId: string,
  remotePath: string
): Promise<void> {
  return invoke("watch_edited_file", { tempPath, connectionId, remotePath });
}

export async function stopWatchingFile(tempPath: string): Promise<void> {
  return invoke("stop_watching_file", { tempPath });
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/services/file-service.ts
git commit -m "feat: add watchEditedFile and stopWatchingFile service functions"
```

---

### Task 6: Wire up auto-upload in `file-browser.tsx`

**Files:**
- Modify: `src/components/browser/file-browser.tsx`

- [ ] **Step 1: Add imports**

In `src/components/browser/file-browser.tsx`, add `watchEditedFile` to the existing import from `@/services/file-service`:

Change:
```typescript
import {
  deleteFile,
  deleteDir,
  getProviderCapabilities,
  renameItem,
  createDir,
  downloadToTemp,
  ensureDragIcon,
  getClipboardFiles,
  openInEditor,
} from "@/services/file-service";
```

To:
```typescript
import {
  deleteFile,
  deleteDir,
  getProviderCapabilities,
  renameItem,
  createDir,
  downloadToTemp,
  ensureDragIcon,
  getClipboardFiles,
  openInEditor,
  uploadFile,
  watchEditedFile,
} from "@/services/file-service";
```

- [ ] **Step 2: Update `handleEditInEditor` to start watcher**

Replace the existing `handleEditInEditor` callback (lines 320-331):

From:
```typescript
  const handleEditInEditor = useCallback(
    async (entry: FileEntry) => {
      if (!editorPath) return;
      try {
        const localPath = await downloadToTemp(connectionId, entry.path);
        await openInEditor(editorPath, localPath);
      } catch (e) {
        console.error("Edit in editor failed:", e);
      }
    },
    [connectionId, editorPath]
  );
```

To:
```typescript
  const handleEditInEditor = useCallback(
    async (entry: FileEntry) => {
      if (!editorPath) return;
      try {
        const localPath = await downloadToTemp(connectionId, entry.path);
        await openInEditor(editorPath, localPath);
        await watchEditedFile(localPath, connectionId, entry.path);
      } catch (e) {
        console.error("Edit in editor failed:", e);
      }
    },
    [connectionId, editorPath]
  );
```

- [ ] **Step 3: Add event listener for `edited-file-changed`**

In the existing `useEffect` that sets up drag event listeners (the one that starts with `const unlisteners: (() => void)[] = [];`), add a listener for the `edited-file-changed` event. Find the `useEffect` that contains the `tauri://drag-enter` listener and add the following block right after the `tauri://drag-drop` listener registration:

```typescript
    listen<{
      tempPath: string;
      connectionId: string;
      remotePath: string;
    }>("edited-file-changed", (event) => {
      const { tempPath, connectionId: connId, remotePath } = event.payload;
      uploadFile(connId, tempPath, remotePath, () => {}).catch((e) =>
        console.error("Auto-upload after editor save failed:", e)
      );
    }).then((u) => unlisteners.push(u));
```

This listener:
- Receives the event payload with temp path, connection ID, and remote path
- Calls `uploadFile` with a no-op progress callback
- Catches and logs any upload errors silently

- [ ] **Step 4: Verify frontend builds**

Run: `npx vite build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 5: Verify full app compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully.

- [ ] **Step 6: Commit**

```bash
git add src/components/browser/file-browser.tsx
git commit -m "feat: auto-upload remote files on save in editor"
```

---

### Task 7: Manual integration test

- [ ] **Step 1: Start the dev server**

Run: `cargo tauri dev`

- [ ] **Step 2: Test basic flow**

1. Connect to a remote server (SFTP)
2. Right-click a text file -> "Edit in Editor"
3. Verify file opens in your configured editor
4. Make a change and save in the editor
5. Check the remote server — the file should have the new content

- [ ] **Step 3: Test multiple files**

1. Open two different remote files in the editor
2. Save both
3. Verify both upload correctly

- [ ] **Step 4: Test connection error resilience**

1. Open a remote file in editor
2. Disconnect the connection in EverythingBrowser
3. Save in editor
4. Verify console shows error but no crash

- [ ] **Step 5: Commit any fixes if needed**
