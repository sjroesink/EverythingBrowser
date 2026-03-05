import { ConnectionItem } from "./connection-item";
import type { ConnectionConfig, SavedConnection } from "@/types/connection";

interface ConnectionListProps {
  connections: SavedConnection[];
  tabCountByConnection: Map<string, number>;
  onConnect: (config: ConnectionConfig, secret?: string) => void;
  onCloseAllTabs: (connectionId: string) => void;
  onFocusConnection: (connectionId: string) => void;
  onEdit: (config: ConnectionConfig) => void;
  onRemove: (id: string) => void;
}

export function ConnectionList({
  connections,
  tabCountByConnection,
  onConnect,
  onCloseAllTabs,
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
          tabCount={tabCountByConnection.get(conn.config.id) ?? 0}
          onConnect={onConnect}
          onCloseAllTabs={onCloseAllTabs}
          onFocusConnection={onFocusConnection}
          onEdit={onEdit}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}
