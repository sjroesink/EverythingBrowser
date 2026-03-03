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
import { formatBytes, formatDate, getFileExtension } from "@/lib/utils";
import type { FileEntry } from "@/types/filesystem";

interface FileListProps {
  entries: FileEntry[];
  selectedPaths: Set<string>;
  onSelect: (path: string, multi: boolean) => void;
  onOpen: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
}

function getFileIcon(entry: FileEntry) {
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
  onSelect,
  onOpen,
  onContextMenu,
}: FileListProps) {
  return (
    <div className="flex-1 overflow-auto">
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
          {entries.map((entry) => {
            const isSelected = selectedPaths.has(entry.path);
            return (
              <tr
                key={entry.path}
                onClick={(e) => onSelect(entry.path, e.ctrlKey || e.metaKey)}
                onDoubleClick={() => onOpen(entry)}
                onContextMenu={(e) => onContextMenu(e, entry)}
                className={`cursor-pointer border-b border-border/50 transition-colors ${
                  isSelected
                    ? "bg-primary/10"
                    : "hover:bg-accent/50"
                }`}
              >
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    {getFileIcon(entry)}
                    <span className="truncate">{entry.name}</span>
                  </div>
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">
                  {entry.isDir ? "—" : formatBytes(entry.size)}
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">
                  {formatDate(entry.modified)}
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground font-mono text-xs">
                  {entry.permissions ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
