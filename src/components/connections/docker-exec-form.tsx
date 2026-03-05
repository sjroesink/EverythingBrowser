import { useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { DockerExecConfig } from "@/types/connection";
import { testConnection } from "@/services/connection-service";

interface DockerExecFormProps {
  editConfig: DockerExecConfig | null;
  onSave: (config: DockerExecConfig) => void;
  onCancel: () => void;
}

export function DockerExecForm({ editConfig, onSave, onCancel }: DockerExecFormProps) {
  const [name, setName] = useState(editConfig?.name ?? "");
  const [container, setContainer] = useState(editConfig?.container ?? "");
  const [defaultPath, setDefaultPath] = useState(editConfig?.defaultPath ?? "");
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const buildConfig = (): DockerExecConfig => ({
    type: "DockerExec",
    id: editConfig?.id ?? crypto.randomUUID(),
    name: name || container,
    container,
    defaultPath: defaultPath || undefined,
  });

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
          placeholder="My Container"
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Container Name or ID</label>
        <input
          type="text"
          value={container}
          onChange={(e) => setContainer(e.target.value)}
          placeholder="my-container"
          required
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Default Path (optional)</label>
        <input
          type="text"
          value={defaultPath}
          onChange={(e) => setDefaultPath(e.target.value)}
          placeholder="/"
          className={inputClass}
        />
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
              ? "Connection successful"
              : testError || "Connection failed"}
          </span>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={handleTest}
          disabled={!container || isTesting}
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
