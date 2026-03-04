import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { Titlebar } from "@/components/layout/titlebar";
import { Sidebar } from "@/components/layout/sidebar";
import { StatusBar } from "@/components/layout/status-bar";
import { LayoutRenderer } from "@/components/layout/layout-renderer";
import { DockingOverlay } from "@/components/layout/docking-overlay";
import { TransferPanel } from "@/components/transfers/transfer-panel";
import { ConnectionDialog } from "@/components/connections/connection-dialog";
import { ImportDialog } from "@/components/onboarding/import-dialog";
import {
  FileBrowserProvider,
  type FileBrowserCallbacks,
} from "@/contexts/file-browser-context";
import { useTheme } from "@/hooks/use-theme";
import { useConnections } from "@/hooks/use-connections";
import { useTransferQueue } from "@/hooks/use-transfer-queue";
import { useTabsStore } from "@/stores/use-tabs-store";
import { useLayoutStore } from "@/stores/use-layout-store";
import type { ConnectionConfig, Tab } from "@/types/connection";
import type { FileEntry } from "@/types/filesystem";
import { copyToSystemClipboard } from "@/services/file-service";

interface ClipboardSelection {
  sourceConnectionId: string;
  entries: Pick<FileEntry, "path" | "name" | "isDir">[];
}

export default function App() {
  const { theme, setTheme } = useTheme();
  const {
    savedConnections,
    activeConnectionIds,
    isConnecting,
    isLoaded: connectionsLoaded,
    addConnection,
    addConnections,
    updateConnection,
    removeConnection,
    connect,
    disconnect,
  } = useConnections();

  const transfers = useTransferQueue();

  const tabs = useTabsStore((s) => s.tabs);
  const openTabInStore = useTabsStore((s) => s.openTab);
  const closeTabInStore = useTabsStore((s) => s.closeTab);

  const root = useLayoutStore((s) => s.root);
  const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const tabDrag = useLayoutStore((s) => s.tabDrag);
  const addTabToPane = useLayoutStore((s) => s.addTabToPane);
  const getFirstPaneId = useLayoutStore((s) => s.getFirstPaneId);

  const [tabsHydrated, setTabsHydrated] = useState(() =>
    useTabsStore.persist.hasHydrated()
  );
  const restoredTabsRef = useRef(false);

  const [showConnectionDialog, setShowConnectionDialog] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ConnectionConfig | null>(
    null
  );
  const [showTransfers, setShowTransfers] = useState(false);
  const [clipboardSelection, setClipboardSelection] =
    useState<ClipboardSelection | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  // Hydration
  useEffect(() => {
    const unsubscribe = useTabsStore.persist.onFinishHydration(() => {
      setTabsHydrated(true);
    });
    return unsubscribe;
  }, []);

  // Restore connections on load
  useEffect(() => {
    if (!tabsHydrated || !connectionsLoaded || restoredTabsRef.current) return;
    restoredTabsRef.current = true;

    for (const tab of tabs) {
      const savedConnection = savedConnections.find(
        (conn) => conn.config.id === tab.connectionId
      );
      const config = savedConnection?.config ?? tab.config;
      void connect(config).catch(() => {});
    }
  }, [tabsHydrated, connectionsLoaded, tabs, savedConnections, connect]);

  // Sync tabs into layout panes on hydration
  useEffect(() => {
    if (!tabsHydrated) return;

    // Ensure all tabs are assigned to a pane
    const layoutState = useLayoutStore.getState();
    for (const tab of tabs) {
      const paneId = layoutState.findPaneForTab(tab.id);
      if (!paneId) {
        const firstPaneId = layoutState.getFirstPaneId();
        layoutState.addTabToPane(firstPaneId, tab.id);
      }
    }
  }, [tabsHydrated, tabs]);

  // Show onboarding when no saved connections on first load
  useEffect(() => {
    if (!connectionsLoaded) return;
    if (!onboardingChecked && savedConnections.length === 0) {
      const timer = setTimeout(() => {
        if (savedConnections.length === 0) {
          setShowOnboarding(true);
        }
        setOnboardingChecked(true);
      }, 500);
      return () => clearTimeout(timer);
    }
    if (savedConnections.length > 0) {
      setOnboardingChecked(true);
    }
  }, [connectionsLoaded, savedConnections, onboardingChecked]);

  // Ctrl+B to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  // Listen for tabs reattaching from closed detached windows
  useEffect(() => {
    const unlisten = listen<{ tabs: Tab[] }>("tab-reattach", (event) => {
      const { tabs: reattachedTabs } = event.payload;
      for (const tab of reattachedTabs) {
        // Re-add to global tab store
        const tabId = openTabInStore(tab.config, tab.connectionId);
        // Add to first pane in layout
        const paneId = useLayoutStore.getState().getFirstPaneId();
        useLayoutStore.getState().addTabToPane(paneId, tabId);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [openTabInStore]);

  const handleImportComplete = useCallback(
    async (configs: ConnectionConfig[]) => {
      await addConnections(configs);
    },
    [addConnections]
  );

  const openTab = useCallback(
    (config: ConnectionConfig, connectionId: string) => {
      const tabId = openTabInStore(config, connectionId);
      // Add the new tab to the first pane (or focused pane)
      const paneId = getFirstPaneId();
      addTabToPane(paneId, tabId);
    },
    [openTabInStore, getFirstPaneId, addTabToPane]
  );

  const closeTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      closeTabInStore(tabId);
      if (tab) {
        void disconnect(tab.connectionId);
      }
    },
    [tabs, closeTabInStore, disconnect]
  );

  const handleConnect = useCallback(
    async (config: ConnectionConfig, secret?: string) => {
      try {
        const connectionId = await connect(config, secret);
        openTab(config, connectionId);
      } catch {
        // Error is handled in the hook
      }
    },
    [connect, openTab]
  );

  const handleDisconnect = useCallback(
    (connectionId: string) => {
      const tab = tabs.find((t) => t.connectionId === connectionId);
      if (tab) {
        closeTab(tab.id);
      }
    },
    [tabs, closeTab]
  );

  const handleFocusConnection = useCallback(
    (connectionId: string) => {
      const tab = tabs.find((t) => t.connectionId === connectionId);
      if (tab) {
        const paneId = useLayoutStore.getState().findPaneForTab(tab.id);
        if (paneId) {
          useLayoutStore.getState().setActiveTabInPane(paneId, tab.id);
        }
      }
    },
    [tabs]
  );

  const handleSaveConnection = useCallback(
    async (config: ConnectionConfig, secret?: string) => {
      if (editingConfig) {
        await updateConnection(config, secret);
      } else {
        await addConnection(config, secret);
      }
      setShowConnectionDialog(false);
      setEditingConfig(null);
    },
    [editingConfig, addConnection, updateConnection]
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
      ).catch((error) => {
        console.warn("System clipboard sync failed:", error);
      });
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

  const fileBrowserCallbacks = useMemo<FileBrowserCallbacks>(
    () => ({
      onDownload: handleDownload,
      onUpload: handleUpload,
      onDropUpload: handleDropUpload,
      onCopyEntries: handleCopyEntries,
      onPaste: handlePaste,
      canPaste: Boolean(clipboardSelection),
      activeConnectionIds,
    }),
    [
      handleDownload,
      handleUpload,
      handleDropUpload,
      handleCopyEntries,
      handlePaste,
      clipboardSelection,
      activeConnectionIds,
    ]
  );

  const tabCountByConnection = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tab of tabs) {
      counts.set(tab.connectionId, (counts.get(tab.connectionId) ?? 0) + 1);
    }
    return counts;
  }, [tabs]);

  // Find the active tab across all panes for the status bar
  const activeConfig = useMemo(() => {
    // Walk the tree to find first pane with an activeTabId
    const findActiveTab = (
      node: typeof root
    ): ConnectionConfig | null => {
      if (node.type === "pane") {
        if (node.activeTabId) {
          const tab = tabs.find((t) => t.id === node.activeTabId);
          if (tab) {
            const saved = savedConnections.find(
              (c) => c.config.id === tab.connectionId
            );
            return saved?.config ?? tab.config;
          }
        }
        return null;
      }
      return (
        findActiveTab(node.children[0]) ?? findActiveTab(node.children[1])
      );
    };
    return findActiveTab(root);
  }, [root, tabs, savedConnections]);

  return (
    <div className="flex flex-col h-screen bg-background">
      <Titlebar />

      <div className="flex flex-1 min-h-0">
        <Sidebar
          savedConnections={savedConnections}
          activeConnectionIds={activeConnectionIds}
          isConnecting={isConnecting}
          tabCountByConnection={tabCountByConnection}
          theme={theme}
          collapsed={sidebarCollapsed}
          onSetTheme={setTheme}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onFocusConnection={handleFocusConnection}
          onAddConnection={() => {
            setEditingConfig(null);
            setShowConnectionDialog(true);
          }}
          onEditConnection={(config) => {
            setEditingConfig(config);
            setShowConnectionDialog(true);
          }}
          onRemoveConnection={removeConnection}
          onImport={() => setShowImportDialog(true)}
          onToggleCollapse={toggleSidebar}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0 relative">
            <FileBrowserProvider value={fileBrowserCallbacks}>
              <LayoutRenderer
                node={root}
                savedConnections={savedConnections}
              />
            </FileBrowserProvider>

            {tabDrag && <DockingOverlay />}
          </div>

          <TransferPanel
            isOpen={showTransfers}
            transfers={transfers.transfers}
            onClose={() => setShowTransfers(false)}
            onClearCompleted={transfers.clearCompleted}
          />
        </div>
      </div>

      <StatusBar
        activeConfig={activeConfig}
        transferCount={transfers.activeCount}
        onToggleTransfers={() => setShowTransfers(!showTransfers)}
      />

      <ConnectionDialog
        isOpen={showConnectionDialog}
        editConfig={editingConfig}
        onClose={() => {
          setShowConnectionDialog(false);
          setEditingConfig(null);
        }}
        onSave={handleSaveConnection}
      />

      <ImportDialog
        isOpen={showOnboarding}
        isOnboarding
        onClose={() => setShowOnboarding(false)}
        onImport={handleImportComplete}
      />

      <ImportDialog
        isOpen={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        onImport={handleImportComplete}
      />
    </div>
  );
}
