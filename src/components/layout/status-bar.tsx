import { ArrowUpDown, Settings } from "lucide-react";

interface StatusBarProps {
  transferCount: number;
  isTransfersOpen: boolean;
  onToggleTransfers: () => void;
  onOpenSettings: () => void;
}

export function StatusBar({
  transferCount,
  isTransfersOpen,
  onToggleTransfers,
  onOpenSettings,
}: StatusBarProps) {
  return (
    <div className="flex items-center justify-between h-6 px-3 bg-sidebar border-t border-sidebar-border text-xs text-muted-foreground shrink-0">
      <button
        onClick={onToggleTransfers}
        className={`flex items-center gap-1.5 hover:text-foreground transition-colors ${
          isTransfersOpen ? "text-foreground" : ""
        }`}
      >
        <ArrowUpDown className="w-3 h-3" />
        <span>
          Transfers
          {transferCount > 0 && (
            <span className="ml-1 text-primary font-medium">
              ({transferCount})
            </span>
          )}
        </span>
      </button>
      <button
        onClick={onOpenSettings}
        className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        title="Settings"
      >
        <Settings className="w-3 h-3" />
      </button>
    </div>
  );
}
