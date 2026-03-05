import { useState, useRef, useCallback, useEffect } from "react";
import { Sun, Moon, Monitor, RotateCcw, ExternalLink, FolderOpen, Settings, Keyboard } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Theme } from "@/hooks/use-theme";
import { useKeybindingsStore } from "@/stores/use-keybindings-store";
import { useSettingsStore } from "@/stores/use-settings-store";
import { normalizeKeyEvent } from "@/lib/keyboard";
import { detectEditors, type DetectedEditor } from "@/services/file-service";

const EDITOR_ICONS: Record<string, React.ReactNode> = {
  "VS Code": (
    <svg className="w-3.5 h-3.5" viewBox="0 0 100 100" fill="none">
      <mask id="a" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
        <path fillRule="evenodd" clipRule="evenodd" d="M70.912 99.317a6.223 6.223 0 004.728-.837L95.166 86.2A6.24 6.24 0 0098.88 80.5V19.5a6.24 6.24 0 00-3.714-5.7L75.64 1.52a6.226 6.226 0 00-7.104 1.1L29.388 38.039 12.47 25.282a4.16 4.16 0 00-5.318.267L1.96 30.414a4.165 4.165 0 00-.004 6.168L15.4 50 1.956 63.418a4.165 4.165 0 00.004 6.168l5.192 4.865a4.16 4.16 0 005.318.267l16.918-12.757 39.148 35.42a6.205 6.205 0 002.376 1.936zM75.016 27.386L45.016 50l30 22.614V27.386z" fill="#fff"/>
      </mask>
      <g mask="url(#a)">
        <path d="M95.166 86.2L75.64 98.48a6.231 6.231 0 01-7.104-1.1l-39.3-35.58L12.47 74.717a4.163 4.163 0 01-5.317-.267l-5.194-4.865a4.168 4.168 0 01.004-6.168L15.4 50 1.963 36.582a4.168 4.168 0 01-.004-6.168l5.194-4.865a4.163 4.163 0 015.317-.267L29.236 38.04l39.3-35.58a6.222 6.222 0 017.104-1.1L95.166 13.8A6.242 6.242 0 0198.88 19.5v61a6.241 6.241 0 01-3.714 5.7z" fill="#0065A9"/>
        <path d="M95.166 86.2L75.64 98.48a6.231 6.231 0 01-7.104-1.1l-39.3-35.58L12.47 74.717a4.163 4.163 0 01-5.317-.267l-5.194-4.865a4.168 4.168 0 01.004-6.168L15.4 50 1.963 36.582a4.168 4.168 0 01-.004-6.168l5.194-4.865a4.163 4.163 0 015.317-.267L29.236 38.04l39.3-35.58a6.222 6.222 0 017.104-1.1L95.166 13.8A6.242 6.242 0 0198.88 19.5v61a6.241 6.241 0 01-3.714 5.7z" fill="url(#p0)"/>
        <path d="M75.64 98.48a6.218 6.218 0 01-7.104-1.1L29.236 61.8 12.47 74.717a4.162 4.162 0 01-5.317-.267L1.96 69.586a4.166 4.166 0 01.004-6.168L15.4 50 1.963 36.582a4.166 4.166 0 01-.004-6.168l5.194-4.865a4.162 4.162 0 015.317-.267L29.236 38.04l39.3-35.58a6.213 6.213 0 017.104-1.1L95.166 13.8A6.24 6.24 0 0198.88 19.5v61a6.24 6.24 0 01-3.714 5.7L75.64 98.48z" fill="url(#p1)"/>
      </g>
      <defs>
        <linearGradient id="p0" x1="49.94" y1=".82" x2="49.94" y2="99.18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity=".15"/><stop offset="1" stopColor="#fff" stopOpacity="0"/>
        </linearGradient>
        <linearGradient id="p1" x1="49.94" y1=".82" x2="49.94" y2="99.18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity=".15"/><stop offset="1" stopColor="#fff" stopOpacity="0"/>
        </linearGradient>
      </defs>
    </svg>
  ),
  "Notepad++": (
    <svg className="w-3.5 h-3.5" viewBox="0 0 48 48">
      <path d="M10 8l4-4h20l4 4v32l-4 4H14l-4-4V8z" fill="#90be6d"/>
      <path d="M16 16h16M16 22h16M16 28h12" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  ),
  "Zed": (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="4" fill="#4f46e5"/>
      <path d="M7 8h10L7 16h10" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  "Sublime Text": (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
      <path d="M2 14l10-5 10 5-10 5-10-5z" fill="#ff9800"/>
      <path d="M2 9l10-5 10 5-10 5-10-5z" fill="#ff9800" opacity=".6"/>
    </svg>
  ),
  "Vim": (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
      <path d="M3 3l6 9-6 9h4l6-9-6-9H3z" fill="#019833"/>
      <path d="M11 3l6 9-6 9h4l6-9-6-9h-4z" fill="#019833"/>
    </svg>
  ),
};

interface SettingsContentProps {
  theme: Theme;
  onSetTheme: (theme: Theme) => void;
  onOpenSettingsFile: () => void;
}

const THEMES: { value: Theme; icon: React.ReactNode; label: string }[] = [
  { value: "light", icon: <Sun className="w-4 h-4" />, label: "Light" },
  { value: "dark", icon: <Moon className="w-4 h-4" />, label: "Dark" },
  { value: "system", icon: <Monitor className="w-4 h-4" />, label: "System" },
];

const COMMAND_LABELS: Record<string, string> = {
  "sidebar.toggle": "Toggle Sidebar",
  "tab.next": "Next Tab",
  "tab.prev": "Previous Tab",
  "tab.close": "Close Tab",
  "tab.closeAll": "Close All Tabs",
  "pane.splitVertical": "Split Vertical",
  "pane.splitHorizontal": "Split Horizontal",
  "pane.splitDuplicate": "Split Duplicate",
  "file.refresh": "Refresh",
  "file.goUp": "Go Up",
  "file.copy": "Copy",
  "file.paste": "Paste",
  "file.selectAll": "Select All",
  "file.rename": "Rename",
  "file.delete": "Delete",
  "file.cursorUp": "Cursor Up",
  "file.cursorDown": "Cursor Down",
  "file.selectUp": "Select Up",
  "file.selectDown": "Select Down",
  "file.moveCursorUp": "Move Cursor Up",
  "file.moveCursorDown": "Move Cursor Down",
  "file.toggleSelect": "Toggle Selection",
  "file.cursorHome": "Cursor to Top",
  "file.cursorEnd": "Cursor to Bottom",
  "file.selectToHome": "Select to Top",
  "file.selectToEnd": "Select to Bottom",
  "file.open": "Open",
};

const COMMAND_GROUPS: { label: string; commands: string[] }[] = [
  {
    label: "General",
    commands: [
      "sidebar.toggle",
      "tab.next",
      "tab.prev",
      "tab.close",
      "tab.closeAll",
      "pane.splitVertical",
      "pane.splitHorizontal",
      "pane.splitDuplicate",
    ],
  },
  {
    label: "File Browser",
    commands: [
      "file.refresh",
      "file.goUp",
      "file.copy",
      "file.paste",
      "file.selectAll",
      "file.rename",
      "file.delete",
      "file.open",
    ],
  },
  {
    label: "Navigation",
    commands: [
      "file.cursorUp",
      "file.cursorDown",
      "file.selectUp",
      "file.selectDown",
      "file.moveCursorUp",
      "file.moveCursorDown",
      "file.toggleSelect",
      "file.cursorHome",
      "file.cursorEnd",
      "file.selectToHome",
      "file.selectToEnd",
    ],
  },
];

const KEY_SYMBOLS: Record<string, string> = {
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  meta: "Meta",
  enter: "Enter",
  backspace: "Backspace",
  delete: "Delete",
  escape: "Esc",
  space: "Space",
  arrowup: "\u2191",
  arrowdown: "\u2193",
  arrowleft: "\u2190",
  arrowright: "\u2192",
  home: "Home",
  end: "End",
  f1: "F1",
  f2: "F2",
  f3: "F3",
  f4: "F4",
  f5: "F5",
  f6: "F6",
  f7: "F7",
  f8: "F8",
  f9: "F9",
  f10: "F10",
  f11: "F11",
  f12: "F12",
  "=": "+",
  "-": "\u2212",
};

function KeyBadge({ keyStr }: { keyStr: string }) {
  const parts = keyStr.split("+");
  return (
    <span className="inline-flex items-center gap-0.5">
      {parts.map((part, i) => (
        <kbd
          key={i}
          className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 text-[11px] font-medium bg-secondary border border-border rounded shadow-[0_1px_0_0] shadow-border"
        >
          {KEY_SYMBOLS[part] ?? part.toUpperCase()}
        </kbd>
      ))}
    </span>
  );
}

function ShortcutInput({
  command,
  keys,
  onSetBinding,
}: {
  command: string;
  keys: string;
  onSetBinding: (command: string, keys: string) => void;
}) {
  const [isCapturing, setIsCapturing] = useState(false);
  const inputRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const normalized = normalizeKeyEvent(e.nativeEvent);
      // Ignore bare modifier presses
      if (!normalized || ["ctrl", "alt", "shift", "meta"].includes(normalized)) {
        return;
      }
      if (normalized === "escape") {
        setIsCapturing(false);
        inputRef.current?.blur();
        return;
      }

      onSetBinding(command, normalized);
      setIsCapturing(false);
      inputRef.current?.blur();
    },
    [command, onSetBinding]
  );

  return (
    <div
      ref={inputRef}
      tabIndex={0}
      onFocus={() => setIsCapturing(true)}
      onBlur={() => setIsCapturing(false)}
      onKeyDown={isCapturing ? handleKeyDown : undefined}
      className={`inline-flex items-center justify-end min-w-[7rem] h-8 px-2 rounded-md border cursor-pointer transition-colors select-none ${
        isCapturing
          ? "border-primary ring-2 ring-ring bg-background"
          : "border-input bg-background hover:border-foreground/30"
      }`}
    >
      {isCapturing ? (
        <span className="text-xs text-muted-foreground animate-pulse">
          Press a shortcut...
        </span>
      ) : (
        <KeyBadge keyStr={keys} />
      )}
    </div>
  );
}

export function SettingsContent({
  theme,
  onSetTheme,
  onOpenSettingsFile,
}: SettingsContentProps) {
  const bindings = useKeybindingsStore((s) => s.bindings);
  const setBinding = useKeybindingsStore((s) => s.setBinding);
  const resetToDefaults = useKeybindingsStore((s) => s.resetToDefaults);
  const editorPath = useSettingsStore((s) => s.editorPath);
  const setEditorPath = useSettingsStore((s) => s.setEditorPath);
  const [detectedEditors, setDetectedEditors] = useState<DetectedEditor[]>([]);

  useEffect(() => {
    detectEditors().then(setDetectedEditors).catch(() => {});
  }, []);

  const handleBrowseEditor = useCallback(async () => {
    const selected = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "Executables", extensions: ["exe", "cmd", "bat", "com", "*"] }],
    });
    if (selected) {
      setEditorPath(selected as string);
    }
  }, [setEditorPath]);

  const [activeTab, setActiveTab] = useState<"appearance" | "shortcuts">("appearance");

  const tabs = [
    { id: "appearance" as const, label: "General", icon: <Settings className="w-4 h-4" /> },
    { id: "shortcuts" as const, label: "Keyboard Shortcuts", icon: <Keyboard className="w-4 h-4" /> },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
        {/* Sidebar tabs */}
        <nav className="w-48 shrink-0 border-r border-border py-2 px-2 space-y-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md text-sm whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === "appearance" && (
            <div className="space-y-5">
              <div>
                <label className="block text-xs text-muted-foreground mb-2">Theme</label>
                <div className="flex items-center bg-secondary rounded-lg p-1 gap-1">
                  {THEMES.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => onSetTheme(t.value)}
                      className={`flex-1 inline-flex items-center justify-center gap-2 py-2 rounded-md text-sm transition-all ${
                        theme === t.value
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t.icon}
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-muted-foreground mb-2">External Editor</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editorPath}
                    onChange={(e) => setEditorPath(e.target.value)}
                    placeholder="Path to editor executable..."
                    className="flex-1 h-8 px-2.5 text-sm bg-background border border-input rounded-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                  />
                  <button
                    onClick={handleBrowseEditor}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-input bg-background hover:bg-accent transition-colors"
                    title="Browse..."
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                </div>
                {detectedEditors.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-2">
                    {detectedEditors.map((editor) => (
                      <button
                        key={editor.path}
                        onClick={() => setEditorPath(editor.path)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border transition-colors ${
                          editorPath === editor.path
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-input bg-background text-muted-foreground hover:text-foreground hover:border-foreground/30"
                        }`}
                      >
                        {EDITOR_ICONS[editor.name]}
                        {editor.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "shortcuts" && (
            <div>
              <div className="flex items-center justify-end mb-3">
                <button
                  onClick={resetToDefaults}
                  className="inline-flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-foreground/5 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              </div>

              <div className="space-y-4">
                {COMMAND_GROUPS.map((group) => (
                  <div key={group.label}>
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      {group.label}
                    </h4>
                    <div className="space-y-1">
                      {group.commands.map((command) => {
                        const binding = bindings.find(
                          (b) => b.command === command
                        );
                        if (!binding) return null;
                        return (
                          <div
                            key={command}
                            className="flex items-center justify-between py-1"
                          >
                            <span className="text-sm">
                              {COMMAND_LABELS[command] ?? command}
                            </span>
                            <ShortcutInput
                              command={command}
                              keys={binding.keys}
                              onSetBinding={setBinding}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-border shrink-0">
        <button
          onClick={onOpenSettingsFile}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Open settings.json in editor
        </button>
      </div>
    </div>
  );
}
