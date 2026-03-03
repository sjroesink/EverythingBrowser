import { ConnectionItem } from "./connection-item";
import type { ConnectionConfig, SavedConnection } from "@/types/connection";

interface ConnectionListProps {
  connections: SavedConnection[];
  activeConnectionId: string | null;
  isConnecting: boolean;
  onConnect: (config: ConnectionConfig, secret?: string) => void;
  onDisconnect: () => void;
  onEdit: (config: ConnectionConfig) => void;
  onRemove: (id: string) => void;
}

export function ConnectionList({
  connections,
  activeConnectionId,
  isConnecting,
  onConnect,
  onDisconnect,
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
          isActive={activeConnectionId === conn.config.id}
          isConnecting={isConnecting && activeConnectionId === null}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onEdit={onEdit}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}
