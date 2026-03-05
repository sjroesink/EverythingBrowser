import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ConnectionConfig, Tab } from "@/types/connection";

const isDetachedWindow = getCurrentWindow().label.startsWith("detached-");

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function getDefaultPath(config: ConnectionConfig): string {
  if (config.type === "LocalFs") {
    return "/";
  }
  if ("defaultPath" in config && config.defaultPath) {
    return config.defaultPath;
  }
  return "/";
}

interface TabsStore {
  tabs: Tab[];
  openTab: (config: ConnectionConfig, connectionId: string) => string;
  insertTab: (tab: Tab) => void;
  closeTab: (tabId: string) => void;
  setTabPath: (tabId: string, path: string) => void;
  getTab: (tabId: string) => Tab | undefined;
}

export const useTabsStore = create<TabsStore>()(
  persist(
    (set, get) => ({
      tabs: [],
      openTab: (config, connectionId) => {
        const newTab: Tab = {
          id: crypto.randomUUID(),
          connectionId,
          config,
          currentPath: getDefaultPath(config),
        };

        set((state) => ({
          tabs: [...state.tabs, newTab],
        }));

        return newTab.id;
      },
      insertTab: (tab) => {
        set((state) => {
          if (state.tabs.some((t) => t.id === tab.id)) return state;
          return { tabs: [...state.tabs, tab] };
        });
      },
      closeTab: (tabId) => {
        set((state) => ({
          tabs: state.tabs.filter((tab) => tab.id !== tabId),
        }));
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
      getTab: (tabId) => {
        return get().tabs.find((t) => t.id === tabId);
      },
    }),
    {
      name: "tabs-store-v1",
      storage: createJSONStorage(() => isDetachedWindow ? noopStorage : localStorage),
      partialize: (state) => ({
        tabs: state.tabs,
      }),
    }
  )
);
