import { useState, useCallback, useEffect, useRef, useMemo } from "react";
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
  getClipboardFiles,
} from "@/services/file-service";
import { useLayoutStore } from "@/stores/use-layout-store";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { isEditableTarget } from "@/lib/keyboard";
import { Loader2, FolderOpen, Upload } from "lucide-react";

const DRAG_THRESHOLD = 5;

function parseClipboardPaths(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

  return lines.filter((line) => {
    if (line.startsWith("\\\\")) return true;
    if (/^[a-zA-Z]:\\/.test(line)) return true;
    return line.startsWith("/");
  });
}

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
  focusedIndex: number;
  canGoBack: boolean;
  canGoForward: boolean;
  onNavigateTo: (path: string) => void;
  onRefresh: () => void;
  onGoUp: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onSetViewMode: (mode: ViewMode) => void;
  onSelect: (path: string, multi: boolean) => void;
  onSelectAll: () => void;
  onMoveCursor: (delta: number) => void;
  onExtendSelection: (delta: number) => void;
  onMoveCursorOnly: (delta: number) => void;
  onToggleFocusedSelection: () => void;
  onJumpTo: (index: number) => void;
  onSelectToEdge: (index: number) => void;
  onOpenFocused: () => void;
  onDownload: (entry: FileEntry) => void;
  onUpload: () => void;
  onDropUpload: (localPaths: string[]) => void;
  onCopyEntries: (entries: FileEntry[]) => void;
  onPasteIntoPath: (targetPath: string) => void;
  canPaste: boolean;
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
  focusedIndex,
  canGoBack,
  canGoForward,
  onNavigateTo,
  onRefresh,
  onGoUp,
  onGoBack,
  onGoForward,
  onSetViewMode,
  onSelect,
  onSelectAll,
  onMoveCursor,
  onExtendSelection,
  onMoveCursorOnly,
  onToggleFocusedSelection,
  onJumpTo,
  onSelectToEdge,
  onOpenFocused,
  onDownload,
  onUpload,
  onDropUpload,
  onCopyEntries,
  onPasteIntoPath,
  canPaste,
}: FileBrowserProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    mode: "entry" | "folder";
    entry: FileEntry | null;
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Custom drag refs (avoid stale closures in global event handlers)
  const dragEntryRef = useRef<FileEntry | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const tempDownloadPromise = useRef<Promise<string> | null>(null);
  const nativeDragTriggered = useRef(false);
  const dragCancelledRef = useRef(false);
  const dragIconPath = useRef<string>("");
  const lastClickRef = useRef<{ path: string; time: number } | null>(null);

  // Refs for callbacks and data (avoid stale closures in global mouse handlers)
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const selectedPathsRef = useRef(selectedPaths);
  selectedPathsRef.current = selectedPaths;
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
      if (entry.name === "..") {
        onGoUp();
      } else if (entry.isDir) {
        onNavigateTo(entry.path);
      }
    },
    [onNavigateTo, onGoUp]
  );
  handleOpenRef.current = handleOpen;

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, mode: "entry", entry });
  }, []);

  const handleFolderContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("[data-entry-path]")) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, mode: "folder", entry: null });
  }, []);

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

  const handleDeleteSelected = useCallback(async () => {
    const selected = entries.filter(
      (e) => selectedPaths.has(e.path) && e.name !== ".."
    );
    if (selected.length === 0) {
      // Fall back to focused entry
      const focused = entries[focusedIndex];
      if (focused && focused.name !== "..") {
        await handleDelete(focused);
      }
      return;
    }
    for (const entry of selected) {
      try {
        if (entry.isDir) {
          await deleteDir(connectionId, entry.path, true);
        } else {
          await deleteFile(connectionId, entry.path);
        }
      } catch (e) {
        console.error("Delete failed:", e);
      }
    }
    onRefresh();
  }, [entries, selectedPaths, focusedIndex, connectionId, onRefresh, handleDelete]);

  const handleRename = useCallback((entry: FileEntry) => {
    setRenamingPath(entry.path);
    setNewName(entry.name);
  }, []);

  const handleRenameSelected = useCallback(() => {
    const focused = entries[focusedIndex];
    if (focused && focused.name !== "..") {
      handleRename(focused);
    }
  }, [entries, focusedIndex, handleRename]);

  const handleCopyPath = useCallback((entry: FileEntry) => {
    navigator.clipboard.writeText(entry.path);
  }, []);

  const handleCopyEntry = useCallback(
    (entry: FileEntry) => {
      const selectedEntries = entries.filter((item) => selectedPaths.has(item.path));
      if (selectedPaths.has(entry.path) && selectedEntries.length > 0) {
        onCopyEntries(selectedEntries);
        return;
      }
      onCopyEntries([entry]);
    },
    [entries, selectedPaths, onCopyEntries]
  );

  const handlePasteInto = useCallback(
    (targetPath: string) => {
      if (!canPaste) return;
      onPasteIntoPath(targetPath);
    },
    [canPaste, onPasteIntoPath]
  );

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
      // Don't start drag on ".." entry
      if (entry.name === "..") return;
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

  // Keyboard shortcuts via centralized system
  const keyboardHandlers = useMemo(
    () => ({
      "file.refresh": () => onRefresh(),
      "file.goUp": () => {
        if (!renamingPath && !newFolderMode) onGoUp();
      },
      "file.copy": () => {
        const selected = entries.filter((entry) => selectedPaths.has(entry.path));
        if (selected.length > 0) {
          onCopyEntries(selected);
        }
      },
      "file.paste": () => {
        void (async () => {
          try {
            const clipboardFiles = await getClipboardFiles();
            if (clipboardFiles.length > 0) {
              onDropUpload(clipboardFiles);
              return;
            }
          } catch {
            // No clipboard files available
          }
          if (canPaste) onPasteIntoPath(currentPath);
        })();
      },
      "file.selectAll": () => onSelectAll(),
      "file.rename": () => handleRenameSelected(),
      "file.delete": () => {
        void handleDeleteSelected();
      },
      "file.cursorUp": () => onMoveCursor(-1),
      "file.cursorDown": () => onMoveCursor(1),
      "file.selectUp": () => onExtendSelection(-1),
      "file.selectDown": () => onExtendSelection(1),
      "file.moveCursorUp": () => onMoveCursorOnly(-1),
      "file.moveCursorDown": () => onMoveCursorOnly(1),
      "file.toggleSelect": () => onToggleFocusedSelection(),
      "file.cursorHome": () => onJumpTo(0),
      "file.cursorEnd": () => onJumpTo(entries.length - 1),
      "file.selectToHome": () => onSelectToEdge(0),
      "file.selectToEnd": () => onSelectToEdge(entries.length - 1),
      "file.open": () => {
        if (!renamingPath && !newFolderMode) onOpenFocused();
      },
    }),
    [
      onRefresh,
      renamingPath,
      newFolderMode,
      onGoUp,
      entries,
      selectedPaths,
      onCopyEntries,
      canPaste,
      onPasteIntoPath,
      onDropUpload,
      currentPath,
      onSelectAll,
      handleRenameSelected,
      handleDeleteSelected,
      onMoveCursor,
      onExtendSelection,
      onMoveCursorOnly,
      onToggleFocusedSelection,
      onJumpTo,
      onSelectToEdge,
      onOpenFocused,
    ]
  );

  useKeyboardShortcuts(keyboardHandlers, { enabled: isActive });

  // Paste event listener (clipboard files / local paths)
  useEffect(() => {
    if (!isActive) return;

    const handlePasteEvent = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return;

      // Extract clipboard data synchronously before it gets nulled
      const files = Array.from(e.clipboardData?.files ?? []);
      const filePaths = files
        .map((file) => (file as File & { path?: string }).path)
        .filter((value): value is string => Boolean(value));
      const text = e.clipboardData?.getData("text/plain") ?? "";

      e.preventDefault();

      void (async () => {
        // Try system clipboard files (e.g. Windows Explorer copy)
        try {
          const clipboardFiles = await getClipboardFiles();
          if (clipboardFiles.length > 0) {
            onDropUpload(clipboardFiles);
            return;
          }
        } catch {
          // Not available
        }

        if (filePaths.length > 0) {
          onDropUpload(filePaths);
          return;
        }

        const localPaths = parseClipboardPaths(text);
        if (localPaths.length > 0) {
          onDropUpload(localPaths);
          return;
        }

        if (canPaste) {
          onPasteIntoPath(currentPath);
        }
      })();
    };

    window.addEventListener("paste", handlePasteEvent);
    return () => window.removeEventListener("paste", handlePasteEvent);
  }, [isActive, canPaste, onPasteIntoPath, currentPath, onDropUpload]);

  // Mouse back/forward buttons (buttons 3 & 4)
  useEffect(() => {
    if (!isActive) return;

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

    window.addEventListener("mouseup", handleMouseUpNav);
    return () => window.removeEventListener("mouseup", handleMouseUpNav);
  }, [isActive, onGoBack, onGoForward]);

  // Tauri native file drop from desktop (position-based: works for all visible panes)
  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    const preventWebviewDrop = (event: DragEvent) => {
      event.preventDefault();
    };

    window.addEventListener("dragover", preventWebviewDrop);
    window.addEventListener("drop", preventWebviewDrop);

    listen<{ paths: string[]; position: { x: number; y: number } }>(
      "tauri://drag-enter",
      () => {
        setIsDragOver(true);
      }
    ).then((u) => unlisteners.push(u));

    listen("tauri://drag-leave", () => {
      setIsDragOver(false);
    }).then((u) => unlisteners.push(u));

    listen<{ paths: string[]; position: { x: number; y: number } }>(
      "tauri://drag-drop",
      (event) => {
        setIsDragOver(false);

        // Only handle if the drop position is within this browser's bounds
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const { x, y } = event.payload.position;
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
          return;
        }

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
  }, [onDropUpload]);

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

      // Check if mouse is outside the current pane → escalate to global file drag
      const paneEl = document.querySelector(`[data-pane-id]`)
        ? (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest("[data-pane-id]")
        : null;
      const currentPaneId = paneEl?.getAttribute("data-pane-id") ?? null;

      // Find which pane this file browser belongs to
      const ownerPane = document.querySelector(
        `[data-pane-id] [data-connection-id="${connectionId}"]`
      )?.closest("[data-pane-id]");
      const ownerPaneId = ownerPane?.getAttribute("data-pane-id") ?? null;

      if (ownerPaneId && currentPaneId !== ownerPaneId) {
        // Cursor left the source pane — escalate to global overlay
        const entry = dragEntryRef.current;
        if (entry) {
          const curEntries = entriesRef.current;
          const curSelected = selectedPathsRef.current;
          const allEntries = curEntries.filter((e) => curSelected.has(e.path));
          const dragEntries =
            curSelected.has(entry.path) && allEntries.length > 0
              ? allEntries.map((e) => ({ path: e.path, name: e.name, isDir: e.isDir }))
              : [{ path: entry.path, name: entry.name, isDir: entry.isDir }];

          useLayoutStore.getState().startFileDrag(connectionId, ownerPaneId, dragEntries);
          resetDragState();
          return;
        }
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
    <div ref={containerRef} className="flex flex-col h-full relative" data-connection-id={connectionId}>
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
      <div className="flex-1 flex flex-col min-h-0" onContextMenu={handleFolderContextMenu}>
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
            focusedIndex={focusedIndex}
            draggedEntry={draggedEntry}
            dropTargetPath={dropTargetPath}
            onContextMenu={handleContextMenu}
            onMouseDownEntry={handleMouseDownEntry}
          />
        ) : (
          <FileGrid
            entries={entries}
            selectedPaths={selectedPaths}
            focusedIndex={focusedIndex}
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
          mode={contextMenu.mode}
          entry={contextMenu.entry}
          onClose={() => setContextMenu(null)}
          onDownload={handleDownload}
          onDelete={handleDelete}
          onRename={handleRename}
          onOpen={handleOpen}
          onCopyPath={handleCopyPath}
          onCopy={handleCopyEntry}
          onPasteInto={handlePasteInto}
          onProperties={handleProperties}
          onRefresh={onRefresh}
          onNewFolder={handleNewFolder}
          currentPath={currentPath}
          showProperties={Boolean(capabilities?.fileProperties)}
          canPaste={canPaste}
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
