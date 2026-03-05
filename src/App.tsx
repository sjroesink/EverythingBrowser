import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { Titlebar } from "@/components/layout/titlebar";
import { Sidebar } from "@/components/layout/sidebar";
import { StatusBar } from "@/components/layout/status-bar";
import { LayoutRenderer } from "@/components/layout/layout-renderer";
import { DockingOverlay, type ConnectionDropTarget, type TabDropTarget } from "@/components/layout/docking-overlay";
import { FileDragOverlay } from "@/components/layout/file-drag-overlay";
import { TransferPanel } from "@/components/transfers/transfer-panel";
import { ConnectionDialog } from "@/components/connections/connection-dialog";
import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { ImportDialog } from "@/components/onboarding/import-dialog";
import {
  FileBrowserProvider,
  type FileBrowserCallbacks,
} from "@/contexts/file-browser-context";
import { useTheme } from "@/hooks/use-theme";
import { useConnections } from "@/hooks/use-connections";
import { useTransferQueue } from "@/hooks/use-transfer-queue";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useTabsStore } from "@/stores/use-tabs-store";
import { useLayoutStore, type LayoutNode, type PaneNode } from "@/stores/use-layout-store";
import type { ConnectionConfig, LocalFsConfig, Tab } from "@/types/connection";
import type { FileEntry } from "@/types/filesystem";
import { copyToSystemClipboard } from "@/services/file-service";

function findPaneById(node: LayoutNode, id: string): PaneNode | null {
  if (node.type === "pane") return node.id === id ? node : null;
  return findPaneById(node.children[0], id) ?? findPaneById(node.children[1], id);
}

interface ClipboardSelection {
  sourceConnectionId: string;
  entries: Pick<FileEntry, "path" | "name" | "isDir">[];
}

async function openSettingsWindow() {
  const allWindows = await getAllWebviewWindows();
  const existing = allWindows.find((w) => w.label === "settings");
  if (existing) {
    await existing.setFocus();
    return;
  }
  new WebviewWindow("settings", {
    url: "/",
    title: "Settings",
    width: 700,
    height: 500,
    decorations: false,
    center: true,
  });
}

export default function App() {
  useTheme();
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
  const insertTabInStore = useTabsStore((s) => s.insertTab);
  const closeTabInStore = useTabsStore((s) => s.closeTab);

  const root = useLayoutStore((s) => s.root);
  const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const tabDrag = useLayoutStore((s) => s.tabDrag);
  const connectionDrag = useLayoutStore((s) => s.connectionDrag);
  const fileDrag = useLayoutStore((s) => s.fileDrag);
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

  // Global keyboard shortcuts
  const switchTab = useCallback(
    (direction: number) => {
      const layout = useLayoutStore.getState();
      const paneId = layout.focusedPaneId ?? layout.getFirstPaneId();
      const pane = findPaneById(layout.root, paneId);
      if (!pane || pane.tabIds.length === 0) return;
      const currentIndex = pane.activeTabId
        ? pane.tabIds.indexOf(pane.activeTabId)
        : 0;
      const nextIndex =
        (currentIndex + direction + pane.tabIds.length) % pane.tabIds.length;
      layout.setActiveTabInPane(paneId, pane.tabIds[nextIndex]);
    },
    []
  );

  const closeActiveTab = useCallback(() => {
    const layout = useLayoutStore.getState();
    const paneId = layout.focusedPaneId ?? layout.getFirstPaneId();
    const pane = findPaneById(layout.root, paneId);
    if (!pane || !pane.activeTabId) return;
    const tabId = pane.activeTabId;
    const tab = tabs.find((t) => t.id === tabId);
    layout.removeTabFromPane(paneId, tabId);
    closeTabInStore(tabId);
    if (tab) {
      const otherTabs = tabs.filter(
        (t) => t.id !== tabId && t.connectionId === tab.connectionId
      );
      if (otherTabs.length === 0) {
        void disconnect(tab.connectionId);
      }
    }
  }, [tabs, closeTabInStore, disconnect]);

  const splitActivePane = useCallback(
    (direction: "vertical" | "horizontal") => {
      const layout = useLayoutStore.getState();
      const paneId = layout.focusedPaneId ?? layout.getFirstPaneId();
      const pane = findPaneById(layout.root, paneId);
      if (!pane || !pane.activeTabId) return;
      const tab = tabs.find((t) => t.id === pane.activeTabId);
      if (!tab) return;
      const newTabId = openTabInStore(tab.config, tab.connectionId);
      useTabsStore.getState().setTabPath(newTabId, tab.currentPath);
      layout.splitPane(paneId, direction, newTabId);
    },
    [tabs, openTabInStore]
  );

  const globalShortcutHandlers = useMemo(
    () => ({
      "sidebar.toggle": () => toggleSidebar(),
      "tab.next": () => switchTab(1),
      "tab.prev": () => switchTab(-1),
      "tab.close": () => closeActiveTab(),
      "tab.closeAll": () => {
        const layout = useLayoutStore.getState();
        const paneId = layout.focusedPaneId ?? layout.getFirstPaneId();
        const pane = findPaneById(layout.root, paneId);
        if (!pane) return;
        for (const tabId of [...pane.tabIds]) {
          const tab = tabs.find((t) => t.id === tabId);
          layout.removeTabFromPane(paneId, tabId);
          closeTabInStore(tabId);
          if (tab) {
            const otherTabs = tabs.filter(
              (t) => t.id !== tabId && t.connectionId === tab.connectionId
            );
            if (otherTabs.length === 0) {
              void disconnect(tab.connectionId);
            }
          }
        }
      },
      "pane.splitVertical": () => splitActivePane("vertical"),
      "pane.splitHorizontal": () => splitActivePane("horizontal"),
      "pane.splitDuplicate": () => {
        const layout = useLayoutStore.getState();
        const paneId = layout.focusedPaneId ?? layout.getFirstPaneId();
        const el = document.querySelector(`[data-pane-id="${paneId}"]`);
        const direction =
          el && el.clientWidth > el.clientHeight ? "horizontal" : "vertical";
        splitActivePane(direction);
      },
    }),
    [toggleSidebar, switchTab, closeActiveTab, splitActivePane, tabs, closeTabInStore, disconnect]
  );

  useKeyboardShortcuts(globalShortcutHandlers);

  // Listen for tabs reattaching from closed detached windows
  useEffect(() => {
    const unlisten = listen<{ tabs: Tab[] }>("tab-reattach", (event) => {
      const { tabs: reattachedTabs } = event.payload;
      for (const tab of reattachedTabs) {
        insertTabInStore(tab);
        const paneId = useLayoutStore.getState().getFirstPaneId();
        useLayoutStore.getState().addTabToPane(paneId, tab.id);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [insertTabInStore]);

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
      useLayoutStore.getState().removeTabFromAllPanes(tabId);
      closeTabInStore(tabId);
      if (tab) {
        // Only disconnect if no other tabs use this connection
        const otherTabs = tabs.filter(
          (t) => t.id !== tabId && t.connectionId === tab.connectionId
        );
        if (otherTabs.length === 0) {
          void disconnect(tab.connectionId);
        }
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

  const handleCloseAllTabs = useCallback(
    (connectionId: string) => {
      const connectionTabs = tabs.filter((t) => t.connectionId === connectionId);
      for (const tab of connectionTabs) {
        closeTab(tab.id);
      }
    },
    [tabs, closeTab]
  );

  const handleDuplicateTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;

      try {
        const connectionId = await connect(tab.config);
        const newTabId = openTabInStore(tab.config, connectionId);
        // Place the duplicate in the same pane as the original
        const paneId = useLayoutStore.getState().findPaneForTab(tabId);
        if (paneId) {
          addTabToPane(paneId, newTabId);
        } else {
          addTabToPane(getFirstPaneId(), newTabId);
        }
      } catch {
        // Connection error handled in hook
      }
    },
    [tabs, connect, openTabInStore, addTabToPane, getFirstPaneId]
  );

  const handleCloseAllTabsForConnection = useCallback(
    (connectionId: string) => {
      // Close all tabs across all panes for this connection
      const connectionTabs = tabs.filter((t) => t.connectionId === connectionId);
      for (const tab of connectionTabs) {
        useLayoutStore.getState().removeTabFromAllPanes(tab.id);
        closeTabInStore(tab.id);
        void disconnect(tab.connectionId);
      }
    },
    [tabs, closeTabInStore, disconnect]
  );

  const handleDisconnectIfUnused = useCallback(
    (connectionId: string) => {
      // Check if any remaining tabs use this connection
      const remaining = useTabsStore.getState().tabs.filter(
        (t) => t.connectionId === connectionId
      );
      if (remaining.length === 0) {
        void disconnect(connectionId);
      }
    },
    [disconnect]
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

  const handleConnectionDrop = useCallback(
    async (configId: string, target: ConnectionDropTarget) => {
      const saved = savedConnections.find((c) => c.config.id === configId);
      if (!saved) return;

      try {
        const connectionId = await connect(saved.config);
        const tabId = openTabInStore(saved.config, connectionId);

        const layout = useLayoutStore.getState();
        if (target.type === "pane-center") {
          layout.addTabToPane(target.paneId, tabId);
        } else if (target.type === "pane-split") {
          layout.placeNewTabInSplit(tabId, target.paneId, target.direction, target.insertBefore);
        } else if (target.type === "edge") {
          layout.placeNewTabAtEdge(tabId, target.direction, target.insertBefore);
        }
      } catch {
        // Connection error handled in hook
      }
    },
    [savedConnections, connect, openTabInStore]
  );

  const handleDuplicateTabDrop = useCallback(
    async (tabId: string, target: TabDropTarget) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;

      try {
        const connectionId = await connect(tab.config);
        const newTabId = openTabInStore(tab.config, connectionId);

        const layout = useLayoutStore.getState();
        if (target.type === "pane-center") {
          layout.addTabToPane(target.paneId, newTabId);
        } else if (target.type === "pane-split") {
          layout.placeNewTabInSplit(newTabId, target.paneId, target.direction, target.insertBefore);
        } else if (target.type === "edge") {
          layout.placeNewTabAtEdge(newTabId, target.direction, target.insertBefore);
        }
        // "detach" type: skip for now (detaching a duplicate is complex)
      } catch {
        // Connection error handled in hook
      }
    },
    [tabs, connect, openTabInStore]
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

  const handleAddLocalFolder = useCallback(
    async (config: LocalFsConfig) => {
      await addConnection(config);
      try {
        const connectionId = await connect(config);
        openTab(config, connectionId);
      } catch {
        // Connection error handled in hook
      }
    },
    [addConnection, connect, openTab]
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

  const handleFileDrop = useCallback(
    (
      sourceConnectionId: string,
      entries: { path: string; name: string; isDir: boolean }[],
      targetConnectionId: string,
      targetPath: string,
      onDone?: () => void
    ) => {
      if (entries.length === 0) return;

      for (const entry of entries) {
        const destinationPath =
          targetPath === "/"
            ? `/${entry.name}`
            : `${targetPath}/${entry.name}`;

        transfers.enqueueRemoteCopy(
          sourceConnectionId,
          entry.path,
          targetConnectionId,
          destinationPath,
          entry.name,
          onDone
        );
      }

      setShowTransfers(true);
    },
    [transfers]
  );

  const fileBrowserCallbacks = useMemo<FileBrowserCallbacks>(
    () => ({
      onDownload: handleDownload,
      onUpload: handleUpload,
      onDropUpload: handleDropUpload,
      onCopyEntries: handleCopyEntries,
      onPaste: handlePaste,
      onFileDrop: handleFileDrop,
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
      handleFileDrop,
      clipboardSelection,
      activeConnectionIds,
      handleDuplicateTab,
      handleCloseAllTabsForConnection,
      handleDisconnectIfUnused,
    ]
  );

  const tabCountByConnection = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tab of tabs) {
      counts.set(tab.connectionId, (counts.get(tab.connectionId) ?? 0) + 1);
    }
    return counts;
  }, [tabs]);


  return (
    <div className="flex flex-col h-screen bg-background">
      <Titlebar onOpenSettings={openSettingsWindow} />

      <div className="flex flex-1 min-h-0">
        <Sidebar
          savedConnections={savedConnections}
          tabCountByConnection={tabCountByConnection}
          collapsed={sidebarCollapsed}
          onConnect={handleConnect}
          onCloseAllTabs={handleCloseAllTabs}
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
          onAddLocalFolder={handleAddLocalFolder}
          onOpenSettings={openSettingsWindow}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0 relative" data-layout-area>
            <FileBrowserProvider value={fileBrowserCallbacks}>
              <LayoutRenderer
                node={root}
                savedConnections={savedConnections}
              />

              {fileDrag && <FileDragOverlay />}
            </FileBrowserProvider>

            {(tabDrag || connectionDrag) && (
              <DockingOverlay onConnectionDrop={handleConnectionDrop} onDuplicateTabDrop={handleDuplicateTabDrop} />
            )}
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
        transferCount={transfers.activeCount}
        isTransfersOpen={showTransfers}
        onToggleTransfers={() => setShowTransfers(!showTransfers)}
        onOpenSettings={openSettingsWindow}
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
