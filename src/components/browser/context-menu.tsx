import {
  Download,
  Trash2,
  Pencil,
  FolderOpen,
  Copy,
  Settings2,
  RefreshCw,
  FolderPlus,
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { FileEntry } from "@/types/filesystem";

interface ContextMenuProps {
  x: number;
  y: number;
  entry: FileEntry | null;
  mode: "entry" | "folder";
  onClose: () => void;
  onDownload: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onRename: (entry: FileEntry) => void;
  onOpen: (entry: FileEntry) => void;
  onCopyPath: (entry: FileEntry) => void;
  onCopy: (entry: FileEntry) => void;
  onPasteInto: (targetPath: string) => void;
  onProperties: (entry: FileEntry) => void;
  onRefresh: () => void;
  onNewFolder: () => void;
  currentPath: string;
  showProperties: boolean;
  canPaste: boolean;
}

export function ContextMenu({
  x,
  y,
  entry,
  mode,
  onClose,
  onDownload,
  onDelete,
  onRename,
  onOpen,
  onCopyPath,
  onCopy,
  onPasteInto,
  onProperties,
  onRefresh,
  onNewFolder,
  currentPath,
  showProperties,
  canPaste,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const itemClass =
    "flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors";

  if (mode === "folder") {
    return (
      <div
        ref={ref}
        className="fixed z-50 w-48 bg-popover border border-border rounded-lg shadow-lg py-1"
        style={{ left: x, top: y }}
      >
        <button
          onClick={() => {
            onRefresh();
            onClose();
          }}
          className={itemClass}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
        <button
          onClick={() => {
            onNewFolder();
            onClose();
          }}
          className={itemClass}
        >
          <FolderPlus className="w-3.5 h-3.5" />
          New Folder
        </button>
        {canPaste && (
          <button
            onClick={() => {
              onPasteInto(currentPath);
              onClose();
            }}
            className={itemClass}
          >
            <Copy className="w-3.5 h-3.5" />
            Paste
          </button>
        )}
      </div>
    );
  }

  if (!entry) return null;

  return (
    <div
      ref={ref}
      className="fixed z-50 w-48 bg-popover border border-border rounded-lg shadow-lg py-1"
      style={{ left: x, top: y }}
    >
      {entry.isDir && (
        <button
          onClick={() => {
            onOpen(entry);
            onClose();
          }}
          className={itemClass}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          Open
        </button>
      )}
      {!entry.isDir && (
        <button
          onClick={() => {
            onDownload(entry);
            onClose();
          }}
          className={itemClass}
        >
          <Download className="w-3.5 h-3.5" />
          Download
        </button>
      )}
      <button
        onClick={() => {
          onCopy(entry);
          onClose();
        }}
        className={itemClass}
      >
        <Copy className="w-3.5 h-3.5" />
        Copy
      </button>
      {canPaste && entry.isDir && (
        <button
          onClick={() => {
            onPasteInto(entry.path);
            onClose();
          }}
          className={itemClass}
        >
          <Copy className="w-3.5 h-3.5" />
          Paste Into
        </button>
      )}
      <button
        onClick={() => {
          onRename(entry);
          onClose();
        }}
        className={itemClass}
      >
        <Pencil className="w-3.5 h-3.5" />
        Rename
      </button>
      <button
        onClick={() => {
          onCopyPath(entry);
          onClose();
        }}
        className={itemClass}
      >
        <Copy className="w-3.5 h-3.5" />
        Copy Path
      </button>
      {showProperties && (
        <button
          onClick={() => {
            onProperties(entry);
            onClose();
          }}
          className={itemClass}
        >
          <Settings2 className="w-3.5 h-3.5" />
          Properties
        </button>
      )}
      <div className="my-1 border-t border-border" />
      <button
        onClick={() => {
          onDelete(entry);
          onClose();
        }}
        className={`${itemClass} text-destructive hover:bg-destructive/10`}
      >
        <Trash2 className="w-3.5 h-3.5" />
        Delete
      </button>
    </div>
  );
}
