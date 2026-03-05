import { invoke, Channel } from "@tauri-apps/api/core";
import type {
  FileEntry,
  FileInfo,
  FilePropertyUpdate,
  OwnershipOptions,
  ProviderCapabilities,
} from "@/types/filesystem";
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

export async function getProviderCapabilities(
  connectionId: string
): Promise<ProviderCapabilities> {
  return invoke<ProviderCapabilities>("get_provider_capabilities", {
    connectionId,
  });
}

export async function listOwnershipOptions(
  connectionId: string
): Promise<OwnershipOptions> {
  return invoke<OwnershipOptions>("list_ownership_options", { connectionId });
}

export async function setFileProperties(
  connectionId: string,
  path: string,
  update: FilePropertyUpdate
): Promise<void> {
  return invoke("set_file_properties", { connectionId, path, update });
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

export async function copyBetweenConnections(
  sourceConnectionId: string,
  sourcePath: string,
  targetConnectionId: string,
  targetPath: string,
  onEvent: (event: TransferEvent) => void
): Promise<void> {
  const channel = new Channel<TransferEvent>();
  channel.onmessage = onEvent;
  return invoke("copy_between_connections", {
    sourceConnectionId,
    sourcePath,
    targetConnectionId,
    targetPath,
    onEvent: channel,
  });
}

export async function copyToSystemClipboard(
  connectionId: string,
  remotePaths: string[]
): Promise<void> {
  return invoke("copy_to_system_clipboard", {
    connectionId,
    remotePaths,
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

export async function downloadToTemp(
  connectionId: string,
  remotePath: string
): Promise<string> {
  return invoke<string>("download_to_temp", { connectionId, remotePath });
}

export async function ensureDragIcon(): Promise<string> {
  return invoke<string>("ensure_drag_icon");
}

export async function getClipboardFiles(): Promise<string[]> {
  return invoke<string[]>("get_clipboard_files");
}

export async function openInEditor(
  editorPath: string,
  filePath: string
): Promise<void> {
  return invoke("open_in_editor", { editorPath, filePath });
}

export async function getAppDataDir(): Promise<string> {
  return invoke<string>("get_app_data_dir");
}

export async function openPathInExplorer(path: string): Promise<void> {
  return invoke("open_path_in_explorer", { path });
}

export interface DetectedEditor {
  name: string;
  path: string;
}

export async function detectEditors(): Promise<DetectedEditor[]> {
  return invoke<DetectedEditor[]>("detect_editors");
}
