import { useState, useCallback, useEffect } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { BreadcrumbNav } from "./breadcrumb-nav";
import { Toolbar } from "./toolbar";
import { FileList } from "./file-list";
import { FileGrid } from "./file-grid";
import { ContextMenu } from "./context-menu";
import type { FileEntry } from "@/types/filesystem";
import type { ViewMode } from "@/hooks/use-file-browser";
import { deleteFile, deleteDir, renameItem, createDir } from "@/services/file-service";
import { Loader2, FolderOpen } from "lucide-react";

interface FileBrowserProps {
  connectionId: string;
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
}

export function FileBrowser({
  connectionId,
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
}: FileBrowserProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry;
  } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newName, setNewName] = useState("");

  const handleOpen = useCallback(
    (entry: FileEntry) => {
      if (entry.isDir) {
        onNavigateTo(entry.path);
      }
    },
    [onNavigateTo]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: FileEntry) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, entry });
    },
    []
  );

  const handleDownload = useCallback(
    async (entry: FileEntry) => {
      const localPath = await save({
        defaultPath: entry.name,
      });
      if (localPath) {
        onDownload(entry);
      }
    },
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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        onRefresh();
      }
      if (e.key === "Backspace" && !renamingPath && !newFolderMode) {
        onGoUp();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onRefresh, onGoUp, renamingPath, newFolderMode]);

  return (
    <div className="flex flex-col h-full">
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
          onSelect={onSelect}
          onOpen={handleOpen}
          onContextMenu={handleContextMenu}
        />
      ) : (
        <FileGrid
          entries={entries}
          selectedPaths={selectedPaths}
          onSelect={onSelect}
          onOpen={handleOpen}
          onContextMenu={handleContextMenu}
        />
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
        />
      )}

      {/* Inline rename - handled via context menu triggering renamingPath */}
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
