import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { exit } from "@tauri-apps/plugin-process";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useLayoutStore } from "@/stores/use-layout-store";
import { Titlebar } from "@/components/layout/titlebar";
import { StatusBar } from "@/components/layout/status-bar";
import { FileBrowserTab } from "@/components/browser/file-browser-tab";
import { TabBar } from "@/components/browser/tab-bar";
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
  useTheme(); // Apply theme

  const {
    activeConnectionIds,
    connect,
  } = useConnections();

  const transfers = useTransferQueue();

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showTransfers, setShowTransfers] = useState(false);
  const [clipboardSelection, setClipboardSelection] =
    useState<ClipboardSelection | null>(null);
  const [isCliLaunched, setIsCliLaunched] = useState(false);

  // Check for CLI-launched connection on mount
  useEffect(() => {
    invoke<CliLaunchData | null>("get_cli_connection").then((data) => {
      if (!data) return;
      setIsCliLaunched(true);

      const defaultPath =
        data.config.type === "Sftp" ? data.config.defaultPath ?? "/" : "/";
      const tab: Tab = {
        id: crypto.randomUUID(),
        connectionId: data.config.id,
        config: data.config,
        currentPath: defaultPath,
      };
      setTabs([tab]);
      setActiveTabId(tab.id);

      void connect(data.config, data.secret ?? undefined).catch(() => {});
    }).catch(() => {});
  }, [connect]);

  // Listen for tab transfer from main window
  useEffect(() => {
    const unlisten = listen<TabTransferPayload>("tab-transfer", (event) => {
      const { tab } = event.payload;
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);

      // Ensure connection is active (ConnectionManager is shared)
      void connect(tab.config).catch(() => {});
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [connect]);

  // Keep a ref to tabs for the close handler (avoids stale closure)
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // On window close: if CLI-launched, exit the app entirely.
  // Otherwise, send tabs back to main window.
  const isCliLaunchedRef = useRef(isCliLaunched);
  isCliLaunchedRef.current = isCliLaunched;

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onCloseRequested(async () => {
      if (isCliLaunchedRef.current) {
        // CLI mode: exit the entire app
        try {
          await exit(0);
        } catch {
          // Fallback
        }
        return;
      }

      try {
        const currentTabs = tabsRef.current;
        if (currentTabs.length > 0) {
          await emit("tab-reattach", { tabs: currentTabs });
        }
      } catch {
        // Don't block the close if emit fails
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Handle tab drag-out: when a tab is dragged outside this detached window,
  // send it back to the main window
  const tabDrag = useLayoutStore((s) => s.tabDrag);
  const endTabDrag = useLayoutStore((s) => s.endTabDrag);
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  useEffect(() => {
    if (!tabDrag) return;

    const handleMouseMove = (_e: MouseEvent) => {
      // Could show ghost cursor feedback here
    };

    const handleMouseUp = (e: MouseEvent) => {
      const { tabId } = tabDrag;
      const tab = tabsRef.current.find((t) => t.id === tabId);

      // Check if mouse is outside the window
      const isOutside =
        e.clientX < 0 ||
        e.clientY < 0 ||
        e.clientX > window.innerWidth ||
        e.clientY > window.innerHeight;

      if (isOutside && tab) {
        if (!isCliLaunchedRef.current) {
          // Send tab back to main window
          void emit("tab-reattach", { tabs: [tab] }).catch(() => {});
        }

        // Remove from this window
        setTabs((prev) => prev.filter((t) => t.id !== tabId));

        // Update active tab if needed
        if (activeTabIdRef.current === tabId) {
          const remaining = tabsRef.current.filter((t) => t.id !== tabId);
          setActiveTabId(remaining[0]?.id ?? null);
        }

        // Close window if no tabs left
        const remaining = tabsRef.current.filter((t) => t.id !== tabId);
        if (remaining.length === 0) {
          if (isCliLaunchedRef.current) {
            setTimeout(() => { void exit(0); }, 100);
          } else {
            setTimeout(() => getCurrentWindow().destroy().catch(() => {}), 100);
          }
        }
      }

      endTabDrag();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [tabDrag, endTabDrag]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const currentTabs = tabsRef.current;
      const next = currentTabs.filter((t) => t.id !== tabId);

      setTabs(next);

      if (activeTabIdRef.current === tabId) {
        setActiveTabId(next[0]?.id ?? null);
      }

      // If no tabs left, close the window
      if (next.length === 0) {
        if (isCliLaunchedRef.current) {
          setTimeout(() => { void exit(0); }, 100);
        } else {
          // Use destroy to bypass onCloseRequested since there are no tabs to reattach
          setTimeout(() => {
            getCurrentWindow().destroy().catch(() => {});
          }, 100);
        }
      }
    },
    []
  );

  const setTabPath = useCallback((tabId: string, path: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, currentPath: path } : t))
    );
  }, []);

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

  return (
    <div className="flex flex-col h-screen bg-background">
      <Titlebar />

      <div className="flex-1 flex flex-col min-h-0">
        <FileBrowserProvider value={fileBrowserCallbacks}>
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            paneId="detached"
            onSelectTab={setActiveTabId}
            onCloseTab={handleCloseTab}
          />

          <div className="flex-1 relative min-h-0">
            {tabs.map((tab) => (
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
                onCopyEntries={handleCopyEntries}
                onPaste={handlePaste}
                canPaste={Boolean(clipboardSelection)}
              />
            ))}
          </div>
        </FileBrowserProvider>

        <TransferPanel
          isOpen={showTransfers}
          transfers={transfers.transfers}
          onClose={() => setShowTransfers(false)}
          onClearCompleted={transfers.clearCompleted}
        />
      </div>

      <StatusBar
        activeConfig={activeTab?.config ?? null}
        transferCount={transfers.activeCount}
        onToggleTransfers={() => setShowTransfers(!showTransfers)}
      />
    </div>
  );
}
