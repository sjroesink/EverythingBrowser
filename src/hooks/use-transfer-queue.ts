import { useState, useCallback } from "react";
import type { TransferJob, TransferEvent } from "@/types/transfer";
import { downloadFile, uploadFile } from "@/services/file-service";

export function useTransferQueue() {
  const [transfers, setTransfers] = useState<TransferJob[]>([]);

  const updateTransfer = useCallback(
    (id: string, updates: Partial<TransferJob>) => {
      setTransfers((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
      );
    },
    []
  );

  const enqueueDownload = useCallback(
    (
      connectionId: string,
      remotePath: string,
      localPath: string,
      fileName: string
    ) => {
      const id = crypto.randomUUID();
      const job: TransferJob = {
        id,
        connectionId,
        direction: "download",
        remotePath,
        localPath,
        fileName,
        totalBytes: 0,
        transferredBytes: 0,
        status: "queued",
        startedAt: Date.now(),
      };

      setTransfers((prev) => [...prev, job]);

      // Start the transfer
      updateTransfer(id, { status: "in_progress" });

      downloadFile(connectionId, remotePath, localPath, (event: TransferEvent) => {
        switch (event.event) {
          case "started":
            updateTransfer(id, {
              totalBytes: event.data.totalBytes,
              status: "in_progress",
            });
            break;
          case "progress":
            updateTransfer(id, {
              transferredBytes: event.data.bytesTransferred,
              totalBytes: event.data.totalBytes,
            });
            break;
          case "completed":
            updateTransfer(id, { status: "completed" });
            break;
          case "failed":
            updateTransfer(id, {
              status: "failed",
              error: event.data.error,
            });
            break;
        }
      }).catch((e) => {
        updateTransfer(id, {
          status: "failed",
          error: String(e),
        });
      });

      return id;
    },
    [updateTransfer]
  );

  const enqueueUpload = useCallback(
    (
      connectionId: string,
      localPath: string,
      remotePath: string,
      fileName: string
    ) => {
      const id = crypto.randomUUID();
      const job: TransferJob = {
        id,
        connectionId,
        direction: "upload",
        remotePath,
        localPath,
        fileName,
        totalBytes: 0,
        transferredBytes: 0,
        status: "queued",
        startedAt: Date.now(),
      };

      setTransfers((prev) => [...prev, job]);

      updateTransfer(id, { status: "in_progress" });

      uploadFile(connectionId, localPath, remotePath, (event: TransferEvent) => {
        switch (event.event) {
          case "started":
            updateTransfer(id, {
              totalBytes: event.data.totalBytes,
              status: "in_progress",
            });
            break;
          case "progress":
            updateTransfer(id, {
              transferredBytes: event.data.bytesTransferred,
              totalBytes: event.data.totalBytes,
            });
            break;
          case "completed":
            updateTransfer(id, { status: "completed" });
            break;
          case "failed":
            updateTransfer(id, {
              status: "failed",
              error: event.data.error,
            });
            break;
        }
      }).catch((e) => {
        updateTransfer(id, {
          status: "failed",
          error: String(e),
        });
      });

      return id;
    },
    [updateTransfer]
  );

  const clearCompleted = useCallback(() => {
    setTransfers((prev) =>
      prev.filter((t) => t.status !== "completed" && t.status !== "failed")
    );
  }, []);

  const activeCount = transfers.filter(
    (t) => t.status === "in_progress" || t.status === "queued"
  ).length;

  return {
    transfers,
    enqueueDownload,
    enqueueUpload,
    clearCompleted,
    activeCount,
  };
}
