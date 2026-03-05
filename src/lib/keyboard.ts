/**
 * Normalize a KeyboardEvent into a canonical string like "ctrl+shift+w", "alt+right".
 * Modifier order: ctrl > alt > shift > meta.
 */
export function normalizeKeyEvent(e: KeyboardEvent): string {
  const parts: string[] = [];

  if (e.ctrlKey || e.metaKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");

  let key = e.key.toLowerCase();

  // Normalize special key names
  if (key === " ") key = "space";
  if (key === "arrowup") key = "arrowup";
  if (key === "arrowdown") key = "arrowdown";
  if (key === "arrowleft") key = "arrowleft";
  if (key === "arrowright") key = "arrowright";

  // Don't add modifier keys themselves as the key part
  if (["control", "alt", "shift", "meta"].includes(key)) {
    return parts.join("+");
  }

  parts.push(key);
  return parts.join("+");
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    target.isContentEditable ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT"
  );
}
