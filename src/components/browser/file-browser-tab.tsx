import { useEffect, useCallback, useRef } from "react";
import { FileBrowser } from "./file-browser";
import { useFileBrowser } from "@/hooks/use-file-browser";
import type { ConnectionConfig } from "@/types/connection";
import type { FileEntry } from "@/types/filesystem";

interface FileBrowserTabProps {
  tabId: string;
  connectionId: string;
  config: ConnectionConfig;
  isVisible: boolean;
  isFocused: boolean;
  isConnected: boolean;
  initialPath: string;
  onPathChange: (tabId: string, path: string) => void;
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
  canPaste: boolean;
}

export function FileBrowserTab({
  tabId,
  connectionId,
  config,
  isVisible,
  isFocused,
  isConnected,
  initialPath,
  onPathChange,
  onDownload,
  onUpload,
  onDropUpload,
  onCopyEntries,
  onPaste,
  canPaste,
}: FileBrowserTabProps) {
  const browser = useFileBrowser(connectionId, initialPath);
  const refreshTimerRef = useRef<number | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!isConnected || initializedRef.current) return;

    const startPath =
      initialPath ||
      ("defaultPath" in config && config.defaultPath ? config.defaultPath : "/");

    initializedRef.current = true;
    void browser.navigateTo(startPath);
  }, [browser.navigateTo, config, initialPath, isConnected]);

  useEffect(() => {
    if (!isConnected) {
      initializedRef.current = false;
      return;
    }

    onPathChange(tabId, browser.currentPath);
  }, [tabId, browser.currentPath, isConnected, onPathChange]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const scheduleRefreshAfterUpload = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      browser.refresh();
    }, 120);
  }, [browser.refresh]);

  const handleDownload = useCallback(
    (entry: FileEntry) => onDownload(connectionId, entry),
    [connectionId, onDownload]
  );

  const handleUpload = useCallback(
    () => onUpload(connectionId, browser.currentPath, scheduleRefreshAfterUpload),
    [connectionId, browser.currentPath, onUpload, scheduleRefreshAfterUpload]
  );

  const handleDropUpload = useCallback(
    (localPaths: string[]) =>
      onDropUpload(
        connectionId,
        browser.currentPath,
        localPaths,
        scheduleRefreshAfterUpload
      ),
    [connectionId, browser.currentPath, onDropUpload, scheduleRefreshAfterUpload]
  );

  const handleCopyEntries = useCallback(
    (entries: FileEntry[]) => onCopyEntries(connectionId, entries),
    [connectionId, onCopyEntries]
  );

  const handlePaste = useCallback(
    (targetPath: string) =>
      onPaste(connectionId, targetPath, scheduleRefreshAfterUpload),
    [connectionId, onPaste, scheduleRefreshAfterUpload]
  );

  return (
    <div
      style={{ display: isVisible ? "flex" : "none" }}
      className="flex-col h-full"
    >
      <FileBrowser
        connectionId={connectionId}
        isActive={isFocused}
        isConnected={isConnected}
        currentPath={browser.currentPath}
        entries={browser.entries}
        isLoading={browser.isLoading}
        error={browser.error}
        viewMode={browser.viewMode}
        selectedPaths={browser.selectedPaths}
        focusedIndex={browser.focusedIndex}
        canGoBack={browser.canGoBack}
        canGoForward={browser.canGoForward}
        onNavigateTo={browser.navigateTo}
        onRefresh={browser.refresh}
        onGoUp={browser.goUp}
        onGoBack={browser.goBack}
        onGoForward={browser.goForward}
        onSetViewMode={browser.setViewMode}
        onSelect={browser.toggleSelection}
        onSelectRange={browser.selectRange}
        onSelectAll={browser.selectAll}
        onMoveCursor={browser.moveCursor}
        onExtendSelection={browser.extendSelection}
        onMoveCursorOnly={browser.moveCursorOnly}
        onToggleFocusedSelection={browser.toggleFocusedSelection}
        onJumpTo={browser.jumpTo}
        onSelectToEdge={browser.selectToEdge}
        onOpenFocused={browser.openFocused}
        onDownload={handleDownload}
        onUpload={handleUpload}
        onDropUpload={handleDropUpload}
        onCopyEntries={handleCopyEntries}
        onPasteIntoPath={handlePaste}
        canPaste={canPaste}
      />
    </div>
  );
}
