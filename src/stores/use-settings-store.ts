import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface SettingsState {
  editorPath: string;
  setEditorPath: (path: string) => void;
  autoUpdate: boolean;
  setAutoUpdate: (enabled: boolean) => void;
}

const STORE_KEY = "settings-store-v1";

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      editorPath: "",
      setEditorPath: (path) => set({ editorPath: path }),
      autoUpdate: false,
      setAutoUpdate: (enabled) => set({ autoUpdate: enabled }),
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => localStorage),
    }
  )
);

// Sync settings across Tauri windows via localStorage "storage" event
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORE_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        const s = parsed?.state;
        if (s) {
          useSettingsStore.setState({
            editorPath: s.editorPath ?? "",
            autoUpdate: s.autoUpdate ?? false,
          });
        }
      } catch {
        // ignore malformed data
      }
    }
  });
}
