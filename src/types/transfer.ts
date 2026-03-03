export type TransferDirection = "upload" | "download";
export type TransferStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export interface TransferJob {
  id: string;
  connectionId: string;
  direction: TransferDirection;
  remotePath: string;
  localPath: string;
  fileName: string;
  totalBytes: number;
  transferredBytes: number;
  status: TransferStatus;
  error?: string;
  startedAt?: number;
}

export type TransferEvent =
  | { event: "started"; data: { totalBytes: number } }
  | { event: "progress"; data: { bytesTransferred: number; totalBytes: number } }
  | { event: "completed" }
  | { event: "failed"; data: { error: string } };
