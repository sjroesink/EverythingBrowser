import {
  Folder,
  File,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode,
  FileArchive,
} from "lucide-react";
import { getFileExtension } from "@/lib/utils";
import type { FileEntry } from "@/types/filesystem";

interface FileGridProps {
  entries: FileEntry[];
  selectedPaths: Set<string>;
  draggedEntry: FileEntry | null;
  dropTargetPath: string | null;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  onMouseDownEntry: (entry: FileEntry, e: React.MouseEvent) => void;
}

function getFileIconLarge(entry: FileEntry) {
  if (entry.isDir) return <Folder className="w-10 h-10 text-primary" />;

  const ext = getFileExtension(entry.name);
  const imageExts = ["png", "jpg", "jpeg", "gif", "svg", "webp"];
  const videoExts = ["mp4", "avi", "mkv", "mov", "webm"];
  const audioExts = ["mp3", "wav", "flac", "ogg", "aac"];
  const codeExts = ["js", "ts", "jsx", "tsx", "py", "rs", "go", "java", "c", "cpp"];
  const archiveExts = ["zip", "tar", "gz", "7z", "rar"];
  const textExts = ["txt", "md", "log", "csv"];

  if (imageExts.includes(ext)) return <FileImage className="w-10 h-10 text-green-500" />;
  if (videoExts.includes(ext)) return <FileVideo className="w-10 h-10 text-purple-500" />;
  if (audioExts.includes(ext)) return <FileAudio className="w-10 h-10 text-orange-500" />;
  if (codeExts.includes(ext)) return <FileCode className="w-10 h-10 text-blue-500" />;
  if (archiveExts.includes(ext)) return <FileArchive className="w-10 h-10 text-yellow-500" />;
  if (textExts.includes(ext)) return <FileText className="w-10 h-10 text-muted-foreground" />;

  return <File className="w-10 h-10 text-muted-foreground" />;
}

export function FileGrid({
  entries,
  selectedPaths,
  draggedEntry,
  dropTargetPath,
  onContextMenu,
  onMouseDownEntry,
}: FileGridProps) {
  return (
    <div className="flex-1 overflow-auto p-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
        {entries.map((entry) => {
          const isSelected = selectedPaths.has(entry.path);
          const isDragged = draggedEntry?.path === entry.path;
          const isDropTarget = dropTargetPath === entry.path && entry.isDir;
          return (
            <div
              key={entry.path}
              data-entry-path={entry.path}
              data-is-dir={entry.isDir ? "true" : "false"}
              onContextMenu={(e) => onContextMenu(e, entry)}
              onMouseDown={(e) => {
                if (e.button === 0) onMouseDownEntry(entry, e);
              }}
              onDragStart={(e) => e.preventDefault()}
              className={`flex flex-col items-center gap-1 p-3 rounded-lg cursor-pointer transition-colors select-none ${
                isDropTarget
                  ? "bg-primary/20 ring-1 ring-primary/40"
                  : isSelected
                    ? "bg-primary/10"
                    : "hover:bg-accent/50"
              } ${isDragged ? "opacity-40" : ""}`}
            >
              {getFileIconLarge(entry)}
              <span className="text-xs text-center truncate w-full mt-1">
                {entry.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
