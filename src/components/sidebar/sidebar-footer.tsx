import { Sun, Moon, Monitor } from "lucide-react";
import type { Theme } from "@/hooks/use-theme";

interface SidebarFooterProps {
  theme: Theme;
  onSetTheme: (theme: Theme) => void;
}

export function SidebarFooter({ theme, onSetTheme }: SidebarFooterProps) {
  const themes: { value: Theme; icon: React.ReactNode; label: string }[] = [
    { value: "light", icon: <Sun className="w-3.5 h-3.5" />, label: "Light" },
    { value: "dark", icon: <Moon className="w-3.5 h-3.5" />, label: "Dark" },
    {
      value: "system",
      icon: <Monitor className="w-3.5 h-3.5" />,
      label: "System",
    },
  ];

  return (
    <div className="px-3 py-2 border-t border-sidebar-border">
      <div className="flex items-center bg-secondary rounded-lg p-0.5">
        {themes.map((t) => (
          <button
            key={t.value}
            onClick={() => onSetTheme(t.value)}
            title={t.label}
            className={`flex-1 inline-flex items-center justify-center gap-1 py-1 rounded-md text-xs transition-all ${
              theme === t.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
