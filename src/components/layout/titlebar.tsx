import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy } from "lucide-react";
import { useState, useEffect } from "react";

export function Titlebar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [appWindow]);

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between h-8 bg-sidebar border-b border-sidebar-border select-none shrink-0"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 px-3">
        <span className="text-xs font-semibold text-foreground/80 tracking-wide">
          EverythingBrowser
        </span>
      </div>

      <div className="flex">
        <button
          onClick={() => appWindow.minimize()}
          className="inline-flex items-center justify-center w-11 h-8 hover:bg-foreground/10 transition-colors"
        >
          <Minus className="w-3.5 h-3.5 text-foreground/70" />
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="inline-flex items-center justify-center w-11 h-8 hover:bg-foreground/10 transition-colors"
        >
          {isMaximized ? (
            <Copy className="w-3 h-3 text-foreground/70" />
          ) : (
            <Square className="w-3 h-3 text-foreground/70" />
          )}
        </button>
        <button
          onClick={() => appWindow.close()}
          className="inline-flex items-center justify-center w-11 h-8 hover:bg-red-500 hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5 text-foreground/70 hover:text-white" />
        </button>
      </div>
    </div>
  );
}
