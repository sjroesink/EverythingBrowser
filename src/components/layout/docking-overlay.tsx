import { useState, useEffect, useCallback, useRef } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit } from "@tauri-apps/api/event";
import { useLayoutStore } from "@/stores/use-layout-store";
import { useTabsStore } from "@/stores/use-tabs-store";
import type { LayoutNode, SplitDirection } from "@/stores/use-layout-store";

type DockZone = "center" | "top" | "bottom" | "left" | "right";

interface PaneRect {
  paneId: string;
  rect: DOMRect;
}

interface ActiveZone {
  paneId: string;
  zone: DockZone;
  rect: DOMRect;
}

export function DockingOverlay() {
  const tabDrag = useLayoutStore((s) => s.tabDrag);
  const splitPane = useLayoutStore((s) => s.splitPane);
  const moveTabToPane = useLayoutStore((s) => s.moveTabToPane);
  const removeTabFromPane = useLayoutStore((s) => s.removeTabFromPane);
  const endTabDrag = useLayoutStore((s) => s.endTabDrag);

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [activeZone, setActiveZone] = useState<ActiveZone | null>(null);
  const paneRectsRef = useRef<PaneRect[]>([]);

  // Collect all pane bounding rects
  const refreshPaneRects = useCallback(() => {
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

  // Determine which dock zone the cursor is in
  const hitTest = useCallback(
    (x: number, y: number): ActiveZone | null => {
      for (const { paneId, rect } of paneRectsRef.current) {
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
          continue;
        }

        // Relative position within the pane (0-1)
        const relX = (x - rect.left) / rect.width;
        const relY = (y - rect.top) / rect.height;

        const edgeThreshold = 0.25;
        let zone: DockZone = "center";

        if (relY < edgeThreshold) {
          zone = "top";
        } else if (relY > 1 - edgeThreshold) {
          zone = "bottom";
        } else if (relX < edgeThreshold) {
          zone = "left";
        } else if (relX > 1 - edgeThreshold) {
          zone = "right";
        }

        // Compute highlight rect for the zone
        const zoneRect = getZoneRect(rect, zone);

        return { paneId, zone, rect: zoneRect };
      }

      return null;
    },
    []
  );

  useEffect(() => {
    if (!tabDrag) return;

    refreshPaneRects();

    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
      const zone = hitTest(e.clientX, e.clientY);
      setActiveZone(zone);
    };

    const handleMouseUp = (e: MouseEvent) => {
      const zone = hitTest(e.clientX, e.clientY);

      if (tabDrag) {
        const { tabId, sourcePaneId } = tabDrag;

        if (zone) {
          if (zone.zone === "center") {
            // Move tab to the target pane's tab group
            if (zone.paneId !== sourcePaneId) {
              moveTabToPane(tabId, sourcePaneId, zone.paneId);
            }
          } else {
            // Split the target pane
            const direction = getDirectionForZone(zone.zone);
            // Remove from source first
            removeTabFromPane(sourcePaneId, tabId);
            // Then split target with the tab
            if (zone.zone === "top" || zone.zone === "left") {
              splitPaneBefore(zone.paneId, direction, tabId);
            } else {
              splitPane(zone.paneId, direction, tabId);
            }
          }
        } else {
          // Dropped outside all panes - detach to new window
          detachTab(tabId, sourcePaneId, e.screenX, e.screenY);
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
  }, [tabDrag, refreshPaneRects, hitTest, splitPane, moveTabToPane, removeTabFromPane, endTabDrag]);

  // Custom split that puts the new pane first (for top/left drops)
  const splitPaneBefore = useCallback(
    (paneId: string, direction: SplitDirection, newTabId: string) => {
      const layoutState = useLayoutStore.getState();
      const root = layoutState.root;

      // We need to do a custom split where the new pane comes first
      const pane = findNodeById(root, paneId);
      if (!pane || pane.type !== "pane") return;

      const newPaneNode = {
        type: "pane" as const,
        id: crypto.randomUUID(),
        tabIds: [newTabId],
        activeTabId: newTabId,
      };

      const splitNode = {
        type: "split" as const,
        id: crypto.randomUUID(),
        direction,
        children: [newPaneNode, pane] as [LayoutNode, LayoutNode],
        sizes: [50, 50] as [number, number],
      };

      // Replace the pane with the split node
      const newRoot = replaceNodeInTree(root, paneId, splitNode);
      useLayoutStore.setState({ root: newRoot });
    },
    []
  );

  // Detach a tab to a new OS window
  const detachTab = useCallback(
    (tabId: string, sourcePaneId: string, screenX: number, screenY: number) => {
      const tab = useTabsStore.getState().getTab(tabId);
      if (!tab) return;

      // Remove from layout and global store
      removeTabFromPane(sourcePaneId, tabId);
      useTabsStore.getState().closeTab(tabId);

      const windowLabel = `detached-${tabId.slice(0, 8)}`;

      const detachedWindow = new WebviewWindow(windowLabel, {
        url: "/",
        title: tab.config.name,
        width: 900,
        height: 700,
        decorations: false,
        x: screenX - 450,
        y: screenY - 50,
      });

      // Send the tab data once the window is ready
      detachedWindow.once("tauri://created", () => {
        // Small delay to let the React app mount
        setTimeout(() => {
          void emit("tab-transfer", { tab });
        }, 300);
      });
    },
    [removeTabFromPane]
  );

  if (!tabDrag) return null;

  // Find the tab name for the ghost
  const draggedTab = document.querySelector(`[data-tab-id="${tabDrag.tabId}"]`);
  const tabName = draggedTab?.querySelector("span")?.textContent ?? "Tab";

  return (
    <div className="absolute inset-0 z-50">
      {/* Zone highlight */}
      {activeZone && (
        <div
          className="absolute bg-primary/20 border-2 border-primary/40 rounded-sm transition-all duration-75"
          style={{
            left: activeZone.rect.left,
            top: activeZone.rect.top,
            width: activeZone.rect.width,
            height: activeZone.rect.height,
          }}
        />
      )}

      {/* Dock zone indicators for each pane */}
      {paneRectsRef.current.map(({ paneId, rect }) => (
        <DockIndicators key={paneId} paneRect={rect} activeZone={activeZone?.paneId === paneId ? activeZone.zone : null} />
      ))}

      {/* Ghost tab following cursor */}
      <div
        className="fixed pointer-events-none z-[60] px-3 py-1.5 bg-sidebar border border-border rounded-md shadow-lg text-sm text-foreground opacity-80"
        style={{
          left: mousePos.x + 12,
          top: mousePos.y + 12,
        }}
      >
        {tabName}
      </div>
    </div>
  );
}

function DockIndicators({
  paneRect,
  activeZone,
}: {
  paneRect: DOMRect;
  activeZone: DockZone | null;
}) {
  const cx = paneRect.left + paneRect.width / 2;
  const cy = paneRect.top + paneRect.height / 2;
  const size = 28;
  const gap = 2;

  const indicators: { zone: DockZone; x: number; y: number }[] = [
    { zone: "center", x: cx - size / 2, y: cy - size / 2 },
    { zone: "top", x: cx - size / 2, y: cy - size / 2 - size - gap },
    { zone: "bottom", x: cx - size / 2, y: cy + size / 2 + gap },
    { zone: "left", x: cx - size / 2 - size - gap, y: cy - size / 2 },
    { zone: "right", x: cx + size / 2 + gap, y: cy - size / 2 },
  ];

  return (
    <>
      {indicators.map(({ zone, x, y }) => (
        <div
          key={zone}
          className={`absolute pointer-events-none rounded-sm border transition-colors ${
            activeZone === zone
              ? "bg-primary/60 border-primary"
              : "bg-sidebar/90 border-border"
          }`}
          style={{
            left: x,
            top: y,
            width: size,
            height: size,
          }}
        >
          <ZoneIcon zone={zone} active={activeZone === zone} />
        </div>
      ))}
    </>
  );
}

function ZoneIcon({ zone, active }: { zone: DockZone; active: boolean }) {
  const color = active ? "var(--color-primary-foreground)" : "var(--color-muted-foreground)";
  const fillColor = active ? "var(--color-primary)" : "var(--color-muted-foreground)";
  const size = 16;
  const margin = 6;

  // Simple visual indicators showing the split position
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className="absolute"
      style={{ left: margin, top: margin }}
    >
      <rect x="1" y="1" width="14" height="14" rx="1" fill="none" stroke={color} strokeWidth="1" opacity="0.5" />
      {zone === "center" && (
        <rect x="2" y="2" width="12" height="12" rx="0.5" fill={fillColor} opacity="0.4" />
      )}
      {zone === "top" && (
        <rect x="2" y="2" width="12" height="5" rx="0.5" fill={fillColor} opacity="0.6" />
      )}
      {zone === "bottom" && (
        <rect x="2" y="9" width="12" height="5" rx="0.5" fill={fillColor} opacity="0.6" />
      )}
      {zone === "left" && (
        <rect x="2" y="2" width="5" height="12" rx="0.5" fill={fillColor} opacity="0.6" />
      )}
      {zone === "right" && (
        <rect x="9" y="2" width="5" height="12" rx="0.5" fill={fillColor} opacity="0.6" />
      )}
    </svg>
  );
}

function getZoneRect(paneRect: DOMRect, zone: DockZone): DOMRect {
  const { left, top, width, height } = paneRect;

  switch (zone) {
    case "top":
      return new DOMRect(left, top, width, height / 2);
    case "bottom":
      return new DOMRect(left, top + height / 2, width, height / 2);
    case "left":
      return new DOMRect(left, top, width / 2, height);
    case "right":
      return new DOMRect(left + width / 2, top, width / 2, height);
    case "center":
    default:
      return new DOMRect(left, top, width, height);
  }
}

function getDirectionForZone(zone: DockZone): SplitDirection {
  return zone === "top" || zone === "bottom" ? "vertical" : "horizontal";
}

function findNodeById(
  root: LayoutNode,
  id: string
): LayoutNode | null {
  if (root.id === id) return root;
  if (root.type === "split") {
    return findNodeById(root.children[0], id) ?? findNodeById(root.children[1], id);
  }
  return null;
}

function replaceNodeInTree(
  root: LayoutNode,
  targetId: string,
  replacement: LayoutNode
): LayoutNode {
  if (root.id === targetId) return replacement;
  if (root.type === "split") {
    return {
      ...root,
      children: [
        replaceNodeInTree(root.children[0], targetId, replacement),
        replaceNodeInTree(root.children[1], targetId, replacement),
      ] as [LayoutNode, LayoutNode],
    };
  }
  return root;
}
