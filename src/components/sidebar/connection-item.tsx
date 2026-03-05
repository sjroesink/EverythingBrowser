import { Server, Cloud, HardDrive, Terminal, FolderOpen, MoreHorizontal, Pencil, Trash2, XCircle } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useLayoutStore } from "@/stores/use-layout-store";
import type { ConnectionConfig, SavedConnection } from "@/types/connection";

const DRAG_THRESHOLD = 5;

interface ConnectionItemProps {
  connection: SavedConnection;
  tabCount: number;
  onConnect: (config: ConnectionConfig, secret?: string) => void;
  onCloseAllTabs: (connectionId: string) => void;
  onFocusConnection: (connectionId: string) => void;
  onEdit: (config: ConnectionConfig) => void;
  onRemove: (id: string) => void;
}

export function ConnectionItem({
  connection,
  tabCount,
  onConnect,
  onCloseAllTabs,
  onFocusConnection,
  onEdit,
  onRemove,
}: ConnectionItemProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLDivElement>(null);
  const { config } = connection;
  const hasOpenTabs = tabCount > 0;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  const getIcon = () => {
    switch (config.type) {
      case "Sftp":
        return <Server className="w-4 h-4" />;
      case "BackblazeB2":
        return <Cloud className="w-4 h-4" />;
      case "DockerVolume":
        return <HardDrive className="w-4 h-4" />;
      case "DockerExec":
        return <Terminal className="w-4 h-4" />;
      case "LocalFs":
        return <FolderOpen className="w-4 h-4" />;
    }
  };

  const getSubtitle = () => {
    switch (config.type) {
      case "Sftp":
        return `${config.host}:${config.port}`;
      case "BackblazeB2":
        return config.bucketName;
      case "DockerVolume":
        return config.volumeName;
      case "DockerExec":
        return config.container;
      case "LocalFs":
        return config.path;
    }
  };

  const startConnectionDrag = useLayoutStore((s) => s.startConnectionDrag);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleDoubleClick = () => {
    onConnect(config);
  };

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;

      dragStartRef.current = { x: e.clientX, y: e.clientY };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragStartRef.current) return;
        const dx = moveEvent.clientX - dragStartRef.current.x;
        const dy = moveEvent.clientY - dragStartRef.current.y;

        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          startConnectionDrag(config.id, config.name, config.type);
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
    [config, startConnectionDrag]
  );

  const openMenu = (x: number, y: number) => {
    setMenuPosition({ x, y });
    setShowMenu(true);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY);
  };

  const handleMenuButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (showMenu) {
      setShowMenu(false);
      return;
    }
    // Position relative to the button
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu(rect.right, rect.bottom);
  };

  return (
    <div className="relative" ref={itemRef}>
      <div
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        onClick={() => {
          if (hasOpenTabs) onFocusConnection(config.id);
        }}
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer group transition-colors ${
          hasOpenTabs
            ? "bg-primary/10 text-foreground"
            : "hover:bg-foreground/5 text-foreground/80"
        }`}
      >
        <div className="relative shrink-0">
          <span className={hasOpenTabs ? "text-primary" : "text-muted-foreground"}>
            {getIcon()}
          </span>
          {hasOpenTabs && tabCount <= 1 && (
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-success rounded-full border border-sidebar" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-1.5">
            {config.name}
            {tabCount > 1 && (
              <span className="inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] px-1 text-[10px] font-semibold rounded-full bg-primary/15 text-primary">
                {tabCount}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {getSubtitle()}
          </div>
        </div>

        <button
          onClick={handleMenuButtonClick}
          className="shrink-0 w-6 h-6 rounded-md inline-flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-foreground/10 transition-all"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      </div>

      {showMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 w-44 bg-popover border border-border rounded-lg shadow-lg py-1"
          style={menuPosition ? { left: menuPosition.x, top: menuPosition.y } : undefined}
        >
          {hasOpenTabs && (
            <>
              <button
                onClick={() => {
                  onCloseAllTabs(config.id);
                  setShowMenu(false);
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" />
                Close all tabs
              </button>
              <div className="my-1 border-t border-border" />
            </>
          )}
          <button
            onClick={() => {
              onEdit(config);
              setShowMenu(false);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
          <div className="my-1 border-t border-border" />
          <button
            onClick={() => {
              onRemove(config.id);
              setShowMenu(false);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
