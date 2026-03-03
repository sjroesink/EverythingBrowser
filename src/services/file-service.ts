import { invoke, Channel } from "@tauri-apps/api/core";
import type { FileEntry, FileInfo } from "@/types/filesystem";
import type { TransferEvent } from "@/types/transfer";

export async function listDir(
  connectionId: string,
  path: string
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_dir", { connectionId, path });
}

export async function getFileInfo(
  connectionId: string,
  path: string
): Promise<FileInfo> {
  return invoke<FileInfo>("get_file_info", { connectionId, path });
}

export async function downloadFile(
  connectionId: string,
  remotePath: string,
  localPath: string,
  onEvent: (event: TransferEvent) => void
): Promise<void> {
  const channel = new Channel<TransferEvent>();
  channel.onmessage = onEvent;
  return invoke("download_file", {
    connectionId,
    remotePath,
    localPath,
    onEvent: channel,
  });
}

export async function uploadFile(
  connectionId: string,
  localPath: string,
  remotePath: string,
  onEvent: (event: TransferEvent) => void
): Promise<void> {
  const channel = new Channel<TransferEvent>();
  channel.onmessage = onEvent;
  return invoke("upload_file", {
    connectionId,
    localPath,
    remotePath,
    onEvent: channel,
  });
}

export async function deleteFile(
  connectionId: string,
  path: string
): Promise<void> {
  return invoke("delete_file", { connectionId, path });
}

export async function deleteDir(
  connectionId: string,
  path: string,
  recursive: boolean
): Promise<void> {
  return invoke("delete_dir", { connectionId, path, recursive });
}

export async function renameItem(
  connectionId: string,
  from: string,
  to: string
): Promise<void> {
  return invoke("rename_item", { connectionId, from, to });
}

export async function createDir(
  connectionId: string,
  path: string
): Promise<void> {
  return invoke("create_dir", { connectionId, path });
}
