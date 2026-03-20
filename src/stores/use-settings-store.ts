import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface SettingsState {
  editorPath: string;
  setEditorPath: (path: string) => void;
  autoUpdate: boolean;
  setAutoUpdate: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      editorPath: "",
      setEditorPath: (path) => set({ editorPath: path }),
      autoUpdate: false,
      setAutoUpdate: (enabled) => set({ autoUpdate: enabled }),
    }),
    {
      name: "settings-store-v1",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
