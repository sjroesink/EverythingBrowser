import { useState, useCallback, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { BreadcrumbNav } from "./breadcrumb-nav";
import { Toolbar } from "./toolbar";
import { FileList } from "./file-list";
import { FileGrid } from "./file-grid";
import { ContextMenu } from "./context-menu";
import { PropertiesDialog } from "./properties-dialog";
import type { FileEntry, ProviderCapabilities } from "@/types/filesystem";
import type { ViewMode } from "@/hooks/use-file-browser";
import {
  deleteFile,
  deleteDir,
  getProviderCapabilities,
  renameItem,
  createDir,
  downloadToTemp,
  ensureDragIcon,
} from "@/services/file-service";
import { Loader2, FolderOpen, Upload } from "lucide-react";

const DRAG_THRESHOLD = 5;

interface FileBrowserProps {
  connectionId: string;
  isActive?: boolean;
  isConnected?: boolean;
  currentPath: string;
  entries: FileEntry[];
  isLoading: boolean;
  error: string | null;
  viewMode: ViewMode;
  selectedPaths: Set<string>;
  canGoBack: boolean;
  canGoForward: boolean;
  onNavigateTo: (path: string) => void;
  onRefresh: () => void;
  onGoUp: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onSetViewMode: (mode: ViewMode) => void;
  onSelect: (path: string, multi: boolean) => void;
  onDownload: (entry: FileEntry) => void;
  onUpload: () => void;
  onDropUpload: (localPaths: string[]) => void;
}

export function FileBrowser({
  connectionId,
  isActive = true,
  isConnected = true,
  currentPath,
  entries,
  isLoading,
  error,
  viewMode,
  selectedPaths,
  canGoBack,
  canGoForward,
  onNavigateTo,
  onRefresh,
  onGoUp,
  onGoBack,
  onGoForward,
  onSetViewMode,
  onSelect,
  onDownload,
  onUpload,
  onDropUpload,
}: FileBrowserProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry;
  } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newName, setNewName] = useState("");
  const [propertiesPath, setPropertiesPath] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<ProviderCapabilities | null>(
    null
  );
  const [isDragOver, setIsDragOver] = useState(false);
  const [draggedEntry, setDraggedEntry] = useState<FileEntry | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const dragOverRef = useRef(0);

  // Custom drag refs (avoid stale closures in global event handlers)
  const dragEntryRef = useRef<FileEntry | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const tempDownloadPromise = useRef<Promise<string> | null>(null);
  const nativeDragTriggered = useRef(false);
  const dragCancelledRef = useRef(false);
  const dragIconPath = useRef<string>("");
  const lastClickRef = useRef<{ path: string; time: number } | null>(null);

  // Refs for callbacks (avoid stale closures in global mouse handlers)
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const handleOpenRef = useRef<(entry: FileEntry) => void>(() => {});

  // Ensure drag icon exists on mount
  useEffect(() => {
    ensureDragIcon()
      .then((path) => {
        dragIconPath.current = path;
      })
      .catch((err) => console.error("Failed to create drag icon:", err));
  }, []);

  useEffect(() => {
    if (!isConnected) {
      setCapabilities(null);
      return;
    }

    let cancelled = false;

    const loadCapabilities = async (attempt: number) => {
      try {
        const value = await getProviderCapabilities(connectionId);
        if (!cancelled) {
          setCapabilities(value);
        }
      } catch (err) {
        if (attempt < 2 && !cancelled) {
          window.setTimeout(() => {
            if (!cancelled) {
              void loadCapabilities(attempt + 1);
            }
          }, 250);
          return;
        }
        console.error("Failed to get provider capabilities:", err);
        if (!cancelled) {
          setCapabilities(null);
        }
      }
    };

    void loadCapabilities(0);

    return () => {
      cancelled = true;
    };
  }, [connectionId, isConnected]);

  const handleOpen = useCallback(
    (entry: FileEntry) => {
      if (entry.isDir) {
        onNavigateTo(entry.path);
      }
    },
    [onNavigateTo]
  );
  handleOpenRef.current = handleOpen;

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: FileEntry) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, entry });
    },
    []
  );

  const handleDownload = useCallback(
    (entry: FileEntry) => onDownload(entry),
    [onDownload]
  );

  const handleDelete = useCallback(
    async (entry: FileEntry) => {
      try {
        if (entry.isDir) {
          await deleteDir(connectionId, entry.path, true);
        } else {
          await deleteFile(connectionId, entry.path);
        }
        onRefresh();
      } catch (e) {
        console.error("Delete failed:", e);
      }
    },
    [connectionId, onRefresh]
  );

  const handleRename = useCallback((entry: FileEntry) => {
    setRenamingPath(entry.path);
    setNewName(entry.name);
  }, []);

  const handleCopyPath = useCallback((entry: FileEntry) => {
    navigator.clipboard.writeText(entry.path);
  }, []);

  const handleProperties = useCallback((entry: FileEntry) => {
    setPropertiesPath(entry.path);
  }, []);

  const handleRenameSubmit = useCallback(
    async (oldPath: string) => {
      if (!newName.trim()) {
        setRenamingPath(null);
        return;
      }
      const parts = oldPath.split("/");
      parts[parts.length - 1] = newName.trim();
      const newPath = parts.join("/");
      try {
        await renameItem(connectionId, oldPath, newPath);
        onRefresh();
      } catch (e) {
        console.error("Rename failed:", e);
      }
      setRenamingPath(null);
    },
    [connectionId, newName, onRefresh]
  );

  const handleNewFolder = useCallback(() => {
    setNewFolderMode(true);
    setNewName("New Folder");
  }, []);

  const handleNewFolderSubmit = useCallback(async () => {
    if (!newName.trim()) {
      setNewFolderMode(false);
      return;
    }
    const path =
      currentPath === "/"
        ? `/${newName.trim()}`
        : `${currentPath}/${newName.trim()}`;
    try {
      await createDir(connectionId, path);
      onRefresh();
    } catch (e) {
      console.error("Create folder failed:", e);
    }
    setNewFolderMode(false);
  }, [connectionId, currentPath, newName, onRefresh]);

  const clearDragVisualState = useCallback(() => {
    document.body.style.cursor = "";
    setDraggedEntry(null);
    setDropTargetPath(null);
  }, []);

  const resetDragState = useCallback(() => {
    dragEntryRef.current = null;
    dragStartPos.current = null;
    isDraggingRef.current = false;
    tempDownloadPromise.current = null;
    nativeDragTriggered.current = false;
    dragCancelledRef.current = false;
    clearDragVisualState();
  }, [clearDragVisualState]);

  const triggerNativeFileDragOut = useCallback(() => {
    if (!dragEntryRef.current) return;
    if (nativeDragTriggered.current) return;

    nativeDragTriggered.current = true;
    dragCancelledRef.current = false;

    const draggedPath = dragEntryRef.current.path;
    const tempPromise =
      tempDownloadPromise.current ??
      downloadToTemp(connectionId, draggedPath).catch((err) => {
        console.error("Temp download failed:", err);
        return "";
      });
    const iconPath = dragIconPath.current;
    clearDragVisualState();

    (async () => {
      try {
        const tempPath = tempPromise ? await tempPromise : "";
        if (tempPath && !dragCancelledRef.current) {
          await startDrag(
            { item: [tempPath], icon: iconPath, mode: "copy" },
            ({ result }) => {
              if (result === "Cancelled") {
                dragCancelledRef.current = true;
              }
            }
          );
        }
      } catch (err) {
        console.error("Native drag failed:", err);
      } finally {
        resetDragState();
      }
    })();
  }, [clearDragVisualState, connectionId, resetDragState]);

  // Custom drag: mousedown on an entry
  const handleMouseDownEntry = useCallback(
    (entry: FileEntry, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      // Prevent browser from starting text selection or native drag
      e.preventDefault();
      dragEntryRef.current = entry;
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      isDraggingRef.current = false;
      tempDownloadPromise.current = null;
      nativeDragTriggered.current = false;
      dragCancelledRef.current = false;
    },
    []
  );

  // Keyboard shortcuts
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        onRefresh();
      }
      if (e.key === "Backspace" && !renamingPath && !newFolderMode) {
        onGoUp();
      }
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        onGoBack();
      }
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        onGoForward();
      }
    };

    // Mouse back/forward buttons (buttons 3 & 4)
    const handleMouseUpNav = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        onGoBack();
      }
      if (e.button === 4) {
        e.preventDefault();
        onGoForward();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mouseup", handleMouseUpNav);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mouseup", handleMouseUpNav);
    };
  }, [isActive, onRefresh, onGoUp, onGoBack, onGoForward, renamingPath, newFolderMode]);

  // Tauri native file drop from desktop
  useEffect(() => {
    if (!isActive) return;

    const unlisteners: (() => void)[] = [];

    const preventWebviewDrop = (event: DragEvent) => {
      event.preventDefault();
    };

    window.addEventListener("dragover", preventWebviewDrop);
    window.addEventListener("drop", preventWebviewDrop);

    listen<{ paths: string[]; position: { x: number; y: number } }>(
      "tauri://drag-enter",
      () => {
        dragOverRef.current++;
        setIsDragOver(true);
      }
    ).then((u) => unlisteners.push(u));

    listen("tauri://drag-leave", () => {
      dragOverRef.current--;
      if (dragOverRef.current <= 0) {
        dragOverRef.current = 0;
        setIsDragOver(false);
      }
    }).then((u) => unlisteners.push(u));

    listen<{ paths: string[]; position: { x: number; y: number } }>(
      "tauri://drag-drop",
      (event) => {
        setIsDragOver(false);
        dragOverRef.current = 0;
        if (event.payload.paths.length > 0) {
          onDropUpload(event.payload.paths);
        }
      }
    ).then((u) => unlisteners.push(u));

    return () => {
      unlisteners.forEach((u) => u());
      window.removeEventListener("dragover", preventWebviewDrop);
      window.removeEventListener("drop", preventWebviewDrop);
    };
  }, [isActive, onDropUpload]);

  // Custom drag: global mousemove + mouseup handlers
  useEffect(() => {
    if (!isActive) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (
        !dragStartPos.current ||
        !dragEntryRef.current ||
        nativeDragTriggered.current
      )
        return;

      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Check drag threshold
      if (!isDraggingRef.current) {
        if (dist < DRAG_THRESHOLD) return;
        isDraggingRef.current = true;
        setDraggedEntry(dragEntryRef.current);
        document.body.style.cursor = "grabbing";

        // Prefetch only for files; folders can be very large and are fetched on drag-out.
        if (!dragEntryRef.current.isDir) {
          tempDownloadPromise.current = downloadToTemp(
            connectionId,
            dragEntryRef.current.path
          ).catch((err) => {
            console.error("Temp download failed:", err);
            return "";
          });
        }
        return;
      }

      // During drag: hit-test for folder drop targets using data attributes
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el) {
        const row = (el as HTMLElement).closest("[data-entry-path]");
        if (row && row.getAttribute("data-is-dir") === "true") {
          const path = row.getAttribute("data-entry-path");
          if (path && path !== dragEntryRef.current.path) {
            setDropTargetPath(path);
          } else {
            setDropTargetPath(null);
          }
        } else {
          setDropTargetPath(null);
        }
      } else {
        setDropTargetPath(null);
      }

      // Check if mouse is outside the window → trigger native drag-out
      const outsideWindow =
        e.clientX < 0 ||
        e.clientY < 0 ||
        e.clientX > window.innerWidth ||
        e.clientY > window.innerHeight;

      if (outsideWindow) {
        triggerNativeFileDragOut();
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      if (!dragEntryRef.current) return;
      if (nativeDragTriggered.current) return;

      if (!e.relatedTarget) {
        triggerNativeFileDragOut();
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (!dragStartPos.current && !nativeDragTriggered.current) return;

      // If native drag was triggered, signal cancellation
      if (nativeDragTriggered.current) {
        dragCancelledRef.current = true;
        dragStartPos.current = null;
        dragEntryRef.current = null;
        isDraggingRef.current = false;
        tempDownloadPromise.current = null;
        clearDragVisualState();
        return;
      }

      const entry = dragEntryRef.current;

      if (isDraggingRef.current && entry) {
        // Drag completed — check if dropped on a folder via hit-testing
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const row = el
          ? (el as HTMLElement).closest("[data-entry-path]")
          : null;

        if (row && row.getAttribute("data-is-dir") === "true") {
          const targetPath = row.getAttribute("data-entry-path");
          if (targetPath && targetPath !== entry.path) {
            const fileName = entry.name;
            const newPath =
              targetPath === "/"
                ? `/${fileName}`
                : `${targetPath}/${fileName}`;
            renameItem(connectionId, entry.path, newPath)
              .then(() => onRefresh())
              .catch((err: unknown) => console.error("Move failed:", err));
          }
        }
      } else if (entry) {
        // No drag happened (threshold not met) → treat as click
        const now = Date.now();
        const last = lastClickRef.current;

        if (last && last.path === entry.path && now - last.time < 400) {
          // Double-click → open
          handleOpenRef.current(entry);
          lastClickRef.current = null;
        } else {
          // Single click → select
          onSelectRef.current(entry.path, e.ctrlKey || e.metaKey);
          lastClickRef.current = { path: entry.path, time: now };
        }
      }

      // Clean up all drag state
      resetDragState();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseout", handleMouseOut);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseout", handleMouseOut);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    isActive,
    connectionId,
    onRefresh,
    clearDragVisualState,
    resetDragState,
    triggerNativeFileDragOut,
  ]);

  return (
    <div className="flex flex-col h-full relative">
      {/* Toolbar row */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border">
        <Toolbar
          viewMode={viewMode}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          isLoading={isLoading}
          onGoBack={onGoBack}
          onGoForward={onGoForward}
          onGoUp={onGoUp}
          onRefresh={onRefresh}
          onUpload={onUpload}
          onNewFolder={handleNewFolder}
          onSetViewMode={onSetViewMode}
        />
      </div>

      {/* Breadcrumb row */}
      <div className="flex items-center px-3 py-1.5 border-b border-border bg-secondary/30">
        <BreadcrumbNav currentPath={currentPath} onNavigate={onNavigateTo} />
      </div>

      {/* New folder input */}
      {newFolderMode && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border-b border-border">
          <FolderOpen className="w-4 h-4 text-primary" />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleNewFolderSubmit();
              if (e.key === "Escape") setNewFolderMode(false);
            }}
            onBlur={handleNewFolderSubmit}
            autoFocus
            className="flex-1 px-2 py-1 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 flex flex-col min-h-0">
        {error ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-destructive">{error}</p>
              <button
                onClick={onRefresh}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Try again
              </button>
            </div>
          </div>
        ) : isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <FolderOpen className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">This folder is empty</p>
            </div>
          </div>
        ) : viewMode === "list" ? (
          <FileList
            entries={entries}
            selectedPaths={selectedPaths}
            draggedEntry={draggedEntry}
            dropTargetPath={dropTargetPath}
            onContextMenu={handleContextMenu}
            onMouseDownEntry={handleMouseDownEntry}
          />
        ) : (
          <FileGrid
            entries={entries}
            selectedPaths={selectedPaths}
            draggedEntry={draggedEntry}
            dropTargetPath={dropTargetPath}
            onContextMenu={handleContextMenu}
            onMouseDownEntry={handleMouseDownEntry}
          />
        )}
      </div>

      {/* Drop overlay for desktop file drops */}
      {isDragOver && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-primary/5 border-2 border-dashed border-primary/40 rounded-lg m-1 pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Upload className="w-10 h-10" />
            <span className="text-sm font-medium">Drop files to upload</span>
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
          onClose={() => setContextMenu(null)}
          onDownload={handleDownload}
          onDelete={handleDelete}
          onRename={handleRename}
          onOpen={handleOpen}
          onCopyPath={handleCopyPath}
          onProperties={handleProperties}
          showProperties={Boolean(capabilities?.fileProperties)}
        />
      )}

      <PropertiesDialog
        connectionId={connectionId}
        path={propertiesPath}
        capabilities={capabilities}
        isOpen={propertiesPath !== null}
        onClose={() => setPropertiesPath(null)}
        onSaved={onRefresh}
      />

      {/* Inline rename */}
      {renamingPath && (
        <div className="fixed inset-0 z-40" onClick={() => setRenamingPath(null)}>
          <div
            className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg p-3"
            style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Rename
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSubmit(renamingPath);
                if (e.key === "Escape") setRenamingPath(null);
              }}
              autoFocus
              className="w-64 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => setRenamingPath(null)}
                className="px-3 py-1.5 text-xs rounded-md hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRenameSubmit(renamingPath)}
                className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
