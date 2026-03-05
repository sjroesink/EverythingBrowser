import { useEffect } from "react";
import { normalizeKeyEvent, isEditableTarget } from "@/lib/keyboard";
import { useKeybindingsStore } from "@/stores/use-keybindings-store";

// Commands that should still fire even when focus is in an editable target
const BYPASS_EDITABLE_COMMANDS = new Set<string>();

export function useKeyboardShortcuts(
  handlers: Record<string, () => void>,
  options?: { enabled?: boolean }
) {
  const bindings = useKeybindingsStore((s) => s.bindings);
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;

    // Build a lookup: keys -> command (only for commands we handle)
    const keyToCommand = new Map<string, string>();
    for (const binding of bindings) {
      if (binding.command in handlers) {
        keyToCommand.set(binding.keys, binding.command);
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const normalized = normalizeKeyEvent(e);
      const command = keyToCommand.get(normalized);
      if (!command) return;

      // Skip if focus is in an editable element (unless command bypasses this)
      if (isEditableTarget(e.target) && !BYPASS_EDITABLE_COMMANDS.has(command)) {
        return;
      }

      e.preventDefault();
      handlers[command]();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, bindings, handlers]);
}
