import { useState, useCallback, useEffect } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Titlebar } from "@/components/layout/titlebar";
import { Sidebar } from "@/components/layout/sidebar";
import { StatusBar } from "@/components/layout/status-bar";
import { FileBrowser } from "@/components/browser/file-browser";
import { ConnectionDialog } from "@/components/connections/connection-dialog";
import { TransferPanel } from "@/components/transfers/transfer-panel";
import { ImportDialog } from "@/components/onboarding/import-dialog";
import { useTheme } from "@/hooks/use-theme";
import { useConnections } from "@/hooks/use-connections";
import { useFileBrowser } from "@/hooks/use-file-browser";
import { useTransferQueue } from "@/hooks/use-transfer-queue";
import type { ConnectionConfig } from "@/types/connection";
import type { FileEntry } from "@/types/filesystem";
import { FolderOpen } from "lucide-react";

export default function App() {
  const { theme, setTheme } = useTheme();
  const {
    savedConnections,
    activeConnectionId,
    activeConfig,
    isConnecting,
    error: connectionError,
    addConnection,
    addConnections,
    updateConnection,
    removeConnection,
    connect,
    disconnect,
  } = useConnections();

  const browser = useFileBrowser(activeConnectionId);
  const transfers = useTransferQueue();

  const [showConnectionDialog, setShowConnectionDialog] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ConnectionConfig | null>(
    null
  );
  const [showTransfers, setShowTransfers] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  // Show onboarding when no saved connections on first load
  useEffect(() => {
    if (!onboardingChecked && savedConnections.length === 0) {
      // Small delay to let the store finish loading
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
  }, [savedConnections, onboardingChecked]);

  const handleImportComplete = useCallback(
    async (configs: ConnectionConfig[]) => {
      await addConnections(configs);
    },
    [addConnections]
  );

  // Navigate to default path when connecting
  useEffect(() => {
    if (activeConnectionId && activeConfig) {
      let defaultPath = "/";
      if (activeConfig.type === "Sftp" && activeConfig.defaultPath) {
        defaultPath = activeConfig.defaultPath;
      }
      browser.navigateTo(defaultPath);
    } else {
      browser.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId]);

  const handleConnect = useCallback(
    async (config: ConnectionConfig, secret?: string) => {
      try {
        await connect(config, secret);
      } catch {
        // Error is handled in the hook
      }
    },
    [connect]
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
    async (entry: FileEntry) => {
      if (!activeConnectionId) return;
      const localPath = await openDialog({
        defaultPath: entry.name,
        directory: false,
      });
      if (localPath) {
        transfers.enqueueDownload(
          activeConnectionId,
          entry.path,
          localPath as string,
          entry.name
        );
        setShowTransfers(true);
      }
    },
    [activeConnectionId, transfers]
  );

  const handleUpload = useCallback(async () => {
    if (!activeConnectionId) return;
    const localPath = await openDialog({
      multiple: false,
      directory: false,
    });
    if (localPath) {
      const fileName = (localPath as string).split(/[\\/]/).pop() || "file";
      const remotePath =
        browser.currentPath === "/"
          ? `/${fileName}`
          : `${browser.currentPath}/${fileName}`;
      transfers.enqueueUpload(
        activeConnectionId,
        localPath as string,
        remotePath,
        fileName
      );
      setShowTransfers(true);
    }
  }, [activeConnectionId, browser.currentPath, transfers]);

  return (
    <div className="flex flex-col h-screen bg-background">
      <Titlebar />

      <div className="flex flex-1 min-h-0">
        <Sidebar
          savedConnections={savedConnections}
          activeConnectionId={activeConnectionId}
          isConnecting={isConnecting}
          theme={theme}
          onSetTheme={setTheme}
          onConnect={handleConnect}
          onDisconnect={disconnect}
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
          {activeConnectionId ? (
            <FileBrowser
              connectionId={activeConnectionId}
              currentPath={browser.currentPath}
              entries={browser.entries}
              isLoading={browser.isLoading}
              error={browser.error}
              viewMode={browser.viewMode}
              selectedPaths={browser.selectedPaths}
              canGoBack={browser.canGoBack}
              canGoForward={browser.canGoForward}
              onNavigateTo={browser.navigateTo}
              onRefresh={browser.refresh}
              onGoUp={browser.goUp}
              onGoBack={browser.goBack}
              onGoForward={browser.goForward}
              onSetViewMode={browser.setViewMode}
              onSelect={browser.toggleSelection}
              onDownload={handleDownload}
              onUpload={handleUpload}
            />
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
