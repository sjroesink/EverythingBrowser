import { useEffect, useRef } from "react";
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

  // Scroll focused row into view
  useEffect(() => {
    if (focusedIndex < 0 || !containerRef.current) return;
    const row = containerRef.current.querySelector(`[data-entry-index="${focusedIndex}"]`);
    if (row) {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);

  return (
    <div className="flex-1 overflow-auto" ref={containerRef} tabIndex={0}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background z-10">
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="text-left font-medium px-3 py-2">Name</th>
            <th className="text-right font-medium px-3 py-2 w-24">Size</th>
            <th className="text-right font-medium px-3 py-2 w-44">Modified</th>
            <th className="text-right font-medium px-3 py-2 w-28">Permissions</th>
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
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    {getFileIcon(entry)}
                    <span className="truncate">
                      {isParent ? ".." : entry.name}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">
                  {isParent ? "" : entry.isDir ? "—" : formatBytes(entry.size)}
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">
                  {isParent ? "" : formatDate(entry.modified)}
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground font-mono text-xs">
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
