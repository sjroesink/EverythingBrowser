import { Download, RefreshCw, X } from "lucide-react";
import type { UpdateState } from "@/hooks/use-update-checker";
import { relaunch } from "@tauri-apps/plugin-process";

interface UpdateToastProps {
  update: UpdateState;
}

export function UpdateToast({ update }: UpdateToastProps) {
  if (!update.available || update.dismissed) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-accent/90 border-b border-accent-border text-sm text-accent-foreground">
      {update.readyToRestart ? (
        <>
          <RefreshCw className="w-4 h-4 shrink-0" />
          <span className="flex-1">
            Update v{update.version} geinstalleerd.
          </span>
          <button
            onClick={() => void relaunch()}
            className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            Herstarten
          </button>
        </>
      ) : update.downloading ? (
        <>
          <Download className="w-4 h-4 shrink-0 animate-pulse" />
          <span className="flex-1">
            Downloaden... {update.progress}%
          </span>
          <div className="w-32 h-1.5 bg-foreground/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${update.progress}%` }}
            />
          </div>
        </>
      ) : (
        <>
          <Download className="w-4 h-4 shrink-0" />
          <span className="flex-1">
            Update beschikbaar: v{update.version}
          </span>
          <button
            onClick={() => void update.installUpdate()}
            className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            Installeren
          </button>
          <button
            onClick={update.dismiss}
            className="p-1 rounded hover:bg-foreground/10 transition-colors"
            title="Later"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
