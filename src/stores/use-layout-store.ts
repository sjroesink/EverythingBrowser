import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { getCurrentWindow } from "@tauri-apps/api/window";

const isDetachedWindow = getCurrentWindow().label.startsWith("detached-");

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export type SplitDirection = "horizontal" | "vertical";

export interface SplitNode {
  type: "split";
  id: string;
  direction: SplitDirection;
  children: [LayoutNode, LayoutNode];
  sizes: [number, number];
}

export interface PaneNode {
  type: "pane";
  id: string;
  tabIds: string[];
  activeTabId: string | null;
}

export type LayoutNode = SplitNode | PaneNode;

export interface TabDragState {
  tabId: string;
  sourcePaneId: string;
}

export interface ConnectionDragState {
  configId: string;
  name: string;
  connectionType: string;
}

export interface FileDragState {
  sourceConnectionId: string;
  sourcePaneId: string;
  entries: { path: string; name: string; isDir: boolean }[];
}

interface LayoutStore {
  root: LayoutNode;
  sidebarCollapsed: boolean;
  focusedPaneId: string | null;
  tabDrag: TabDragState | null;
  connectionDrag: ConnectionDragState | null;
  fileDrag: FileDragState | null;

  // Sidebar
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Focus
  setFocusedPane: (paneId: string) => void;

  // Pane operations
  splitPane: (
    paneId: string,
    direction: SplitDirection,
    newTabId: string
  ) => void;
  moveTabToPane: (tabId: string, fromPaneId: string, toPaneId: string) => void;
  addTabToPane: (paneId: string, tabId: string) => void;
  removeTabFromPane: (paneId: string, tabId: string) => void;
  setActiveTabInPane: (paneId: string, tabId: string) => void;
  updateSizes: (splitId: string, sizes: [number, number]) => void;

  // Tab drag
  startTabDrag: (tabId: string, sourcePaneId: string) => void;
  endTabDrag: () => void;

  // Connection drag (from sidebar)
  startConnectionDrag: (configId: string, name: string, connectionType: string) => void;
  endConnectionDrag: () => void;

  // File drag (cross-pane copy)
  startFileDrag: (sourceConnectionId: string, sourcePaneId: string, entries: FileDragState["entries"]) => void;
  endFileDrag: () => void;

  // Queries
  findPaneForTab: (tabId: string) => string | null;
  getFirstPaneId: () => string;

  // Dock operations (atomic remove + split)
  dockTabToSplit: (
    tabId: string,
    sourcePaneId: string,
    targetPaneId: string,
    direction: SplitDirection,
    insertBefore: boolean
  ) => void;
  dockTabToEdge: (
    tabId: string,
    sourcePaneId: string,
    direction: SplitDirection,
    insertBefore: boolean
  ) => void;

  // Place a brand-new tab (no source pane) into a split or edge
  placeNewTabInSplit: (
    tabId: string,
    targetPaneId: string,
    direction: SplitDirection,
    insertBefore: boolean
  ) => void;
  placeNewTabAtEdge: (
    tabId: string,
    direction: SplitDirection,
    insertBefore: boolean
  ) => void;

  // Cleanup
  removeTabFromAllPanes: (tabId: string) => void;
}

function generateId(): string {
  return crypto.randomUUID();
}

function findNode(
  root: LayoutNode,
  id: string
): LayoutNode | null {
  if (root.id === id) return root;
  if (root.type === "split") {
    return findNode(root.children[0], id) ?? findNode(root.children[1], id);
  }
  return null;
}

function findPaneWithTab(
  root: LayoutNode,
  tabId: string
): PaneNode | null {
  if (root.type === "pane") {
    return root.tabIds.includes(tabId) ? root : null;
  }
  return (
    findPaneWithTab(root.children[0], tabId) ??
    findPaneWithTab(root.children[1], tabId)
  );
}

function getFirstPane(root: LayoutNode): PaneNode {
  if (root.type === "pane") return root;
  return getFirstPane(root.children[0]);
}

function replaceNode(
  root: LayoutNode,
  targetId: string,
  replacement: LayoutNode
): LayoutNode {
  if (root.id === targetId) return replacement;
  if (root.type === "split") {
    return {
      ...root,
      children: [
        replaceNode(root.children[0], targetId, replacement),
        replaceNode(root.children[1], targetId, replacement),
      ] as [LayoutNode, LayoutNode],
    };
  }
  return root;
}

/** After removing a tab, collapse any empty panes and single-child splits */
function cleanupTree(root: LayoutNode): LayoutNode | null {
  if (root.type === "pane") {
    return root.tabIds.length === 0 ? null : root;
  }

  const left = cleanupTree(root.children[0]);
  const right = cleanupTree(root.children[1]);

  if (left === null && right === null) return null;
  if (left === null) return right;
  if (right === null) return left;

  return { ...root, children: [left, right] as [LayoutNode, LayoutNode] };
}

function updateNodeInTree(
  root: LayoutNode,
  nodeId: string,
  updater: (node: LayoutNode) => LayoutNode
): LayoutNode {
  if (root.id === nodeId) return updater(root);
  if (root.type === "split") {
    return {
      ...root,
      children: [
        updateNodeInTree(root.children[0], nodeId, updater),
        updateNodeInTree(root.children[1], nodeId, updater),
      ] as [LayoutNode, LayoutNode],
    };
  }
  return root;
}

const DEFAULT_ROOT: PaneNode = {
  type: "pane",
  id: "default-pane",
  tabIds: [],
  activeTabId: null,
};

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set, get) => ({
      root: DEFAULT_ROOT,
      sidebarCollapsed: false,
      focusedPaneId: null,
      tabDrag: null,
      connectionDrag: null,
      fileDrag: null,

      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      setSidebarCollapsed: (collapsed) =>
        set({ sidebarCollapsed: collapsed }),

      setFocusedPane: (paneId) =>
        set({ focusedPaneId: paneId }),

      splitPane: (paneId, direction, newTabId) => {
        set((state) => {
          const pane = findNode(state.root, paneId);
          if (!pane || pane.type !== "pane") return state;

          const newPane: PaneNode = {
            type: "pane",
            id: generateId(),
            tabIds: [newTabId],
            activeTabId: newTabId,
          };

          const splitNode: SplitNode = {
            type: "split",
            id: generateId(),
            direction,
            children: [pane, newPane],
            sizes: [50, 50],
          };

          return { root: replaceNode(state.root, paneId, splitNode) };
        });
      },

      moveTabToPane: (tabId, fromPaneId, toPaneId) => {
        if (fromPaneId === toPaneId) return;

        set((state) => {
          // Remove from source
          let newRoot = updateNodeInTree(state.root, fromPaneId, (node) => {
            if (node.type !== "pane") return node;
            const newTabIds = node.tabIds.filter((id) => id !== tabId);
            return {
              ...node,
              tabIds: newTabIds,
              activeTabId:
                node.activeTabId === tabId
                  ? newTabIds[0] ?? null
                  : node.activeTabId,
            };
          });

          // Add to target
          newRoot = updateNodeInTree(newRoot, toPaneId, (node) => {
            if (node.type !== "pane") return node;
            if (node.tabIds.includes(tabId)) return node;
            return {
              ...node,
              tabIds: [...node.tabIds, tabId],
              activeTabId: tabId,
            };
          });

          // Cleanup empty panes
          const cleaned = cleanupTree(newRoot);
          return { root: cleaned ?? DEFAULT_ROOT };
        });
      },

      addTabToPane: (paneId, tabId) => {
        set((state) => ({
          focusedPaneId: paneId,
          root: updateNodeInTree(state.root, paneId, (node) => {
            if (node.type !== "pane") return node;
            if (node.tabIds.includes(tabId)) {
              return { ...node, activeTabId: tabId };
            }
            return {
              ...node,
              tabIds: [...node.tabIds, tabId],
              activeTabId: tabId,
            };
          }),
        }));
      },

      removeTabFromPane: (paneId, tabId) => {
        set((state) => {
          const newRoot = updateNodeInTree(state.root, paneId, (node) => {
            if (node.type !== "pane") return node;
            const oldIndex = node.tabIds.indexOf(tabId);
            const newTabIds = node.tabIds.filter((id) => id !== tabId);
            // Pick the neighbor tab: prefer same index (right neighbor), fallback to left
            const nextActiveId =
              node.activeTabId === tabId
                ? (newTabIds[Math.min(oldIndex, newTabIds.length - 1)] ?? null)
                : node.activeTabId;
            return {
              ...node,
              tabIds: newTabIds,
              activeTabId: nextActiveId,
            };
          });
          const cleaned = cleanupTree(newRoot);
          return { root: cleaned ?? DEFAULT_ROOT };
        });
      },

      setActiveTabInPane: (paneId, tabId) => {
        set((state) => ({
          root: updateNodeInTree(state.root, paneId, (node) => {
            if (node.type !== "pane") return node;
            return { ...node, activeTabId: tabId };
          }),
        }));
      },

      updateSizes: (splitId, sizes) => {
        set((state) => ({
          root: updateNodeInTree(state.root, splitId, (node) => {
            if (node.type !== "split") return node;
            return { ...node, sizes };
          }),
        }));
      },

      startTabDrag: (tabId, sourcePaneId) => {
        set({ tabDrag: { tabId, sourcePaneId } });
      },

      endTabDrag: () => {
        set({ tabDrag: null });
      },

      startConnectionDrag: (configId, name, connectionType) => {
        set({ connectionDrag: { configId, name, connectionType } });
      },

      endConnectionDrag: () => {
        set({ connectionDrag: null });
      },

      startFileDrag: (sourceConnectionId, sourcePaneId, entries) => {
        set({ fileDrag: { sourceConnectionId, sourcePaneId, entries } });
      },

      endFileDrag: () => {
        set({ fileDrag: null });
      },

      findPaneForTab: (tabId) => {
        const pane = findPaneWithTab(get().root, tabId);
        return pane?.id ?? null;
      },

      getFirstPaneId: () => {
        return getFirstPane(get().root).id;
      },

      dockTabToSplit: (tabId, sourcePaneId, targetPaneId, direction, insertBefore) => {
        set((state) => {
          let root = state.root;

          // 1. Remove tab from source pane (without cleanup yet)
          root = updateNodeInTree(root, sourcePaneId, (node) => {
            if (node.type !== "pane") return node;
            const newTabIds = node.tabIds.filter((id) => id !== tabId);
            return {
              ...node,
              tabIds: newTabIds,
              activeTabId:
                node.activeTabId === tabId
                  ? newTabIds[0] ?? null
                  : node.activeTabId,
            };
          });

          // 2. Split the target pane, placing the new pane before or after
          const targetPane = findNode(root, targetPaneId);
          if (targetPane && targetPane.type === "pane") {
            const newPane: PaneNode = {
              type: "pane",
              id: generateId(),
              tabIds: [tabId],
              activeTabId: tabId,
            };

            const splitNode: SplitNode = {
              type: "split",
              id: generateId(),
              direction,
              children: insertBefore
                ? [newPane, targetPane]
                : [targetPane, newPane],
              sizes: [50, 50],
            };

            root = replaceNode(root, targetPaneId, splitNode);
          }

          // 3. Cleanup empty panes
          const cleaned = cleanupTree(root);
          return { root: cleaned ?? DEFAULT_ROOT };
        });
      },

      dockTabToEdge: (tabId, sourcePaneId, direction, insertBefore) => {
        set((state) => {
          let root = state.root;

          // 1. Remove tab from source pane
          root = updateNodeInTree(root, sourcePaneId, (node) => {
            if (node.type !== "pane") return node;
            const newTabIds = node.tabIds.filter((id) => id !== tabId);
            return {
              ...node,
              tabIds: newTabIds,
              activeTabId:
                node.activeTabId === tabId
                  ? newTabIds[0] ?? null
                  : node.activeTabId,
            };
          });

          // 2. Cleanup empty panes first
          root = cleanupTree(root) ?? DEFAULT_ROOT;

          // 3. Wrap entire root in a split with the new pane
          const newPane: PaneNode = {
            type: "pane",
            id: generateId(),
            tabIds: [tabId],
            activeTabId: tabId,
          };

          const splitNode: SplitNode = {
            type: "split",
            id: generateId(),
            direction,
            children: insertBefore
              ? [newPane, root]
              : [root, newPane],
            sizes: [50, 50],
          };

          return { root: splitNode };
        });
      },

      placeNewTabInSplit: (tabId, targetPaneId, direction, insertBefore) => {
        set((state) => {
          const targetPane = findNode(state.root, targetPaneId);
          if (!targetPane || targetPane.type !== "pane") return state;

          const newPane: PaneNode = {
            type: "pane",
            id: generateId(),
            tabIds: [tabId],
            activeTabId: tabId,
          };

          const splitNode: SplitNode = {
            type: "split",
            id: generateId(),
            direction,
            children: insertBefore
              ? [newPane, targetPane]
              : [targetPane, newPane],
            sizes: [50, 50],
          };

          return { root: replaceNode(state.root, targetPaneId, splitNode) };
        });
      },

      placeNewTabAtEdge: (tabId, direction, insertBefore) => {
        set((state) => {
          const newPane: PaneNode = {
            type: "pane",
            id: generateId(),
            tabIds: [tabId],
            activeTabId: tabId,
          };

          const splitNode: SplitNode = {
            type: "split",
            id: generateId(),
            direction,
            children: insertBefore
              ? [newPane, state.root]
              : [state.root, newPane],
            sizes: [50, 50],
          };

          return { root: splitNode };
        });
      },

      removeTabFromAllPanes: (tabId) => {
        set((state) => {
          const removeFromNode = (node: LayoutNode): LayoutNode => {
            if (node.type === "pane") {
              if (!node.tabIds.includes(tabId)) return node;
              const oldIndex = node.tabIds.indexOf(tabId);
              const newTabIds = node.tabIds.filter((id) => id !== tabId);
              const nextActiveId =
                node.activeTabId === tabId
                  ? (newTabIds[Math.min(oldIndex, newTabIds.length - 1)] ?? null)
                  : node.activeTabId;
              return {
                ...node,
                tabIds: newTabIds,
                activeTabId: nextActiveId,
              };
            }
            return {
              ...node,
              children: [
                removeFromNode(node.children[0]),
                removeFromNode(node.children[1]),
              ] as [LayoutNode, LayoutNode],
            };
          };

          const newRoot = removeFromNode(state.root);
          const cleaned = cleanupTree(newRoot);
          return { root: cleaned ?? DEFAULT_ROOT };
        });
      },
    }),
    {
      name: "layout-store-v1",
      storage: createJSONStorage(() => isDetachedWindow ? noopStorage : localStorage),
      partialize: (state) => ({
        root: state.root,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
);
