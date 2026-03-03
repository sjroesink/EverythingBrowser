import { ChevronDown } from "lucide-react";
import { TransferItem } from "./transfer-item";
import type { TransferJob } from "@/types/transfer";

interface TransferPanelProps {
  isOpen: boolean;
  transfers: TransferJob[];
  onClose: () => void;
  onClearCompleted: () => void;
}

export function TransferPanel({
  isOpen,
  transfers,
  onClose,
  onClearCompleted,
}: TransferPanelProps) {
  if (!isOpen) return null;

  const hasCompleted = transfers.some(
    (t) => t.status === "completed" || t.status === "failed"
  );

  return (
    <div className="border-t border-border bg-card">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground">
          Transfers ({transfers.length})
        </span>
        <div className="flex items-center gap-1">
          {hasCompleted && (
            <button
              onClick={onClearCompleted}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded-md hover:bg-accent transition-colors"
            >
              Clear completed
            </button>
          )}
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-md inline-flex items-center justify-center hover:bg-foreground/10 transition-colors"
          >
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto">
        {transfers.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            No transfers
          </div>
        ) : (
          <div className="divide-y divide-border">
            {transfers.map((transfer) => (
              <TransferItem key={transfer.id} transfer={transfer} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
