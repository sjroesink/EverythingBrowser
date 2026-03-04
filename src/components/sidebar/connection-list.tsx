import { ConnectionItem } from "./connection-item";
import type { ConnectionConfig, SavedConnection } from "@/types/connection";

interface ConnectionListProps {
  connections: SavedConnection[];
  activeConnectionIds: Set<string>;
  isConnecting: boolean;
  tabCountByConnection: Map<string, number>;
  onConnect: (config: ConnectionConfig, secret?: string) => void;
  onDisconnect: (connectionId: string) => void;
  onFocusConnection: (connectionId: string) => void;
  onEdit: (config: ConnectionConfig) => void;
  onRemove: (id: string) => void;
}

export function ConnectionList({
  connections,
  activeConnectionIds,
  isConnecting,
  tabCountByConnection,
  onConnect,
  onDisconnect,
  onFocusConnection,
  onEdit,
  onRemove,
}: ConnectionListProps) {
  if (connections.length === 0) {
    return (
      <div className="px-3 py-8 text-center">
        <p className="text-xs text-muted-foreground">No saved connections</p>
        <p className="text-xs text-muted-foreground mt-1">
          Click + to add one
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 px-1">
      {connections.map((conn) => (
        <ConnectionItem
          key={conn.config.id}
          connection={conn}
          isActive={activeConnectionIds.has(conn.config.id)}
          isConnecting={isConnecting}
          tabCount={tabCountByConnection.get(conn.config.id) ?? 0}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onFocusConnection={onFocusConnection}
          onEdit={onEdit}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}
