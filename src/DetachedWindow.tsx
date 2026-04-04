import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, emitTo } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { exit } from "@tauri-apps/plugin-process";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useLayoutStore } from "@/stores/use-layout-store";
import { useTabsStore } from "@/stores/use-tabs-store";
import { Titlebar } from "@/components/layout/titlebar";
import { StatusBar } from "@/components/layout/status-bar";
import { LayoutRenderer } from "@/components/layout/layout-renderer";
import { DockingOverlay } from "@/components/layout/docking-overlay";
import { TransferPanel } from "@/components/transfers/transfer-panel";
import {
  FileBrowserProvider,
  type FileBrowserCallbacks,
} from "@/contexts/file-browser-context";
import { useConnections } from "@/hooks/use-connections";
import { useTransferQueue } from "@/hooks/use-transfer-queue";
import { useTheme } from "@/hooks/use-theme";
import type { Tab, ConnectionConfig } from "@/types/connection";
import type { FileEntry } from "@/types/filesystem";
import { copyToSystemClipboard } from "@/services/file-service";

interface CliLaunchData {
  config: ConnectionConfig;
  secret: string | null;
}

interface ClipboardSelection {
  sourceConnectionId: string;
  entries: Pick<FileEntry, "path" | "name" | "isDir">[];
}

interface TabTransferPayload {
  tab: Tab;
}

export default function DetachedWindow() {
  useTheme();

  const {
    savedConnections,
    activeConnectionIds,
    connect,
    disconnect,
  } = useConnections();

  const transfers = useTransferQueue();

  const tabs = useTabsStore((s) => s.tabs);
  const insertTab = useTabsStore((s) => s.insertTab);
  const closeTabInStore = useTabsStore((s) => s.closeTab);

  const root = useLayoutStore((s) => s.root);
  const tabDrag = useLayoutStore((s) => s.tabDrag);
  const connectionDrag = useLayoutStore((s) => s.connectionDrag);
  const addTabToPane = useLayoutStore((s) => s.addTabToPane);
  const getFirstPaneId = useLayoutStore((s) => s.getFirstPaneId);
  const removeTabFromAllPanes = useLayoutStore((s) => s.removeTabFromAllPanes);

  const [showTransfers, setShowTransfers] = useState(false);
  const [clipboardSelection, setClipboardSelection] =
    useState<ClipboardSelection | null>(null);
  const [isCliLaunched, setIsCliLaunched] = useState(false);
  const [hasReceivedTab, setHasReceivedTab] = useState(false);

  const isCliLaunchedRef = useRef(isCliLaunched);
  isCliLaunchedRef.current = isCliLaunched;

  // Check for CLI-launched connection on mount
  useEffect(() => {
    invoke<CliLaunchData | null>("get_cli_connection")
      .then((data) => {
        if (!data) return;
        setIsCliLaunched(true);
        setHasReceivedTab(true);

        const defaultPath =
          "defaultPath" in data.config && data.config.defaultPath ? data.config.defaultPath : "/";
        const tab: Tab = {
          id: crypto.randomUUID(),
          connectionId: data.config.id,
          config: data.config,
          currentPath: defaultPath,
        };
        insertTab(tab);
        addTabToPane(getFirstPaneId(), tab.id);

        void connect(data.config, data.secret ?? undefined).catch(() => {});
      })
      .catch(() => {});
  }, [connect, insertTab, addTabToPane, getFirstPaneId]);

  // Listen for tab transfer from main window
  useEffect(() => {
    const unlisten = listen<TabTransferPayload>("tab-transfer", (event) => {
      const { tab } = event.payload;
      insertTab(tab);
      addTabToPane(getFirstPaneId(), tab.id);
      setHasReceivedTab(true);

      void connect(tab.config).catch(() => {});
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [connect, insertTab, addTabToPane, getFirstPaneId]);

  // Auto-close when all tabs are gone (after initial tab received)
  useEffect(() => {
    if (!hasReceivedTab || tabs.length > 0) return;

    if (isCliLaunchedRef.current) {
      setTimeout(() => {
        void exit(0);
      }, 100);
    } else {
      setTimeout(() => {
        getCurrentWindow().destroy().catch(() => {});
      }, 100);
    }
  }, [hasReceivedTab, tabs.length]);

  // On window close: send all remaining tabs back to main window
  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onCloseRequested(async () => {
      if (isCliLaunchedRef.current) {
        try {
          await exit(0);
        } catch {
          // Fallback
        }
        return;
      }

      try {
        const currentTabs = useTabsStore.getState().tabs;
        if (currentTabs.length > 0) {
          await emitTo("main", "tab-reattach", { tabs: currentTabs });
        }
      } catch {
        // Don't block the close if emit fails
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Auto-upload when editor saves a watched file
  useEffect(() => {
    const unlisten = listen<{
      tempPath: string;
      connectionId: string;
      remotePath: string;
    }>("edited-file-changed", (event) => {
      const { tempPath, connectionId: connId, remotePath } = event.payload;
      const fileName = remotePath.split("/").pop() || "file";
      transfers.enqueueUpload(connId, tempPath, remotePath, fileName);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [transfers]);

  // Handle detach: send tab back to main window
  const handleDetachTab = useCallback(
    (tabId: string, _sourcePaneId: string, _screenX: number, _screenY: number) => {
      const tab = useTabsStore.getState().getTab(tabId);
      if (!tab) return;

      removeTabFromAllPanes(tabId);
      closeTabInStore(tabId);

      if (!isCliLaunchedRef.current) {
        void emitTo("main", "tab-reattach", { tabs: [tab] }).catch(() => {});
      }
    },
    [removeTabFromAllPanes, closeTabInStore]
  );

  const handleDownload = useCallback(
    async (connectionId: string, entry: FileEntry) => {
      const localPath = await openDialog({
        defaultPath: entry.name,
        directory: false,
      });
      if (localPath) {
        transfers.enqueueDownload(
          connectionId,
          entry.path,
          localPath as string,
          entry.name
        );
        setShowTransfers(true);
      }
    },
    [transfers]
  );

  const handleUpload = useCallback(
    async (
      connectionId: string,
      currentPath: string,
      onUploaded?: () => void
    ) => {
      const localPath = await openDialog({
        multiple: false,
        directory: false,
      });
      if (localPath) {
        const fileName = (localPath as string).split(/[\\/]/).pop() || "file";
        const remotePath =
          currentPath === "/" ? `/${fileName}` : `${currentPath}/${fileName}`;
        transfers.enqueueUpload(
          connectionId,
          localPath as string,
          remotePath,
          fileName,
          onUploaded
        );
        setShowTransfers(true);
      }
    },
    [transfers]
  );

  const handleDropUpload = useCallback(
    (
      connectionId: string,
      currentPath: string,
      localPaths: string[],
      onUploaded?: () => void
    ) => {
      for (const localPath of localPaths) {
        const fileName = localPath.split(/[\\/]/).pop() || "file";
        const remotePath =
          currentPath === "/" ? `/${fileName}` : `${currentPath}/${fileName}`;
        transfers.enqueueUpload(
          connectionId,
          localPath,
          remotePath,
          fileName,
          onUploaded
        );
      }
      if (localPaths.length > 0) {
        setShowTransfers(true);
      }
    },
    [transfers]
  );

  const handleCopyEntries = useCallback(
    (sourceConnectionId: string, entries: FileEntry[]) => {
      if (entries.length === 0) return;
      setClipboardSelection({
        sourceConnectionId,
        entries: entries.map((entry) => ({
          path: entry.path,
          name: entry.name,
          isDir: entry.isDir,
        })),
      });
      void copyToSystemClipboard(
        sourceConnectionId,
        entries.map((entry) => entry.path)
      ).catch(() => {});
    },
    []
  );

  const handlePaste = useCallback(
    (
      targetConnectionId: string,
      targetPath: string,
      onPasted?: () => void
    ) => {
      if (!clipboardSelection || clipboardSelection.entries.length === 0) return;
      for (const entry of clipboardSelection.entries) {
        const destinationPath =
          targetPath === "/"
            ? `/${entry.name}`
            : `${targetPath}/${entry.name}`;
        transfers.enqueueRemoteCopy(
          clipboardSelection.sourceConnectionId,
          entry.path,
          targetConnectionId,
          destinationPath,
          entry.name,
          onPasted
        );
      }
      setShowTransfers(true);
    },
    [clipboardSelection, transfers]
  );

  const handleDuplicateTab = useCallback(
    async (tabId: string) => {
      const tab = useTabsStore.getState().getTab(tabId);
      if (!tab) return;
      try {
        const connectionId = await connect(tab.config);
        const defaultPath =
          "defaultPath" in tab.config && tab.config.defaultPath ? tab.config.defaultPath : "/";
        const newTab: Tab = {
          id: crypto.randomUUID(),
          connectionId,
          config: tab.config,
          currentPath: defaultPath,
        };
        insertTab(newTab);
        const paneId = useLayoutStore.getState().findPaneForTab(tabId);
        if (paneId) {
          addTabToPane(paneId, newTab.id);
        } else {
          addTabToPane(getFirstPaneId(), newTab.id);
        }
      } catch {
        // handled in hook
      }
    },
    [connect, insertTab, addTabToPane, getFirstPaneId]
  );

  const handleCloseAllTabsForConnection = useCallback(
    (connectionId: string) => {
      const connectionTabs = useTabsStore
        .getState()
        .tabs.filter((t) => t.connectionId === connectionId);
      for (const tab of connectionTabs) {
        removeTabFromAllPanes(tab.id);
        closeTabInStore(tab.id);
      }
      void disconnect(connectionId);
    },
    [removeTabFromAllPanes, closeTabInStore, disconnect]
  );

  const handleDisconnectIfUnused = useCallback(
    (connectionId: string) => {
      const remaining = useTabsStore
        .getState()
        .tabs.filter((t) => t.connectionId === connectionId);
      if (remaining.length === 0) {
        void disconnect(connectionId);
      }
    },
    [disconnect]
  );

  const fileBrowserCallbacks = useMemo<FileBrowserCallbacks>(
    () => ({
      onDownload: handleDownload,
      onUpload: handleUpload,
      onDropUpload: handleDropUpload,
      onCopyEntries: handleCopyEntries,
      onPaste: handlePaste,
      onFileDrop: () => {},
      canPaste: Boolean(clipboardSelection),
      activeConnectionIds,
      onDuplicateTab: handleDuplicateTab,
      onCloseAllTabsForConnection: handleCloseAllTabsForConnection,
      onDisconnectIfUnused: handleDisconnectIfUnused,
    }),
    [
      handleDownload,
      handleUpload,
      handleDropUpload,
      handleCopyEntries,
      handlePaste,
      clipboardSelection,
      activeConnectionIds,
      handleDuplicateTab,
      handleCloseAllTabsForConnection,
      handleDisconnectIfUnused,
    ]
  );

  return (
    <div className="flex flex-col h-screen bg-background">
      <Titlebar />

      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 min-h-0 relative" data-layout-area>
          <FileBrowserProvider value={fileBrowserCallbacks}>
            <LayoutRenderer
              node={root}
              savedConnections={savedConnections}
            />
          </FileBrowserProvider>

          {(tabDrag || connectionDrag) && (
            <DockingOverlay onDetachTab={handleDetachTab} />
          )}
        </div>

        <TransferPanel
          isOpen={showTransfers}
          transfers={transfers.transfers}
          onClose={() => setShowTransfers(false)}
          onClearCompleted={transfers.clearCompleted}
        />
      </div>

      <StatusBar
        transferCount={transfers.activeCount}
        isTransfersOpen={showTransfers}
        onToggleTransfers={() => setShowTransfers(!showTransfers)}
        onOpenSettings={() => {}}
      />
    </div>
  );
}
