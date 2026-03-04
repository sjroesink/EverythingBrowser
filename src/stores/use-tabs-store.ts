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
  openTab: (config: ConnectionConfig, connectionId: string) => string;
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
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        tabs: state.tabs,
      }),
    }
  )
);
