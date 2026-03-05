import { useState, useCallback } from "react";
import type { FileEntry } from "@/types/filesystem";
import { listDir } from "@/services/file-service";

export type ViewMode = "list" | "grid";

function makeParentEntry(currentPath: string): FileEntry | null {
  if (currentPath === "/") return null;
  const parts = currentPath.split("/").filter(Boolean);
  parts.pop();
  const parentPath = "/" + parts.join("/") || "/";
  return {
    name: "..",
    path: parentPath,
    isDir: true,
    size: 0,
    modified: 0,
  };
}

export function useFileBrowser(connectionId: string | null, initialPath = "/") {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [anchorIndex, setAnchorIndex] = useState(-1);

  const applyEntries = useCallback((items: FileEntry[], path: string) => {
    const parentEntry = makeParentEntry(path);
    const allEntries = parentEntry ? [parentEntry, ...items] : items;
    setEntries(allEntries);
    setFocusedIndex(0);
    setAnchorIndex(0);
  }, []);

  const navigateTo = useCallback(
    async (path: string) => {
      if (!connectionId) return;
      setIsLoading(true);
      setError(null);
      setSelectedPaths(new Set());
      try {
        const items = await listDir(connectionId, path);
        applyEntries(items, path);
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
    [connectionId, historyIndex, applyEntries]
  );

  const refresh = useCallback(async () => {
    if (!connectionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const items = await listDir(connectionId, currentPath);
      applyEntries(items, currentPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, currentPath, applyEntries]);

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
          applyEntries(items, path);
          setCurrentPath(path);
        })
        .catch((e) => setError(String(e)))
        .finally(() => setIsLoading(false));
    }
  }, [historyIndex, history, connectionId, applyEntries]);

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
          applyEntries(items, path);
          setCurrentPath(path);
        })
        .catch((e) => setError(String(e)))
        .finally(() => setIsLoading(false));
    }
  }, [historyIndex, history, connectionId, applyEntries]);

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
    // Also update focused/anchor to match clicked item
    setEntries((currentEntries) => {
      const idx = currentEntries.findIndex((e) => e.path === path);
      if (idx >= 0) {
        setFocusedIndex(idx);
        setAnchorIndex(idx);
      }
      return currentEntries;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedPaths(new Set(entries.filter((e) => e.name !== "..").map((e) => e.path)));
  }, [entries]);

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set());
  }, []);

  // Cursor movement: move cursor, clear selection, select new item, set anchor
  const moveCursor = useCallback(
    (delta: number) => {
      setFocusedIndex((prev) => {
        const next = Math.max(0, Math.min(entries.length - 1, prev + delta));
        const entry = entries[next];
        if (entry) {
          setSelectedPaths(new Set(entry.name === ".." ? [] : [entry.path]));
          setAnchorIndex(next);
        }
        return next;
      });
    },
    [entries]
  );

  // Shift+Arrow: extend selection from anchor to new cursor
  const extendSelection = useCallback(
    (delta: number) => {
      setFocusedIndex((prev) => {
        const next = Math.max(0, Math.min(entries.length - 1, prev + delta));
        // Select range from anchor to next
        const start = Math.min(anchorIndex, next);
        const end = Math.max(anchorIndex, next);
        const paths = new Set<string>();
        for (let i = start; i <= end; i++) {
          const e = entries[i];
          if (e && e.name !== "..") paths.add(e.path);
        }
        setSelectedPaths(paths);
        return next;
      });
    },
    [entries, anchorIndex]
  );

  // Ctrl+Arrow: move cursor without changing selection
  const moveCursorOnly = useCallback(
    (delta: number) => {
      setFocusedIndex((prev) =>
        Math.max(0, Math.min(entries.length - 1, prev + delta))
      );
    },
    [entries]
  );

  // Ctrl+Space: toggle item at cursor
  const toggleFocusedSelection = useCallback(() => {
    const entry = entries[focusedIndex];
    if (!entry || entry.name === "..") return;
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.add(entry.path);
      }
      return next;
    });
    setAnchorIndex(focusedIndex);
  }, [entries, focusedIndex]);

  // Home/End: jump cursor, clear+select, set anchor
  const jumpTo = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(entries.length - 1, index));
      setFocusedIndex(clamped);
      setAnchorIndex(clamped);
      const entry = entries[clamped];
      if (entry) {
        setSelectedPaths(new Set(entry.name === ".." ? [] : [entry.path]));
      }
    },
    [entries]
  );

  // Shift+Home/End: extend selection from anchor to edge
  const selectToEdge = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(entries.length - 1, index));
      setFocusedIndex(clamped);
      const start = Math.min(anchorIndex, clamped);
      const end = Math.max(anchorIndex, clamped);
      const paths = new Set<string>();
      for (let i = start; i <= end; i++) {
        const e = entries[i];
        if (e && e.name !== "..") paths.add(e.path);
      }
      setSelectedPaths(paths);
    },
    [entries, anchorIndex]
  );

  // Enter: open directory at cursor (or ".." to go up)
  const openFocused = useCallback(() => {
    const entry = entries[focusedIndex];
    if (!entry) return;
    if (entry.name === "..") {
      goUp();
    } else if (entry.isDir) {
      navigateTo(entry.path);
    }
  }, [entries, focusedIndex, goUp, navigateTo]);

  const reset = useCallback(() => {
    setCurrentPath(initialPath);
    setEntries([]);
    setHistory([]);
    setHistoryIndex(-1);
    setSelectedPaths(new Set());
    setFocusedIndex(-1);
    setAnchorIndex(-1);
    setError(null);
  }, [initialPath]);

  return {
    currentPath,
    entries,
    isLoading,
    error,
    viewMode,
    setViewMode,
    selectedPaths,
    focusedIndex,
    anchorIndex,
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
    moveCursor,
    extendSelection,
    moveCursorOnly,
    toggleFocusedSelection,
    jumpTo,
    selectToEdge,
    openFocused,
    reset,
  };
}
