import { useCallback, useEffect, useRef, useState } from "react";
import {
  Folder,
  File,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode,
  FileArchive,
  CornerLeftUp,
} from "lucide-react";
import { formatBytes, formatDate, getFileExtension } from "@/lib/utils";
import type { FileEntry } from "@/types/filesystem";

interface FileListProps {
  entries: FileEntry[];
  selectedPaths: Set<string>;
  focusedIndex: number;
  draggedEntry: FileEntry | null;
  dropTargetPath: string | null;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  onMouseDownEntry: (entry: FileEntry, e: React.MouseEvent) => void;
}

function getFileIcon(entry: FileEntry) {
  if (entry.name === "..") return <CornerLeftUp className="w-4 h-4 text-muted-foreground" />;
  if (entry.isDir) return <Folder className="w-4 h-4 text-primary" />;

  const ext = getFileExtension(entry.name);
  const imageExts = ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"];
  const videoExts = ["mp4", "avi", "mkv", "mov", "wmv", "webm"];
  const audioExts = ["mp3", "wav", "flac", "ogg", "aac", "m4a"];
  const codeExts = [
    "js", "ts", "jsx", "tsx", "py", "rs", "go", "java", "c", "cpp", "h",
    "css", "html", "json", "yaml", "yml", "toml", "xml", "sh", "bash",
  ];
  const archiveExts = ["zip", "tar", "gz", "bz2", "xz", "7z", "rar"];
  const textExts = ["txt", "md", "log", "csv", "ini", "cfg", "conf"];

  if (imageExts.includes(ext)) return <FileImage className="w-4 h-4 text-green-500" />;
  if (videoExts.includes(ext)) return <FileVideo className="w-4 h-4 text-purple-500" />;
  if (audioExts.includes(ext)) return <FileAudio className="w-4 h-4 text-orange-500" />;
  if (codeExts.includes(ext)) return <FileCode className="w-4 h-4 text-blue-500" />;
  if (archiveExts.includes(ext)) return <FileArchive className="w-4 h-4 text-yellow-500" />;
  if (textExts.includes(ext)) return <FileText className="w-4 h-4 text-muted-foreground" />;

  return <File className="w-4 h-4 text-muted-foreground" />;
}

const DEFAULT_WIDTHS = { size: 96, modified: 176, permissions: 112 };
const MIN_COL_WIDTH = 50;

export function FileList({
  entries,
  selectedPaths,
  focusedIndex,
  draggedEntry,
  dropTargetPath,
  onContextMenu,
  onMouseDownEntry,
}: FileListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [colWidths, setColWidths] = useState(DEFAULT_WIDTHS);

  // Scroll focused row into view
  useEffect(() => {
    if (focusedIndex < 0 || !containerRef.current) return;
    const row = containerRef.current.querySelector(`[data-entry-index="${focusedIndex}"]`);
    if (row) {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);

  const onResizeStart = useCallback((e: React.MouseEvent, colKey: keyof typeof DEFAULT_WIDTHS) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startW = colWidths[colKey];

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newW = Math.max(MIN_COL_WIDTH, startW + delta);
      setColWidths((prev) => ({ ...prev, [colKey]: newW }));
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [colWidths]);

  const resizeHandle = (colKey: keyof typeof DEFAULT_WIDTHS) => (
    <div
      onMouseDown={(e) => onResizeStart(e, colKey)}
      className="absolute right-0 top-0 bottom-0 w-[7px] cursor-col-resize z-10 group"
      style={{ transform: "translateX(50%)" }}
    >
      <div className="absolute inset-y-1 left-1/2 w-[1px] -translate-x-1/2 bg-border group-hover:bg-primary/60 group-active:bg-primary transition-colors" />
    </div>
  );

  return (
    <div className="flex-1 overflow-auto" ref={containerRef} tabIndex={0}>
      <table className="w-full text-sm table-fixed">
        <colgroup>
          <col />
          <col style={{ width: colWidths.size }} />
          <col style={{ width: colWidths.modified }} />
          <col style={{ width: colWidths.permissions }} />
        </colgroup>
        <thead className="sticky top-0 bg-background z-10">
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="text-left font-medium px-3 py-2">
              Name
            </th>
            <th className="text-right font-medium px-3 py-2 relative">
              Size
              {resizeHandle("size")}
            </th>
            <th className="text-right font-medium px-3 py-2 relative">
              Modified
              {resizeHandle("modified")}
            </th>
            <th className="text-right font-medium px-3 py-2 relative">
              Permissions
              {resizeHandle("permissions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const isParent = entry.name === "..";
            const isSelected = selectedPaths.has(entry.path);
            const isFocused = index === focusedIndex;
            const isDragged = draggedEntry?.path === entry.path;
            const isDropTarget = dropTargetPath === entry.path && entry.isDir;
            return (
              <tr
                key={entry.path}
                data-entry-path={entry.path}
                data-entry-index={index}
                data-is-dir={entry.isDir ? "true" : "false"}
                onContextMenu={(e) => onContextMenu(e, entry)}
                onMouseDown={(e) => {
                  if (e.button === 0) onMouseDownEntry(entry, e);
                }}
                onDragStart={(e) => e.preventDefault()}
                className={`cursor-pointer border-b border-border/50 transition-colors select-none ${
                  isDropTarget
                    ? "bg-primary/20 ring-1 ring-primary/40"
                    : isSelected
                      ? "bg-primary/10"
                      : "hover:bg-accent/50"
                } ${isDragged ? "opacity-40" : ""} ${
                  isFocused ? "ring-1 ring-inset ring-primary/50" : ""
                }`}
              >
                <td className="px-3 py-1.5 truncate">
                  <div className="flex items-center gap-2">
                    {getFileIcon(entry)}
                    <span className="truncate">
                      {isParent ? ".." : entry.name}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground whitespace-nowrap">
                  {isParent ? "" : entry.isDir ? "—" : formatBytes(entry.size)}
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground whitespace-nowrap">
                  {isParent ? "" : formatDate(entry.modified)}
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground font-mono text-xs whitespace-nowrap">
                  {isParent ? "" : entry.permissions ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
