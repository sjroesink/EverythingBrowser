import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  RefreshCw,
  Upload,
  FolderPlus,
  List,
  LayoutGrid,
} from "lucide-react";
import type { ViewMode } from "@/hooks/use-file-browser";

interface ToolbarProps {
  viewMode: ViewMode;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  onGoUp: () => void;
  onRefresh: () => void;
  onUpload: () => void;
  onNewFolder: () => void;
  onSetViewMode: (mode: ViewMode) => void;
}

export function Toolbar({
  viewMode,
  canGoBack,
  canGoForward,
  isLoading,
  onGoBack,
  onGoForward,
  onGoUp,
  onRefresh,
  onUpload,
  onNewFolder,
  onSetViewMode,
}: ToolbarProps) {
  const btnClass =
    "inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors";

  return (
    <div className="flex items-center gap-1">
      <button onClick={onGoBack} disabled={!canGoBack} className={btnClass} title="Back">
        <ArrowLeft className="w-4 h-4" />
      </button>
      <button onClick={onGoForward} disabled={!canGoForward} className={btnClass} title="Forward">
        <ArrowRight className="w-4 h-4" />
      </button>
      <button onClick={onGoUp} className={btnClass} title="Go up">
        <ArrowUp className="w-4 h-4" />
      </button>
      <button onClick={onRefresh} className={btnClass} title="Refresh">
        <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
      </button>

      <div className="w-px h-5 bg-border mx-1" />

      <button onClick={onUpload} className={btnClass} title="Upload">
        <Upload className="w-4 h-4" />
      </button>
      <button onClick={onNewFolder} className={btnClass} title="New folder">
        <FolderPlus className="w-4 h-4" />
      </button>

      <div className="flex-1" />

      <div className="flex items-center bg-secondary rounded-lg p-0.5">
        <button
          onClick={() => onSetViewMode("list")}
          className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-all ${
            viewMode === "list"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          title="List view"
        >
          <List className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onSetViewMode("grid")}
          className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-all ${
            viewMode === "grid"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          title="Grid view"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
