import { useState, useEffect, useCallback, useRef } from "react";
import { useLayoutStore } from "@/stores/use-layout-store";
import { useTabsStore } from "@/stores/use-tabs-store";
import { useFileBrowserContext } from "@/contexts/file-browser-context";
import { Copy } from "lucide-react";

interface PaneRect {
  paneId: string;
  rect: DOMRect;
}

export function FileDragOverlay() {
  const fileDrag = useLayoutStore((s) => s.fileDrag);
  const endFileDrag = useLayoutStore((s) => s.endFileDrag);
  const { onFileDrop } = useFileBrowserContext();

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [hoveredPaneId, setHoveredPaneId] = useState<string | null>(null);
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);
  const paneRectsRef = useRef<PaneRect[]>([]);

  const refreshRects = useCallback(() => {
    const paneElements = document.querySelectorAll<HTMLElement>("[data-pane-id]");
    const rects: PaneRect[] = [];
    paneElements.forEach((el) => {
      const paneId = el.getAttribute("data-pane-id");
      if (paneId) {
        rects.push({ paneId, rect: el.getBoundingClientRect() });
      }
    });
    paneRectsRef.current = rects;
  }, []);

  const findPaneAtPoint = useCallback((x: number, y: number): PaneRect | null => {
    for (const pr of paneRectsRef.current) {
      const { rect } = pr;
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return pr;
      }
    }
    return null;
  }, []);

  useEffect(() => {
    if (!fileDrag) return;

    refreshRects();

    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });

      // Check for tab element under cursor first
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const tabEl = el ? (el as HTMLElement).closest("[data-tab-id]") : null;

      if (tabEl) {
        const tabId = tabEl.getAttribute("data-tab-id");
        const paneId = tabEl.closest("[data-pane-id]")?.getAttribute("data-pane-id") ?? null;
        setHoveredTabId(tabId);
        setHoveredPaneId(paneId);
      } else {
        setHoveredTabId(null);
        const pane = findPaneAtPoint(e.clientX, e.clientY);
        setHoveredPaneId(pane?.paneId ?? null);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!fileDrag) return;

      // Check if dropped on a tab
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const tabEl = el ? (el as HTMLElement).closest("[data-tab-id]") : null;

      let targetConnectionId: string | null = null;
      let targetPath: string | null = null;

      if (tabEl) {
        const tabId = tabEl.getAttribute("data-tab-id");
        if (tabId) {
          const tab = useTabsStore.getState().getTab(tabId);
          if (tab) {
            targetConnectionId = tab.connectionId;
            targetPath = tab.currentPath;
          }
        }
      } else {
        // Check pane under cursor
        const pane = findPaneAtPoint(e.clientX, e.clientY);
        if (pane && pane.paneId !== fileDrag.sourcePaneId) {
          // Find active tab of target pane
          const findPaneNode = (
            node: import("@/stores/use-layout-store").LayoutNode,
            id: string
          ): import("@/stores/use-layout-store").PaneNode | null => {
            if (node.type === "pane") return node.id === id ? node : null;
            return findPaneNode(node.children[0], id) ?? findPaneNode(node.children[1], id);
          };

          const root = useLayoutStore.getState().root;
          const paneNode = findPaneNode(root, pane.paneId);
          if (paneNode?.activeTabId) {
            const tab = useTabsStore.getState().getTab(paneNode.activeTabId);
            if (tab) {
              targetConnectionId = tab.connectionId;
              targetPath = tab.currentPath;
            }
          }
        }
      }

      if (targetConnectionId && targetPath) {
        onFileDrop(
          fileDrag.sourceConnectionId,
          fileDrag.entries,
          targetConnectionId,
          targetPath
        );
      }

      endFileDrag();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [fileDrag, refreshRects, findPaneAtPoint, endFileDrag, onFileDrop]);

  if (!fileDrag) return null;

  const entryCount = fileDrag.entries.length;
  const ghostLabel =
    entryCount === 1
      ? `Copy "${fileDrag.entries[0].name}"`
      : `Copy ${entryCount} items`;

  // Determine if hovering a valid drop target (different pane or specific tab)
  const isValidTarget =
    hoveredTabId != null ||
    (hoveredPaneId != null && hoveredPaneId !== fileDrag.sourcePaneId);

  // Get highlight rect for hovered pane
  const hoveredRect = hoveredPaneId
    ? paneRectsRef.current.find((p) => p.paneId === hoveredPaneId)?.rect
    : null;

  return (
    <div className="fixed inset-0 z-50 cursor-copy">
      {/* Pane highlight */}
      {isValidTarget && hoveredRect && (
        <div
          className="absolute bg-primary/15 border-2 border-primary/40 rounded-sm pointer-events-none transition-all duration-75"
          style={{
            left: hoveredRect.left,
            top: hoveredRect.top,
            width: hoveredRect.width,
            height: hoveredRect.height,
          }}
        >
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/90 text-primary-foreground text-sm font-medium shadow-lg">
              <Copy className="w-4 h-4" />
              {ghostLabel}
            </div>
          </div>
        </div>
      )}

      {/* Ghost label following cursor */}
      <div
        className="fixed pointer-events-none z-[60] flex items-center gap-1.5 px-3 py-1.5 bg-sidebar border border-border rounded-md shadow-lg text-sm text-foreground opacity-90"
        style={{
          left: mousePos.x + 14,
          top: mousePos.y + 14,
        }}
      >
        <Copy className="w-3.5 h-3.5 text-muted-foreground" />
        {entryCount === 1 ? fileDrag.entries[0].name : `${entryCount} items`}
      </div>
    </div>
  );
}
