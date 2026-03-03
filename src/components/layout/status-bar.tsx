import type { ConnectionConfig } from "@/types/connection";

interface StatusBarProps {
  activeConfig: ConnectionConfig | null;
  transferCount: number;
  onToggleTransfers: () => void;
}

export function StatusBar({
  activeConfig,
  transferCount,
  onToggleTransfers,
}: StatusBarProps) {
  const getConnectionLabel = () => {
    if (!activeConfig) return "Not connected";
    switch (activeConfig.type) {
      case "Sftp":
        return `SFTP — ${activeConfig.username}@${activeConfig.host}:${activeConfig.port}`;
      case "BackblazeB2":
        return `B2 — ${activeConfig.bucketName}`;
    }
  };

  return (
    <div className="flex items-center justify-between h-6 px-3 bg-sidebar border-t border-sidebar-border text-xs text-muted-foreground shrink-0">
      <div className="flex items-center gap-2">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            activeConfig ? "bg-success" : "bg-muted-foreground/30"
          }`}
        />
        <span>{getConnectionLabel()}</span>
      </div>

      {transferCount > 0 && (
        <button
          onClick={onToggleTransfers}
          className="hover:text-foreground transition-colors"
        >
          {transferCount} transfer{transferCount !== 1 ? "s" : ""} active
        </button>
      )}
    </div>
  );
}
