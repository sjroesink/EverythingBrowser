import { Server, Cloud, MoreHorizontal, Plug, Unplug, Pencil, Trash2 } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { ConnectionConfig, SavedConnection } from "@/types/connection";

interface ConnectionItemProps {
  connection: SavedConnection;
  isActive: boolean;
  isConnecting: boolean;
  onConnect: (config: ConnectionConfig, secret?: string) => void;
  onDisconnect: () => void;
  onEdit: (config: ConnectionConfig) => void;
  onRemove: (id: string) => void;
}

export function ConnectionItem({
  connection,
  isActive,
  isConnecting,
  onConnect,
  onDisconnect,
  onEdit,
  onRemove,
}: ConnectionItemProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { config } = connection;

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
    }
  };

  const getSubtitle = () => {
    switch (config.type) {
      case "Sftp":
        return `${config.host}:${config.port}`;
      case "BackblazeB2":
        return config.bucketName;
    }
  };

  const handleDoubleClick = () => {
    if (isActive) {
      onDisconnect();
    } else {
      onConnect(config);
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <div
        onDoubleClick={handleDoubleClick}
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer group transition-colors ${
          isActive
            ? "bg-primary/10 text-foreground"
            : "hover:bg-foreground/5 text-foreground/80"
        }`}
      >
        <div className="relative shrink-0">
          <span className={isActive ? "text-primary" : "text-muted-foreground"}>
            {getIcon()}
          </span>
          {isActive && (
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-success rounded-full border border-sidebar" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{config.name}</div>
          <div className="text-xs text-muted-foreground truncate">
            {getSubtitle()}
          </div>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="shrink-0 w-6 h-6 rounded-md inline-flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-foreground/10 transition-all"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      </div>

      {showMenu && (
        <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-popover border border-border rounded-lg shadow-lg py-1">
          {isActive ? (
            <button
              onClick={() => {
                onDisconnect();
                setShowMenu(false);
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors"
            >
              <Unplug className="w-3.5 h-3.5" />
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => {
                onConnect(config);
                setShowMenu(false);
              }}
              disabled={isConnecting}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors disabled:opacity-50"
            >
              <Plug className="w-3.5 h-3.5" />
              Connect
            </button>
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
