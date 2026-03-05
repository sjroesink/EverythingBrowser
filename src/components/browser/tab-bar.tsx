import { useRef, useCallback, useState, useEffect } from "react";
import { Server, Cloud, HardDrive, Terminal, X } from "lucide-react";
import { useLayoutStore } from "@/stores/use-layout-store";
import type { Tab } from "@/types/connection";

const DRAG_THRESHOLD = 5;

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  paneId: string;
  isFocused?: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onDuplicateTab: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
  onCloseConnectionTabs: (connectionId: string) => void;
}

export function TabBar({
  tabs,
  activeTabId,
  paneId,
  isFocused = false,
  onSelectTab,
  onCloseTab,
  onDuplicateTab,
  onCloseOtherTabs,
  onCloseConnectionTabs,
}: TabBarProps) {
  const startTabDrag = useLayoutStore((s) => s.startTabDrag);
  const dragStartRef = useRef<{
    tabId: string;
    x: number;
    y: number;
  } | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    tabId: string;
    connectionId: string;
    x: number;
    y: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [contextMenu]);

  const handleTabMouseDown = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      // Only left click, not the close button
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;

      dragStartRef.current = { tabId, x: e.clientX, y: e.clientY };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragStartRef.current) return;

        const dx = moveEvent.clientX - dragStartRef.current.x;
        const dy = moveEvent.clientY - dragStartRef.current.y;

        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          startTabDrag(dragStartRef.current.tabId, paneId);
          dragStartRef.current = null;
          document.removeEventListener("mousemove", handleMouseMove);
          document.removeEventListener("mouseup", handleMouseUp);
        }
      };

      const handleMouseUp = () => {
        dragStartRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [paneId, startTabDrag]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, tab: Tab) => {
      e.preventDefault();
      setContextMenu({
        tabId: tab.id,
        connectionId: tab.connectionId,
        x: e.clientX,
        y: e.clientY,
      });
    },
    []
  );

  if (tabs.length === 0) return null;

  return (
    <>
      <div className="flex bg-sidebar border-b border-border overflow-x-auto shrink-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onCloseTab(tab.id);
                } else {
                  handleTabMouseDown(e, tab.id);
                }
              }}
              onContextMenu={(e) => handleContextMenu(e, tab)}
              data-tab-id={tab.id}
              data-pane-id={paneId}
              className={`group flex items-center gap-1.5 px-3 h-9 text-sm cursor-pointer border-r border-border select-none shrink-0 ${
                isActive
                  ? `bg-background text-foreground ${isFocused ? "border-b-2 border-b-primary" : ""}`
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
              }`}
            >
              {tab.config.type === "Sftp" && <Server className="w-3.5 h-3.5 shrink-0" />}
              {tab.config.type === "BackblazeB2" && <Cloud className="w-3.5 h-3.5 shrink-0" />}
              {tab.config.type === "DockerVolume" && <HardDrive className="w-3.5 h-3.5 shrink-0" />}
              {tab.config.type === "DockerExec" && <Terminal className="w-3.5 h-3.5 shrink-0" />}
              <span className="truncate max-w-[140px]">{tab.config.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className={`shrink-0 w-4 h-4 rounded-sm inline-flex items-center justify-center hover:bg-foreground/10 transition-opacity ${
                  isActive
                    ? "opacity-60 hover:opacity-100"
                    : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
                }`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 w-52 bg-popover border border-border rounded-lg shadow-lg py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              onCloseTab(contextMenu.tabId);
              setContextMenu(null);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => {
              onCloseOtherTabs(contextMenu.tabId);
              setContextMenu(null);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors"
          >
            Close other
          </button>
          <button
            onClick={() => {
              onCloseConnectionTabs(contextMenu.connectionId);
              setContextMenu(null);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors"
          >
            Close all from connection
          </button>
          <div className="my-1 border-t border-border" />
          <button
            onClick={() => {
              onDuplicateTab(contextMenu.tabId);
              setContextMenu(null);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors"
          >
            Duplicate
            <span className="ml-auto text-xs text-muted-foreground">Alt+Shift+D</span>
          </button>
        </div>
      )}
    </>
  );
}
