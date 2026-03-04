import { ConnectionList } from "@/components/sidebar/connection-list";
import { SidebarFooter } from "@/components/sidebar/sidebar-footer";
import type { ConnectionConfig, SavedConnection } from "@/types/connection";
import type { Theme } from "@/hooks/use-theme";
import { PanelLeftClose, PanelLeftOpen, Server, Cloud, Plus, Download } from "lucide-react";

interface SidebarProps {
  savedConnections: SavedConnection[];
  activeConnectionIds: Set<string>;
  isConnecting: boolean;
  tabCountByConnection: Map<string, number>;
  theme: Theme;
  collapsed: boolean;
  onSetTheme: (theme: Theme) => void;
  onConnect: (config: ConnectionConfig, secret?: string) => void;
  onDisconnect: (connectionId: string) => void;
  onFocusConnection: (connectionId: string) => void;
  onAddConnection: () => void;
  onEditConnection: (config: ConnectionConfig) => void;
  onRemoveConnection: (id: string) => void;
  onImport: () => void;
  onToggleCollapse: () => void;
}

export function Sidebar({
  savedConnections,
  activeConnectionIds,
  isConnecting,
  tabCountByConnection,
  theme,
  collapsed,
  onSetTheme,
  onConnect,
  onDisconnect,
  onFocusConnection,
  onAddConnection,
  onEditConnection,
  onRemoveConnection,
  onImport,
  onToggleCollapse,
}: SidebarProps) {
  if (collapsed) {
    return (
      <div className="flex flex-col h-full w-10 bg-sidebar border-r border-sidebar-border shrink-0">
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
            const isActive = activeConnectionIds.has(conn.config.id);
            const count = tabCountByConnection.get(conn.config.id) ?? 0;
            return (
              <button
                key={conn.config.id}
                onDoubleClick={() => onConnect(conn.config)}
                className={`relative inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                }`}
                title={conn.config.name}
              >
                {conn.config.type === "Sftp" ? (
                  <Server className="w-3.5 h-3.5" />
                ) : (
                  <Cloud className="w-3.5 h-3.5" />
                )}
                {isActive && count <= 1 && (
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
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-60 bg-sidebar border-r border-sidebar-border shrink-0">
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
          activeConnectionIds={activeConnectionIds}
          isConnecting={isConnecting}
          tabCountByConnection={tabCountByConnection}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onFocusConnection={onFocusConnection}
          onEdit={onEditConnection}
          onRemove={onRemoveConnection}
        />
      </div>

      <SidebarFooter theme={theme} onSetTheme={onSetTheme} />
    </div>
  );
}
