import { Upload, Download, Check, X, Loader2, Copy } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import type { TransferJob } from "@/types/transfer";

interface TransferItemProps {
  transfer: TransferJob;
}

export function TransferItem({ transfer }: TransferItemProps) {
  const progress =
    transfer.totalBytes > 0
      ? Math.round((transfer.transferredBytes / transfer.totalBytes) * 100)
      : 0;

  const getStatusIcon = () => {
    switch (transfer.status) {
      case "queued":
        return <Loader2 className="w-3.5 h-3.5 text-muted-foreground" />;
      case "in_progress":
        return <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />;
      case "completed":
        return <Check className="w-3.5 h-3.5 text-success" />;
      case "failed":
        return <X className="w-3.5 h-3.5 text-destructive" />;
      case "cancelled":
        return <X className="w-3.5 h-3.5 text-muted-foreground" />;
    }
  };

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="shrink-0">
          {transfer.direction === "download" ? (
            <Download className="w-3.5 h-3.5 text-muted-foreground" />
          ) : transfer.direction === "copy" ? (
            <Copy className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <Upload className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </span>
        <span className="text-sm truncate flex-1">{transfer.fileName}</span>
        <span className="shrink-0">{getStatusIcon()}</span>
      </div>

      {transfer.status === "in_progress" && (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground shrink-0 w-16 text-right">
            {transfer.totalBytes > 0
              ? `${formatBytes(transfer.transferredBytes)} / ${formatBytes(transfer.totalBytes)}`
              : `${formatBytes(transfer.transferredBytes)}`}
          </span>
        </div>
      )}

      {transfer.status === "failed" && transfer.error && (
        <p className="text-xs text-destructive mt-1 truncate">{transfer.error}</p>
      )}
    </div>
  );
}
