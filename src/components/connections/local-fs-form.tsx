import { useState } from "react";
import { Loader2, CheckCircle2, XCircle, FolderOpen } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { LocalFsConfig } from "@/types/connection";
import { testConnection } from "@/services/connection-service";

interface LocalFsFormProps {
  editConfig: LocalFsConfig | null;
  initialPath?: string;
  onSave: (config: LocalFsConfig) => void;
  onCancel: () => void;
}

export function LocalFsForm({ editConfig, initialPath, onSave, onCancel }: LocalFsFormProps) {
  const [name, setName] = useState(editConfig?.name ?? "");
  const [path, setPath] = useState(editConfig?.path ?? initialPath ?? "");
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const buildConfig = (): LocalFsConfig => ({
    type: "LocalFs",
    id: editConfig?.id ?? crypto.randomUUID(),
    name: name || path.split(/[\\/]/).pop() || "Local Folder",
    path,
  });

  const handleBrowse = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
    });
    if (selected) {
      setPath(selected as string);
      if (!name) {
        setName((selected as string).split(/[\\/]/).pop() || "");
      }
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      await testConnection(buildConfig());
      setTestResult("success");
    } catch (e) {
      setTestResult("error");
      setTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(buildConfig());
  };

  const inputClass =
    "w-full px-3 py-2 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all";
  const labelClass = "block text-xs font-medium text-muted-foreground mb-1.5";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className={labelClass}>Display Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Folder"
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Folder Path</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="C:\Users\..."
            required
            className={inputClass}
          />
          <button
            type="button"
            onClick={handleBrowse}
            className="shrink-0 px-3 py-2 rounded-lg border border-input hover:bg-accent transition-colors"
            title="Browse"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
        </div>
      </div>

      {testResult && (
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
            testResult === "success"
              ? "bg-green-500/10 text-green-600"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {testResult === "success" ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 flex-shrink-0" />
          )}
          <span className="truncate">
            {testResult === "success"
              ? "Folder accessible"
              : testError || "Folder not accessible"}
          </span>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={handleTest}
          disabled={!path || isTesting}
          className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
        >
          {isTesting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Test Connection
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {editConfig ? "Save" : "Add Connection"}
          </button>
        </div>
      </div>
    </form>
  );
}
