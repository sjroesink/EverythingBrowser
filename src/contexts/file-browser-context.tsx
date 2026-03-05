import { createContext, useContext } from "react";
import type { FileEntry } from "@/types/filesystem";

export interface FileBrowserCallbacks {
  onDownload: (connectionId: string, entry: FileEntry) => void;
  onUpload: (
    connectionId: string,
    currentPath: string,
    onUploaded?: () => void
  ) => void;
  onDropUpload: (
    connectionId: string,
    currentPath: string,
    localPaths: string[],
    onUploaded?: () => void
  ) => void;
  onCopyEntries: (connectionId: string, entries: FileEntry[]) => void;
  onPaste: (
    targetConnectionId: string,
    targetPath: string,
    onPasted?: () => void
  ) => void;
  onFileDrop: (
    sourceConnectionId: string,
    entries: { path: string; name: string; isDir: boolean }[],
    targetConnectionId: string,
    targetPath: string,
    onDone?: () => void
  ) => void;
  canPaste: boolean;
  activeConnectionIds: Set<string>;
  onDuplicateTab: (tabId: string) => void;
  onCloseAllTabsForConnection: (connectionId: string) => void;
  onDisconnectIfUnused: (connectionId: string) => void;
}

const FileBrowserContext = createContext<FileBrowserCallbacks | null>(null);

export function FileBrowserProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: FileBrowserCallbacks;
}) {
  return (
    <FileBrowserContext.Provider value={value}>
      {children}
    </FileBrowserContext.Provider>
  );
}

export function useFileBrowserContext(): FileBrowserCallbacks {
  const ctx = useContext(FileBrowserContext);
  if (!ctx) {
    throw new Error(
      "useFileBrowserContext must be used within a FileBrowserProvider"
    );
  }
  return ctx;
}
