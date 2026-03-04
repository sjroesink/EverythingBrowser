import { useCallback } from "react";
import { TabBar } from "@/components/browser/tab-bar";
import { FileBrowserTab } from "@/components/browser/file-browser-tab";
import { useTabsStore } from "@/stores/use-tabs-store";
import { useLayoutStore } from "@/stores/use-layout-store";
import { useFileBrowserContext } from "@/contexts/file-browser-context";
import type { SavedConnection } from "@/types/connection";
import { FolderOpen } from "lucide-react";

interface PaneViewProps {
  paneId: string;
  savedConnections: SavedConnection[];
}

export function PaneView({ paneId, savedConnections }: PaneViewProps) {
  const allTabs = useTabsStore((s) => s.tabs);
  const setTabPath = useTabsStore((s) => s.setTabPath);
  const closeTabInStore = useTabsStore((s) => s.closeTab);

  const root = useLayoutStore((s) => s.root);
  const setActiveTabInPane = useLayoutStore((s) => s.setActiveTabInPane);
  const removeTabFromPane = useLayoutStore((s) => s.removeTabFromPane);

  const {
    onDownload,
    onUpload,
    onDropUpload,
    onCopyEntries,
    onPaste,
    canPaste,
    activeConnectionIds,
  } = useFileBrowserContext();

  // Find this pane in the layout tree
  const paneNode = findPaneById(root, paneId);
  const tabIds = paneNode?.tabIds ?? [];
  const activeTabId = paneNode?.activeTabId ?? null;

  // Resolve tab metadata from global store, respecting saved connection updates
  const paneTabs = tabIds
    .map((id) => {
      const tab = allTabs.find((t) => t.id === id);
      if (!tab) return null;
      const savedConnection = savedConnections.find(
        (conn) => conn.config.id === tab.connectionId
      );
      return savedConnection ? { ...tab, config: savedConnection.config } : tab;
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  const handleSelectTab = useCallback(
    (tabId: string) => {
      setActiveTabInPane(paneId, tabId);
    },
    [paneId, setActiveTabInPane]
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const tab = allTabs.find((t) => t.id === tabId);
      removeTabFromPane(paneId, tabId);

      // Check if this tab still exists in any other pane
      // If not, close it globally
      const otherPane = useLayoutStore.getState().findPaneForTab(tabId);
      if (!otherPane) {
        closeTabInStore(tabId);
      }

      // Disconnect is handled by App.tsx watching tab removals
      void tab; // reference to suppress unused warning
    },
    [paneId, allTabs, removeTabFromPane, closeTabInStore]
  );

  if (paneTabs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-background">
        <div className="text-center">
          <FolderOpen className="w-12 h-12 mx-auto mb-3 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground/40">
            Drag a tab here or open a connection
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background" data-pane-id={paneId}>
      <TabBar
        tabs={paneTabs}
        activeTabId={activeTabId}
        paneId={paneId}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
      />

      <div className="flex-1 relative min-h-0">
        {paneTabs.map((tab) => (
          <FileBrowserTab
            key={tab.id}
            tabId={tab.id}
            connectionId={tab.connectionId}
            config={tab.config}
            isVisible={tab.id === activeTabId}
            isConnected={activeConnectionIds.has(tab.connectionId)}
            initialPath={tab.currentPath}
            onPathChange={setTabPath}
            onDownload={onDownload}
            onUpload={onUpload}
            onDropUpload={onDropUpload}
            onCopyEntries={onCopyEntries}
            onPaste={onPaste}
            canPaste={canPaste}
          />
        ))}
      </div>
    </div>
  );
}

// Helper to find a pane node by ID in the layout tree
function findPaneById(
  node: import("@/stores/use-layout-store").LayoutNode,
  paneId: string
): import("@/stores/use-layout-store").PaneNode | null {
  if (node.type === "pane") {
    return node.id === paneId ? node : null;
  }
  return findPaneById(node.children[0], paneId) ?? findPaneById(node.children[1], paneId);
}
