# Edit in Editor: Auto-Upload on Save

## Problem

When a user right-clicks a remote file and chooses "Edit in Editor", the file is downloaded to a temp directory and opened in their configured editor. However, saving the file in the editor does nothing — the changes are never uploaded back to the remote server. The user expects save-and-upload behavior similar to Cyberduck or other file transfer clients.

## Solution

Add a file watcher (using the `notify` crate) that monitors the temp file after it's opened in an editor. When the editor saves the file, automatically re-upload it to the original remote path. The feature is invisible to the user — no UI indicators, no manual actions required. Watchers auto-stop after 30 minutes of inactivity.

## Architecture

### Rust Side

**New dependency:** `notify` crate (with debouncer) in `Cargo.toml`.

**New module:** `src-tauri/src/watcher.rs` — `FileWatcherManager`

- Holds a `HashMap<String, WatcherEntry>` keyed by temp file path
- Each `WatcherEntry` contains: the `notify` watcher handle, `connection_id`, `remote_path`, and a last-activity timestamp
- Managed as Tauri state (`app.manage(FileWatcherManager::new())`)

**New commands in `src-tauri/src/commands/editor_commands.rs`:**

1. `watch_edited_file(temp_path: String, connection_id: String, remote_path: String, app: AppHandle)` 
   - Creates a `notify` watcher on `temp_path` with 500ms debounce
   - On modification event, emits Tauri event `edited-file-changed` with payload `{ tempPath, connectionId, remotePath }`
   - Resets the 30-min inactivity timer on each modification
   - Spawns a background task that checks and removes the watcher after 30 min of no changes

2. `stop_watching_file(temp_path: String)`
   - Removes the watcher for the given path
   - Called for explicit cleanup

3. `stop_all_watchers()`
   - Clears all watchers
   - Called on app shutdown or could be triggered on connection disconnect

**Debouncing:** Use `notify-debouncer-mini` or the built-in debouncer to coalesce rapid write events (editors often write temp files, rename, etc.) into a single event per 500ms window.

**Inactivity timeout:** Each watcher entry tracks `last_activity: Instant`. A spawned `tokio::spawn` task sleeps in a loop (checking every 60s) and drops the watcher if 30 minutes have passed since last activity.

### Frontend Side

**In `file-browser.tsx` — `handleEditInEditor`:**

```
1. const localPath = await downloadToTemp(connectionId, entry.path)
2. await openInEditor(editorPath, localPath)
3. await watchEditedFile(localPath, connectionId, entry.path)  // NEW
```

**Global event listener** (in `file-browser.tsx` or a dedicated hook):

- Listen for `edited-file-changed` Tauri events
- On event: call `uploadFile(event.connectionId, event.tempPath, event.remotePath, onEvent)` 
- The `onEvent` transfer callback can be a no-op or log to console (no visible transfer progress for background re-uploads)

**Cleanup:** Unlisten on component unmount. No other cleanup needed — Rust side handles timeouts.

### New file-service.ts exports

```typescript
export async function watchEditedFile(
  tempPath: string,
  connectionId: string, 
  remotePath: string
): Promise<void>

export async function stopWatchingFile(tempPath: string): Promise<void>
```

## Data Flow

```
User: "Edit in Editor" on remote file /srv/config.yaml
  -> downloadToTemp("conn-1", "/srv/config.yaml") -> C:\Users\...\Temp\everythingbrowser\config.yaml
  -> openInEditor("code", "C:\...\config.yaml")
  -> watchEditedFile("C:\...\config.yaml", "conn-1", "/srv/config.yaml")
  
User saves file in VS Code:
  -> notify detects modification
  -> 500ms debounce
  -> Tauri emits "edited-file-changed" { tempPath, connectionId: "conn-1", remotePath: "/srv/config.yaml" }
  -> Frontend receives event
  -> uploadFile("conn-1", "C:\...\config.yaml", "/srv/config.yaml", noop)
  -> File uploaded silently

30 min no saves:
  -> Rust timeout task removes watcher
  -> No more events emitted
```

## Edge Cases

- **Multiple files edited simultaneously:** Each gets its own watcher entry, keyed by temp path. No conflicts.
- **Same file opened twice:** Second `watchEditedFile` call replaces the first watcher (same temp path key).
- **Connection lost during upload:** Upload fails silently (console.error). The watcher remains active — next save will retry.
- **Editor locks file:** `notify` watches filesystem events, not file handles. Should work regardless of editor locking behavior.
- **File deleted (editor closes without saving):** `notify` may emit a remove event — ignore it. Watcher stays until timeout.
- **Filename collision in temp dir:** The existing `downloadToTemp` uses just the basename, so two files named `config.yaml` from different paths would collide. This is a pre-existing issue, not introduced by this feature.

## Error Handling

- Watcher creation failure: return error from `watch_edited_file` command, log in frontend, editor still opens (graceful degradation).
- Upload failure on save: log to `console.error`. No user notification. Watcher continues — next save retries.
- Event listener errors: catch and log.

## Testing

- Manual: open remote file in editor, save, verify file appears on remote with new content.
- Edge: open two files, save both, verify both upload correctly.
- Timeout: open file, wait 30+ min, verify watcher is cleaned up (check via `stop_watching_file` not erroring or similar).

## Files to Create/Modify

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `notify-debouncer-mini` dependency |
| `src-tauri/src/watcher.rs` | New: `FileWatcherManager`, watcher logic, timeout |
| `src-tauri/src/commands/editor_commands.rs` | Add `watch_edited_file`, `stop_watching_file`, `stop_all_watchers` commands |
| `src-tauri/src/lib.rs` | Register new commands, manage `FileWatcherManager` state |
| `src/services/file-service.ts` | Add `watchEditedFile`, `stopWatchingFile` exports |
| `src/components/browser/file-browser.tsx` | Call `watchEditedFile` after opening editor, listen for events + trigger upload |
