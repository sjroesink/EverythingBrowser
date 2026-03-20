import { useState, useEffect, useCallback, useRef } from "react";
import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { emitTo } from "@tauri-apps/api/event";
import { useLayoutStore } from "@/stores/use-layout-store";
import { useTabsStore } from "@/stores/use-tabs-store";
import type { SplitDirection } from "@/stores/use-layout-store";

type DockZone = "center" | "top" | "bottom" | "left" | "right";

interface PaneRect {
  paneId: string;
  rect: DOMRect;
}

/** Which indicator the cursor is hovering */
type HoveredIndicator = {
  type: "pane";
  paneId: string;
  zone: DockZone;
} | {
  type: "edge";
  zone: Exclude<DockZone, "center">;
};

const INDICATOR_SIZE = 30;
const INDICATOR_GAP = 2;
const EDGE_INDICATOR_W = 30;
const EDGE_INDICATOR_H = 30;
const EDGE_MARGIN = 6;

export type ConnectionDropTarget =
  | { type: "pane-center"; paneId: string }
  | { type: "pane-split"; paneId: string; direction: SplitDirection; insertBefore: boolean }
  | { type: "edge"; direction: SplitDirection; insertBefore: boolean };

export type TabDropTarget =
  | { type: "pane-center"; paneId: string }
  | { type: "pane-split"; paneId: string; direction: SplitDirection; insertBefore: boolean }
  | { type: "edge"; direction: SplitDirection; insertBefore: boolean }
  | { type: "detach"; screenX: number; screenY: number };

interface DockingOverlayProps {
  onConnectionDrop?: (configId: string, target: ConnectionDropTarget) => void;
  onDuplicateTabDrop?: (tabId: string, target: TabDropTarget) => void;
  onDetachTab?: (tabId: string, sourcePaneId: string, screenX: number, screenY: number) => void;
}

export function DockingOverlay({ onConnectionDrop, onDuplicateTabDrop, onDetachTab }: DockingOverlayProps) {
  const tabDrag = useLayoutStore((s) => s.tabDrag);
  const connectionDrag = useLayoutStore((s) => s.connectionDrag);
  const moveTabToPane = useLayoutStore((s) => s.moveTabToPane);
  const removeTabFromPane = useLayoutStore((s) => s.removeTabFromPane);
  const dockTabToSplit = useLayoutStore((s) => s.dockTabToSplit);
  const dockTabToEdge = useLayoutStore((s) => s.dockTabToEdge);
  const endTabDrag = useLayoutStore((s) => s.endTabDrag);
  const endConnectionDrag = useLayoutStore((s) => s.endConnectionDrag);
  const getFirstPaneId = useLayoutStore((s) => s.getFirstPaneId);

  const isDragging = tabDrag || connectionDrag;

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState<HoveredIndicator | null>(null);
  const [hoveredPaneId, setHoveredPaneId] = useState<string | null>(null);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const paneRectsRef = useRef<PaneRect[]>([]);
  const layoutRectRef = useRef<DOMRect | null>(null);

  // Collect all pane bounding rects + layout container rect
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

    const layoutEl = document.querySelector<HTMLElement>("[data-layout-area]");
    layoutRectRef.current = layoutEl?.getBoundingClientRect() ?? null;
  }, []);

  // Find which pane the cursor is inside
  const findPaneAtPoint = useCallback((x: number, y: number): PaneRect | null => {
    for (const pr of paneRectsRef.current) {
      const { rect } = pr;
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return pr;
      }
    }
    return null;
  }, []);

  // Compute indicator positions for a pane (centered cross pattern)
  const getPaneIndicators = useCallback((rect: DOMRect) => {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const s = INDICATOR_SIZE;
    const g = INDICATOR_GAP;

    return {
      center: new DOMRect(cx - s / 2, cy - s / 2, s, s),
      top: new DOMRect(cx - s / 2, cy - s / 2 - s - g, s, s),
      bottom: new DOMRect(cx - s / 2, cy + s / 2 + g, s, s),
      left: new DOMRect(cx - s / 2 - s - g, cy - s / 2, s, s),
      right: new DOMRect(cx + s / 2 + g, cy - s / 2, s, s),
    };
  }, []);

  // Compute edge indicator positions (centered on each edge of the layout area)
  const getEdgeIndicators = useCallback(() => {
    const lr = layoutRectRef.current;
    if (!lr) return null;

    const w = EDGE_INDICATOR_W;
    const h = EDGE_INDICATOR_H;
    const m = EDGE_MARGIN;

    return {
      top: new DOMRect(lr.left + lr.width / 2 - w / 2, lr.top + m, w, h),
      bottom: new DOMRect(lr.left + lr.width / 2 - w / 2, lr.bottom - h - m, w, h),
      left: new DOMRect(lr.left + m, lr.top + lr.height / 2 - h / 2, w, h),
      right: new DOMRect(lr.right - w - m, lr.top + lr.height / 2 - h / 2, w, h),
    };
  }, []);

  // Check if point is inside a DOMRect
  const isInRect = (x: number, y: number, r: DOMRect) =>
    x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;

  // Hit-test: first check edge indicators, then pane indicators
  const hitTest = useCallback(
    (x: number, y: number, currentPaneId: string | null): HoveredIndicator | null => {
      // 1. Check edge indicators
      const edgeInds = getEdgeIndicators();
      if (edgeInds) {
        for (const zone of ["top", "bottom", "left", "right"] as const) {
          if (isInRect(x, y, edgeInds[zone])) {
            return { type: "edge", zone };
          }
        }
      }

      // 2. Check pane indicators for the pane under cursor
      if (currentPaneId) {
        const pr = paneRectsRef.current.find((p) => p.paneId === currentPaneId);
        if (pr) {
          const paneInds = getPaneIndicators(pr.rect);
          for (const zone of ["center", "top", "bottom", "left", "right"] as const) {
            if (isInRect(x, y, paneInds[zone])) {
              return { type: "pane", paneId: currentPaneId, zone };
            }
          }
        }
      }

      return null;
    },
    [getEdgeIndicators, getPaneIndicators]
  );

  // Compute the highlight rect for the current hover
  const getHighlightRect = useCallback((): DOMRect | null => {
    if (!hovered) return null;

    if (hovered.type === "edge") {
      const lr = layoutRectRef.current;
      if (!lr) return null;
      switch (hovered.zone) {
        case "top": return new DOMRect(lr.left, lr.top, lr.width, lr.height / 2);
        case "bottom": return new DOMRect(lr.left, lr.top + lr.height / 2, lr.width, lr.height / 2);
        case "left": return new DOMRect(lr.left, lr.top, lr.width / 2, lr.height);
        case "right": return new DOMRect(lr.left + lr.width / 2, lr.top, lr.width / 2, lr.height);
      }
    }

    if (hovered.type === "pane") {
      const pr = paneRectsRef.current.find((p) => p.paneId === hovered.paneId);
      if (!pr) return null;
      const { left, top, width, height } = pr.rect;
      switch (hovered.zone) {
        case "center": return new DOMRect(left, top, width, height);
        case "top": return new DOMRect(left, top, width, height / 2);
        case "bottom": return new DOMRect(left, top + height / 2, width, height / 2);
        case "left": return new DOMRect(left, top, width / 2, height);
        case "right": return new DOMRect(left + width / 2, top, width / 2, height);
      }
    }

    return null;
  }, [hovered]);

  useEffect(() => {
    if (!isDragging) return;

    refreshRects();

    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
      setCtrlHeld(e.ctrlKey);

      const pane = findPaneAtPoint(e.clientX, e.clientY);
      const currentPaneId = pane?.paneId ?? null;

      // When moving a tab (not duplicating), skip the source pane for indicators
      const isSourcePane = tabDrag && currentPaneId === tabDrag.sourcePaneId && !e.ctrlKey;
      const effectivePaneId = isSourcePane ? null : currentPaneId;

      setHoveredPaneId(effectivePaneId);

      const hit = hitTest(e.clientX, e.clientY, effectivePaneId);
      setHovered(hit);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control") setCtrlHeld(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control") setCtrlHeld(false);
    };

    const handleMouseUp = (e: MouseEvent) => {
      const pane = findPaneAtPoint(e.clientX, e.clientY);
      const currentPaneId = pane?.paneId ?? null;

      // When moving a tab (not duplicating), skip the source pane
      const isSourcePane = tabDrag && currentPaneId === tabDrag.sourcePaneId && !e.ctrlKey;
      const effectivePaneId = isSourcePane ? null : currentPaneId;
      const hit = hitTest(e.clientX, e.clientY, effectivePaneId);

      if (tabDrag) {
        handleTabDrop(tabDrag, hit, e);
        endTabDrag();
      } else if (connectionDrag) {
        handleConnectionDrop(connectionDrag.configId, hit);
        endConnectionDrag();
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [isDragging, tabDrag, connectionDrag, refreshRects, findPaneAtPoint, hitTest]);

  const handleTabDrop = useCallback(
    (drag: { tabId: string; sourcePaneId: string }, hit: HoveredIndicator | null, e: MouseEvent) => {
      const { tabId, sourcePaneId } = drag;
      const isDuplicate = e.ctrlKey && !!onDuplicateTabDrop;

      if (isDuplicate) {
        // Ctrl held: duplicate the tab instead of moving it
        let target: TabDropTarget;
        if (hit) {
          if (hit.type === "edge") {
            const direction: SplitDirection =
              hit.zone === "top" || hit.zone === "bottom" ? "vertical" : "horizontal";
            const insertBefore = hit.zone === "top" || hit.zone === "left";
            target = { type: "edge", direction, insertBefore };
          } else if (hit.zone === "center") {
            target = { type: "pane-center", paneId: hit.paneId };
          } else {
            const direction: SplitDirection =
              hit.zone === "top" || hit.zone === "bottom" ? "vertical" : "horizontal";
            const insertBefore = hit.zone === "top" || hit.zone === "left";
            target = { type: "pane-split", paneId: hit.paneId, direction, insertBefore };
          }
        } else {
          target = { type: "detach", screenX: e.screenX, screenY: e.screenY };
        }
        onDuplicateTabDrop(tabId, target);
        return;
      }

      if (hit) {
        if (hit.type === "edge") {
          const direction: SplitDirection =
            hit.zone === "top" || hit.zone === "bottom" ? "vertical" : "horizontal";
          const insertBefore = hit.zone === "top" || hit.zone === "left";
          dockTabToEdge(tabId, sourcePaneId, direction, insertBefore);
        } else if (hit.type === "pane") {
          if (hit.zone === "center") {
            if (hit.paneId !== sourcePaneId) {
              moveTabToPane(tabId, sourcePaneId, hit.paneId);
            }
          } else {
            const direction: SplitDirection =
              hit.zone === "top" || hit.zone === "bottom" ? "vertical" : "horizontal";
            const insertBefore = hit.zone === "top" || hit.zone === "left";
            dockTabToSplit(tabId, sourcePaneId, hit.paneId, direction, insertBefore);
          }
        }
      } else {
        if (onDetachTab) {
          onDetachTab(tabId, sourcePaneId, e.screenX, e.screenY);
        } else {
          detachTab(tabId, sourcePaneId, e.screenX, e.screenY);
        }
      }
    },
    [dockTabToSplit, dockTabToEdge, moveTabToPane, onDuplicateTabDrop, onDetachTab]
  );

  const handleConnectionDrop = useCallback(
    (configId: string, hit: HoveredIndicator | null) => {
      if (!hit) {
        // Dropped outside — just open in first pane
        onConnectionDrop?.(configId, { type: "pane-center", paneId: getFirstPaneId() });
        return;
      }

      if (hit.type === "edge") {
        const direction: SplitDirection =
          hit.zone === "top" || hit.zone === "bottom" ? "vertical" : "horizontal";
        const insertBefore = hit.zone === "top" || hit.zone === "left";
        onConnectionDrop?.(configId, { type: "edge", direction, insertBefore });
      } else if (hit.type === "pane") {
        if (hit.zone === "center") {
          onConnectionDrop?.(configId, { type: "pane-center", paneId: hit.paneId });
        } else {
          const direction: SplitDirection =
            hit.zone === "top" || hit.zone === "bottom" ? "vertical" : "horizontal";
          const insertBefore = hit.zone === "top" || hit.zone === "left";
          onConnectionDrop?.(configId, { type: "pane-split", paneId: hit.paneId, direction, insertBefore });
        }
      }
    },
    [onConnectionDrop, getFirstPaneId]
  );

  const detachTab = useCallback(
    (tabId: string, sourcePaneId: string, screenX: number, screenY: number) => {
      const tab = useTabsStore.getState().getTab(tabId);
      if (!tab) return;

      removeTabFromPane(sourcePaneId, tabId);
      useTabsStore.getState().closeTab(tabId);

      // Check if mouse is over an existing detached window
      void (async () => {
        const allWindows = await getAllWebviewWindows();
        for (const win of allWindows) {
          if (!win.label.startsWith("detached-")) continue;
          try {
            const pos = await win.outerPosition();
            const size = await win.outerSize();
            if (
              screenX >= pos.x && screenX <= pos.x + size.width &&
              screenY >= pos.y && screenY <= pos.y + size.height
            ) {
              // Mouse is over this detached window — send tab there
              await emitTo(win.label, "tab-transfer", { tab });
              return;
            }
          } catch {
            // Window may have been closed
          }
        }

        // No existing detached window at cursor — create a new one
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

        detachedWindow.once("tauri://created", () => {
          setTimeout(() => {
            void emitTo(windowLabel, "tab-transfer", { tab });
          }, 300);
        });
      })();
    },
    [removeTabFromPane]
  );

  if (!isDragging) return null;

  // Get the display name for the ghost
  let ghostName = "Tab";
  if (tabDrag) {
    const draggedTab = document.querySelector(`[data-tab-id="${tabDrag.tabId}"]`);
    ghostName = draggedTab?.querySelector("span")?.textContent ?? "Tab";
  } else if (connectionDrag) {
    ghostName = connectionDrag.name;
  }

  const highlightRect = getHighlightRect();

  // Find the pane rect for the hovered pane (to show indicators)
  const hoveredPaneRect = hoveredPaneId
    ? paneRectsRef.current.find((p) => p.paneId === hoveredPaneId)?.rect ?? null
    : null;

  const edgeIndicators = getEdgeIndicators();

  return (
    <div className="fixed inset-0 z-50">
      {/* Zone highlight preview */}
      {highlightRect && (
        <div
          className="absolute bg-primary/20 border-2 border-primary/40 rounded-sm pointer-events-none transition-all duration-75"
          style={{
            left: highlightRect.left,
            top: highlightRect.top,
            width: highlightRect.width,
            height: highlightRect.height,
          }}
        />
      )}

      {/* Pane indicators - only shown for the pane under cursor */}
      {hoveredPaneRect && (
        <PaneIndicators
          paneRect={hoveredPaneRect}
          hovered={hovered?.type === "pane" ? hovered.zone : null}
        />
      )}

      {/* Edge indicators - always visible during drag */}
      {edgeIndicators && (
        <EdgeIndicators
          indicators={edgeIndicators}
          hovered={hovered?.type === "edge" ? hovered.zone : null}
        />
      )}

      {/* Ghost tab following cursor */}
      <div
        className="fixed pointer-events-none z-[60] px-3 py-1.5 bg-sidebar border border-border rounded-md shadow-lg text-sm text-foreground opacity-80 flex items-center gap-1.5"
        style={{
          left: mousePos.x + 12,
          top: mousePos.y + 12,
        }}
      >
        {ctrlHeld && tabDrag && (
          <span className="text-primary font-bold text-xs">+</span>
        )}
        {ghostName}
      </div>
    </div>
  );
}

/** 5-zone cross pattern centered in a pane */
function PaneIndicators({
  paneRect,
  hovered,
}: {
  paneRect: DOMRect;
  hovered: DockZone | null;
}) {
  const cx = paneRect.left + paneRect.width / 2;
  const cy = paneRect.top + paneRect.height / 2;
  const s = INDICATOR_SIZE;
  const g = INDICATOR_GAP;

  const indicators: { zone: DockZone; x: number; y: number }[] = [
    { zone: "center", x: cx - s / 2, y: cy - s / 2 },
    { zone: "top", x: cx - s / 2, y: cy - s / 2 - s - g },
    { zone: "bottom", x: cx - s / 2, y: cy + s / 2 + g },
    { zone: "left", x: cx - s / 2 - s - g, y: cy - s / 2 },
    { zone: "right", x: cx + s / 2 + g, y: cy - s / 2 },
  ];

  return (
    <>
      {indicators.map(({ zone, x, y }) => (
        <Indicator key={zone} zone={zone} x={x} y={y} size={s} active={hovered === zone} />
      ))}
    </>
  );
}

/** Edge indicators at the borders of the layout area */
function EdgeIndicators({
  indicators,
  hovered,
}: {
  indicators: Record<"top" | "bottom" | "left" | "right", DOMRect>;
  hovered: Exclude<DockZone, "center"> | null;
}) {
  return (
    <>
      {(["top", "bottom", "left", "right"] as const).map((zone) => {
        const r = indicators[zone];
        return (
          <Indicator
            key={`edge-${zone}`}
            zone={zone}
            x={r.left}
            y={r.top}
            size={INDICATOR_SIZE}
            active={hovered === zone}
          />
        );
      })}
    </>
  );
}

/** Single indicator button with an icon */
function Indicator({
  zone,
  x,
  y,
  size,
  active,
}: {
  zone: DockZone;
  x: number;
  y: number;
  size: number;
  active: boolean;
}) {
  return (
    <div
      className={`absolute pointer-events-none rounded-sm border transition-colors ${
        active
          ? "bg-primary/60 border-primary shadow-sm"
          : "bg-sidebar/90 border-border/80 shadow-sm"
      }`}
      style={{ left: x, top: y, width: size, height: size }}
    >
      <ZoneIcon zone={zone} active={active} size={size} />
    </div>
  );
}

function ZoneIcon({ zone, active, size }: { zone: DockZone; active: boolean; size: number }) {
  const color = active ? "var(--color-primary-foreground)" : "var(--color-muted-foreground)";
  const fillColor = active ? "var(--color-primary)" : "var(--color-muted-foreground)";
  const iconSize = size - 10;
  const margin = 5;

  return (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 16 16"
      className="absolute"
      style={{ left: margin, top: margin }}
    >
      <rect x="1" y="1" width="14" height="14" rx="1.5" fill="none" stroke={color} strokeWidth="1.2" opacity="0.5" />
      {zone === "center" && (
        <rect x="2" y="2" width="12" height="12" rx="1" fill={fillColor} opacity="0.4" />
      )}
      {zone === "top" && (
        <rect x="2" y="2" width="12" height="5.5" rx="1" fill={fillColor} opacity="0.6" />
      )}
      {zone === "bottom" && (
        <rect x="2" y="8.5" width="12" height="5.5" rx="1" fill={fillColor} opacity="0.6" />
      )}
      {zone === "left" && (
        <rect x="2" y="2" width="5.5" height="12" rx="1" fill={fillColor} opacity="0.6" />
      )}
      {zone === "right" && (
        <rect x="8.5" y="2" width="5.5" height="12" rx="1" fill={fillColor} opacity="0.6" />
      )}
    </svg>
  );
}
