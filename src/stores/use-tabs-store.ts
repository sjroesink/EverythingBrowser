import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ConnectionConfig, Tab } from "@/types/connection";

function getDefaultPath(config: ConnectionConfig): string {
  if (config.type === "Sftp" && config.defaultPath) {
    return config.defaultPath;
  }
  return "/";
}

interface TabsStore {
  tabs: Tab[];
  activeTabId: string | null;
  openTab: (config: ConnectionConfig, connectionId: string) => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string | null) => void;
  setTabPath: (tabId: string, path: string) => void;
}

export const useTabsStore = create<TabsStore>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      openTab: (config, connectionId) => {
        const existing = get().tabs.find(
          (tab) => tab.connectionId === connectionId
        );

        if (existing) {
          set((state) => ({
            tabs: state.tabs.map((tab) =>
              tab.id === existing.id ? { ...tab, config } : tab
            ),
            activeTabId: existing.id,
          }));
          return existing.id;
        }

        const newTab: Tab = {
          id: crypto.randomUUID(),
          connectionId,
          config,
          currentPath: getDefaultPath(config),
        };

        set((state) => ({
          tabs: [...state.tabs, newTab],
          activeTabId: newTab.id,
        }));

        return newTab.id;
      },
      closeTab: (tabId) => {
        set((state) => {
          const nextTabs = state.tabs.filter((tab) => tab.id !== tabId);

          if (state.activeTabId !== tabId) {
            return { tabs: nextTabs };
          }

          const closedIndex = state.tabs.findIndex((tab) => tab.id === tabId);
          const fallbackTab =
            nextTabs[Math.min(closedIndex, nextTabs.length - 1)] ?? null;

          return {
            tabs: nextTabs,
            activeTabId: fallbackTab?.id ?? null,
          };
        });
      },
      setActiveTab: (tabId) => {
        set({ activeTabId: tabId });
      },
      setTabPath: (tabId, path) => {
        set((state) => {
          const tab = state.tabs.find((entry) => entry.id === tabId);
          if (!tab || tab.currentPath === path) {
            return state;
          }

          return {
            tabs: state.tabs.map((entry) =>
              entry.id === tabId ? { ...entry, currentPath: path } : entry
            ),
          };
        });
      },
    }),
    {
      name: "tabs-store-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      }),
    }
  )
);

