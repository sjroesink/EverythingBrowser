import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface KeyBinding {
  keys: string;
  command: string;
}

interface KeybindingsStore {
  bindings: KeyBinding[];
  getCommandForKeys: (keys: string) => string | undefined;
  getKeysForCommand: (command: string) => string | undefined;
  setBinding: (command: string, keys: string) => void;
  resetToDefaults: () => void;
}

const DEFAULT_BINDINGS: KeyBinding[] = [
  // Global
  { keys: "ctrl+b", command: "sidebar.toggle" },
  { keys: "alt+arrowright", command: "tab.next" },
  { keys: "alt+arrowleft", command: "tab.prev" },
  { keys: "ctrl+w", command: "tab.close" },
  { keys: "ctrl+shift+w", command: "tab.closeAll" },
  { keys: "alt+shift+=", command: "pane.splitVertical" },
  { keys: "alt+shift+-", command: "pane.splitHorizontal" },
  { keys: "alt+shift+d", command: "pane.splitDuplicate" },

  // File browser
  { keys: "f5", command: "file.refresh" },
  { keys: "backspace", command: "file.goUp" },
  { keys: "ctrl+c", command: "file.copy" },
  { keys: "ctrl+v", command: "file.paste" },
  { keys: "ctrl+a", command: "file.selectAll" },
  { keys: "f2", command: "file.rename" },
  { keys: "delete", command: "file.delete" },

  // File list navigation
  { keys: "arrowup", command: "file.cursorUp" },
  { keys: "arrowdown", command: "file.cursorDown" },
  { keys: "shift+arrowup", command: "file.selectUp" },
  { keys: "shift+arrowdown", command: "file.selectDown" },
  { keys: "ctrl+arrowup", command: "file.moveCursorUp" },
  { keys: "ctrl+arrowdown", command: "file.moveCursorDown" },
  { keys: "ctrl+space", command: "file.toggleSelect" },
  { keys: "home", command: "file.cursorHome" },
  { keys: "end", command: "file.cursorEnd" },
  { keys: "shift+home", command: "file.selectToHome" },
  { keys: "shift+end", command: "file.selectToEnd" },
  { keys: "enter", command: "file.open" },
];

export const useKeybindingsStore = create<KeybindingsStore>()(
  persist(
    (set, get) => ({
      bindings: DEFAULT_BINDINGS,

      getCommandForKeys: (keys) => {
        return get().bindings.find((b) => b.keys === keys)?.command;
      },

      getKeysForCommand: (command) => {
        return get().bindings.find((b) => b.command === command)?.keys;
      },

      setBinding: (command, keys) => {
        set((state) => ({
          bindings: state.bindings.map((b) =>
            b.command === command ? { ...b, keys } : b
          ),
        }));
      },

      resetToDefaults: () => {
        set({ bindings: DEFAULT_BINDINGS });
      },
    }),
    {
      name: "keybindings-store-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ bindings: state.bindings }),
    }
  )
);
