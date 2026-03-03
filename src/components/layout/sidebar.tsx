import { ConnectionList } from "@/components/sidebar/connection-list";
import { SidebarFooter } from "@/components/sidebar/sidebar-footer";
import type { ConnectionConfig, SavedConnection } from "@/types/connection";
import type { Theme } from "@/hooks/use-theme";

interface SidebarProps {
  savedConnections: SavedConnection[];
  activeConnectionId: string | null;
  isConnecting: boolean;
  theme: Theme;
  onSetTheme: (theme: Theme) => void;
  onConnect: (config: ConnectionConfig, secret?: string) => void;
  onDisconnect: () => void;
  onAddConnection: () => void;
  onEditConnection: (config: ConnectionConfig) => void;
  onRemoveConnection: (id: string) => void;
  onImport: () => void;
}

export function Sidebar({
  savedConnections,
  activeConnectionId,
  isConnecting,
  theme,
  onSetTheme,
  onConnect,
  onDisconnect,
  onAddConnection,
  onEditConnection,
  onRemoveConnection,
  onImport,
}: SidebarProps) {
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
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <button
            onClick={onAddConnection}
            className="inline-flex items-center justify-center w-6 h-6 rounded-md hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
            title="Add connection"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        <ConnectionList
          connections={savedConnections}
          activeConnectionId={activeConnectionId}
          isConnecting={isConnecting}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onEdit={onEditConnection}
          onRemove={onRemoveConnection}
        />
      </div>

      <SidebarFooter theme={theme} onSetTheme={onSetTheme} />
    </div>
  );
}
