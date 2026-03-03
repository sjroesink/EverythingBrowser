import { useState, useCallback, useEffect, useRef } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Titlebar } from "@/components/layout/titlebar";
import { Sidebar } from "@/components/layout/sidebar";
import { StatusBar } from "@/components/layout/status-bar";
import { TabBar } from "@/components/browser/tab-bar";
import { FileBrowserTab } from "@/components/browser/file-browser-tab";
import { ConnectionDialog } from "@/components/connections/connection-dialog";
import { TransferPanel } from "@/components/transfers/transfer-panel";
import { ImportDialog } from "@/components/onboarding/import-dialog";
import { useTheme } from "@/hooks/use-theme";
import { useConnections } from "@/hooks/use-connections";
import { useTransferQueue } from "@/hooks/use-transfer-queue";
import { useTabsStore } from "@/stores/use-tabs-store";
import type { ConnectionConfig } from "@/types/connection";
import type { FileEntry } from "@/types/filesystem";
import { FolderOpen } from "lucide-react";

export default function App() {
  const { theme, setTheme } = useTheme();
  const {
    savedConnections,
    activeConnectionIds,
    isConnecting,
    isLoaded: connectionsLoaded,
    error: connectionError,
    addConnection,
    addConnections,
    updateConnection,
    removeConnection,
    connect,
    disconnect,
  } = useConnections();

  const transfers = useTransferQueue();

  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const openTabInStore = useTabsStore((state) => state.openTab);
  const closeTabInStore = useTabsStore((state) => state.closeTab);
  const setActiveTab = useTabsStore((state) => state.setActiveTab);
  const setTabPath = useTabsStore((state) => state.setTabPath);

  const [tabsHydrated, setTabsHydrated] = useState(() =>
    useTabsStore.persist.hasHydrated()
  );
  const restoredTabsRef = useRef(false);

  const resolvedTabs = tabs.map((tab) => {
    const savedConnection = savedConnections.find(
      (conn) => conn.config.id === tab.connectionId
    );
    return savedConnection ? { ...tab, config: savedConnection.config } : tab;
  });

  const activeTab = resolvedTabs.find((t) => t.id === activeTabId) ?? null;

  const [showConnectionDialog, setShowConnectionDialog] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ConnectionConfig | null>(
    null
  );
  const [showTransfers, setShowTransfers] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  useEffect(() => {
    const unsubscribe = useTabsStore.persist.onFinishHydration(() => {
      setTabsHydrated(true);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!tabsHydrated || !connectionsLoaded || restoredTabsRef.current) return;

    restoredTabsRef.current = true;

    for (const tab of tabs) {
      const savedConnection = savedConnections.find(
        (conn) => conn.config.id === tab.connectionId
      );
      const config = savedConnection?.config ?? tab.config;

      void connect(config).catch(() => {
        // Error state is handled in useConnections
      });
    }
  }, [tabsHydrated, connectionsLoaded, tabs, savedConnections, connect]);

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

  const handleImportComplete = useCallback(
    async (configs: ConnectionConfig[]) => {
      await addConnections(configs);
    },
    [addConnections]
  );

  const openTab = useCallback(
    (config: ConnectionConfig, connectionId: string) => {
      openTabInStore(config, connectionId);
    },
    [openTabInStore]
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
        setActiveTab(tab.id);
      }
    },
    [tabs, setActiveTab]
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

  return (
    <div className="flex flex-col h-screen bg-background">
      <Titlebar />

      <div className="flex flex-1 min-h-0">
        <Sidebar
          savedConnections={savedConnections}
          activeConnectionIds={activeConnectionIds}
          isConnecting={isConnecting}
          theme={theme}
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
        />

        <div className="flex-1 flex flex-col min-w-0">
          <TabBar
            tabs={resolvedTabs}
            activeTabId={activeTabId}
            onSelectTab={setActiveTab}
            onCloseTab={closeTab}
          />

          {resolvedTabs.length > 0 ? (
            <div className="flex-1 relative min-h-0">
              {resolvedTabs.map((tab) => (
                <FileBrowserTab
                  key={tab.id}
                  tabId={tab.id}
                  connectionId={tab.connectionId}
                  config={tab.config}
                  isVisible={tab.id === activeTabId}
                  isConnected={activeConnectionIds.has(tab.connectionId)}
                  initialPath={tab.currentPath}
                  onPathChange={setTabPath}
                  onDownload={handleDownload}
                  onUpload={handleUpload}
                  onDropUpload={handleDropUpload}
                />
              ))}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <FolderOpen className="w-16 h-16 mx-auto mb-4 text-muted-foreground/20" />
                <h2 className="text-lg font-medium text-muted-foreground/60 mb-1">
                  No Connection
                </h2>
                <p className="text-sm text-muted-foreground/40">
                  Double-click a connection in the sidebar to get started
                </p>
                {connectionError && (
                  <p className="text-sm text-destructive mt-3">
                    {connectionError}
                  </p>
                )}
              </div>
            </div>
          )}

          <TransferPanel
            isOpen={showTransfers}
            transfers={transfers.transfers}
            onClose={() => setShowTransfers(false)}
            onClearCompleted={transfers.clearCompleted}
          />
        </div>
      </div>

      <StatusBar
        activeConfig={activeTab?.config ?? null}
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
