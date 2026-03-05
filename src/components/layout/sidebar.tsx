import { useRef, useCallback, useEffect, useState } from "react";
import { ConnectionList } from "@/components/sidebar/connection-list";
import { useLayoutStore } from "@/stores/use-layout-store";
import { listen } from "@tauri-apps/api/event";
import type { ConnectionConfig, LocalFsConfig, SavedConnection } from "@/types/connection";
import { PanelLeftClose, PanelLeftOpen, Server, Cloud, HardDrive, Terminal, FolderOpen, Plus, Download, Settings } from "lucide-react";

const DRAG_THRESHOLD = 5;

interface SidebarProps {
  savedConnections: SavedConnection[];
  tabCountByConnection: Map<string, number>;
  collapsed: boolean;
  onConnect: (config: ConnectionConfig, secret?: string) => void;
  onCloseAllTabs: (connectionId: string) => void;
  onFocusConnection: (connectionId: string) => void;
  onAddConnection: () => void;
  onEditConnection: (config: ConnectionConfig) => void;
  onRemoveConnection: (id: string) => void;
  onImport: () => void;
  onToggleCollapse: () => void;
  onAddLocalFolder: (config: LocalFsConfig) => void;
  onOpenSettings: () => void;
}

export function Sidebar({
  savedConnections,
  tabCountByConnection,
  collapsed,
  onConnect,
  onCloseAllTabs,
  onFocusConnection,
  onAddConnection,
  onEditConnection,
  onRemoveConnection,
  onImport,
  onToggleCollapse,
  onAddLocalFolder,
  onOpenSettings,
}: SidebarProps) {
  const startConnectionDrag = useLayoutStore((s) => s.startConnectionDrag);
  const dragStartRef = useRef<{ x: number; y: number; config: ConnectionConfig } | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [isFolderDragOver, setIsFolderDragOver] = useState(false);

  // Listen for folder drops from Windows Explorer onto the sidebar
  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    listen<{ paths: string[]; position: { x: number; y: number } }>(
      "tauri://drag-enter",
      (event) => {
        if (!sidebarRef.current) return;
        const rect = sidebarRef.current.getBoundingClientRect();
        const { x, y } = event.payload.position;
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          setIsFolderDragOver(true);
        }
      }
    ).then((u) => unlisteners.push(u));

    listen<{ paths: string[]; position: { x: number; y: number } }>(
      "tauri://drag-over",
      (event) => {
        if (!sidebarRef.current) return;
        const rect = sidebarRef.current.getBoundingClientRect();
        const { x, y } = event.payload.position;
        setIsFolderDragOver(
          x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
        );
      }
    ).then((u) => unlisteners.push(u));

    listen("tauri://drag-leave", () => {
      setIsFolderDragOver(false);
    }).then((u) => unlisteners.push(u));

    listen<{ paths: string[]; position: { x: number; y: number } }>(
      "tauri://drag-drop",
      (event) => {
        setIsFolderDragOver(false);

        if (!sidebarRef.current) return;
        const rect = sidebarRef.current.getBoundingClientRect();
        const { x, y } = event.payload.position;
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
          return;
        }

        // Add each dropped folder as a LocalFs connection
        for (const folderPath of event.payload.paths) {
          const folderName = folderPath.split(/[\\/]/).pop() || "Local Folder";
          const config: LocalFsConfig = {
            type: "LocalFs",
            id: crypto.randomUUID(),
            name: folderName,
            path: folderPath,
          };
          onAddLocalFolder(config);
        }
      }
    ).then((u) => unlisteners.push(u));

    return () => {
      unlisteners.forEach((u) => u());
    };
  }, [onAddLocalFolder]);

  const handleConnectionMouseDown = useCallback(
    (e: React.MouseEvent, config: ConnectionConfig) => {
      if (e.button !== 0) return;
      dragStartRef.current = { x: e.clientX, y: e.clientY, config };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragStartRef.current) return;
        const dx = moveEvent.clientX - dragStartRef.current.x;
        const dy = moveEvent.clientY - dragStartRef.current.y;

        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          const c = dragStartRef.current.config;
          startConnectionDrag(c.id, c.name, c.type);
          dragStartRef.current = null;
          document.removeEventListener("mousemove", handleMouseMove);
          document.removeEventListener("mouseup", handleMouseUp);
        }
      };

      const handleMouseUp = () => {
        dragStartRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [startConnectionDrag]
  );

  if (collapsed) {
    return (
      <div ref={sidebarRef} className={`flex flex-col h-full w-10 bg-sidebar border-r border-sidebar-border shrink-0 transition-colors ${isFolderDragOver ? "bg-primary/10 ring-2 ring-inset ring-primary/40" : ""}`}>
        <div className="flex items-center justify-center py-2 border-b border-sidebar-border">
          <button
            onClick={onToggleCollapse}
            className="inline-flex items-center justify-center w-6 h-6 rounded-md hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1 flex flex-col items-center gap-0.5">
          {savedConnections.map((conn) => {
            const count = tabCountByConnection.get(conn.config.id) ?? 0;
            const hasOpenTabs = count > 0;
            return (
              <button
                key={conn.config.id}
                onDoubleClick={() => onConnect(conn.config)}
                onMouseDown={(e) => handleConnectionMouseDown(e, conn.config)}
                className={`relative inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
                  hasOpenTabs
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                }`}
                title={conn.config.name}
              >
                {conn.config.type === "Sftp" && <Server className="w-3.5 h-3.5" />}
                {conn.config.type === "BackblazeB2" && <Cloud className="w-3.5 h-3.5" />}
                {conn.config.type === "DockerVolume" && <HardDrive className="w-3.5 h-3.5" />}
                {conn.config.type === "DockerExec" && <Terminal className="w-3.5 h-3.5" />}
                {conn.config.type === "LocalFs" && <FolderOpen className="w-3.5 h-3.5" />}
                {hasOpenTabs && count <= 1 && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 bg-success rounded-full" />
                )}
                {count > 1 && (
                  <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 text-[9px] font-semibold rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col items-center gap-0.5 py-2 border-t border-sidebar-border">
          <button
            onClick={onImport}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
            title="Import sessions"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onAddConnection}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
            title="Add connection"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onOpenSettings}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
            title="Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={sidebarRef} className={`flex flex-col h-full w-60 bg-sidebar border-r border-sidebar-border shrink-0 transition-colors ${isFolderDragOver ? "bg-primary/10 ring-2 ring-inset ring-primary/40" : ""}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-sidebar-border">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Connections
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onImport}
            className="inline-flex items-center justify-center w-6 h-6 rounded-md hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
            title="Import sessions"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onAddConnection}
            className="inline-flex items-center justify-center w-6 h-6 rounded-md hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
            title="Add connection"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onToggleCollapse}
            className="inline-flex items-center justify-center w-6 h-6 rounded-md hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
            title="Collapse sidebar"
          >
            <PanelLeftClose className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        <ConnectionList
          connections={savedConnections}
          tabCountByConnection={tabCountByConnection}
          onConnect={onConnect}
          onCloseAllTabs={onCloseAllTabs}
          onFocusConnection={onFocusConnection}
          onEdit={onEditConnection}
          onRemove={onRemoveConnection}
        />
      </div>

      <div className="px-3 py-2 border-t border-sidebar-border">
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
          Settings
        </button>
      </div>
    </div>
  );
}
