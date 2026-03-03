import { useState, useCallback } from "react";
import type { FileEntry } from "@/types/filesystem";
import { listDir } from "@/services/file-service";

export type ViewMode = "list" | "grid";

export function useFileBrowser(connectionId: string | null) {
  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const navigateTo = useCallback(
    async (path: string) => {
      if (!connectionId) return;
      setIsLoading(true);
      setError(null);
      setSelectedPaths(new Set());
      try {
        const items = await listDir(connectionId, path);
        setEntries(items);
        setCurrentPath(path);

        // Update history
        setHistory((prev) => {
          const newHistory = prev.slice(0, historyIndex + 1);
          newHistory.push(path);
          return newHistory;
        });
        setHistoryIndex((prev) => prev + 1);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [connectionId, historyIndex]
  );

  const refresh = useCallback(async () => {
    if (!connectionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const items = await listDir(connectionId, currentPath);
      setEntries(items);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, currentPath]);

  const goUp = useCallback(() => {
    if (currentPath === "/") return;
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    const parentPath = "/" + parts.join("/");
    navigateTo(parentPath || "/");
  }, [currentPath, navigateTo]);

  const goBack = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const path = history[newIndex];
    setHistoryIndex(newIndex);
    if (connectionId) {
      setIsLoading(true);
      setError(null);
      listDir(connectionId, path)
        .then((items) => {
          setEntries(items);
          setCurrentPath(path);
        })
        .catch((e) => setError(String(e)))
        .finally(() => setIsLoading(false));
    }
  }, [historyIndex, history, connectionId]);

  const goForward = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    const path = history[newIndex];
    setHistoryIndex(newIndex);
    if (connectionId) {
      setIsLoading(true);
      setError(null);
      listDir(connectionId, path)
        .then((items) => {
          setEntries(items);
          setCurrentPath(path);
        })
        .catch((e) => setError(String(e)))
        .finally(() => setIsLoading(false));
    }
  }, [historyIndex, history, connectionId]);

  const toggleSelection = useCallback((path: string, multi: boolean) => {
    setSelectedPaths((prev) => {
      const next = multi ? new Set(prev) : new Set<string>();
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedPaths(new Set(entries.map((e) => e.path)));
  }, [entries]);

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set());
  }, []);

  const reset = useCallback(() => {
    setCurrentPath("/");
    setEntries([]);
    setHistory([]);
    setHistoryIndex(-1);
    setSelectedPaths(new Set());
    setError(null);
  }, []);

  return {
    currentPath,
    entries,
    isLoading,
    error,
    viewMode,
    setViewMode,
    selectedPaths,
    navigateTo,
    refresh,
    goUp,
    goBack,
    goForward,
    canGoBack: historyIndex > 0,
    canGoForward: historyIndex < history.length - 1,
    toggleSelection,
    selectAll,
    clearSelection,
    reset,
  };
}
