import { ChevronRight, Home } from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface BreadcrumbNavProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export function BreadcrumbNav({ currentPath, onNavigate }: BreadcrumbNavProps) {
  const segments = currentPath.split("/").filter(Boolean);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(currentPath);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setInputValue(currentPath);
      // Wait for render, then select all
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, currentPath]);

  const submit = () => {
    setEditing(false);
    const trimmed = inputValue.trim();
    if (trimmed && trimmed !== currentPath) {
      onNavigate(trimmed.startsWith("/") ? trimmed : "/" + trimmed);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={submit}
        className="w-full px-2 py-0.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    );
  }

  return (
    <div
      className="flex items-center gap-0.5 text-sm min-w-0 overflow-hidden flex-1"
      onDoubleClick={() => setEditing(true)}
    >
      <button
        onClick={() => onNavigate("/")}
        className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      >
        <Home className="w-3.5 h-3.5" />
      </button>

      {segments.map((segment, i) => {
        const path = "/" + segments.slice(0, i + 1).join("/");
        const isLast = i === segments.length - 1;
        return (
          <div key={path} className="flex items-center gap-0.5 min-w-0">
            <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
            <button
              onClick={() => onNavigate(path)}
              className={`px-1.5 py-0.5 rounded-md text-sm truncate max-w-[200px] transition-colors ${
                isLast
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              {segment}
            </button>
          </div>
        );
      })}
    </div>
  );
}
