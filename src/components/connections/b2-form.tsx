import { useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { B2Config } from "@/types/connection";
import { testConnection } from "@/services/connection-service";

interface B2FormProps {
  editConfig: B2Config | null;
  onSave: (config: B2Config, secret?: string) => void;
  onCancel: () => void;
}

export function B2Form({ editConfig, onSave, onCancel }: B2FormProps) {
  const [name, setName] = useState(editConfig?.name ?? "");
  const [applicationKeyId, setApplicationKeyId] = useState(
    editConfig?.applicationKeyId ?? ""
  );
  const [applicationKey, setApplicationKey] = useState("");
  const [bucketName, setBucketName] = useState(editConfig?.bucketName ?? "");
  const [region, setRegion] = useState(editConfig?.region ?? "us-west-004");
  const [endpoint, setEndpoint] = useState(editConfig?.endpoint ?? "");
  const [prefix, setPrefix] = useState(editConfig?.prefix ?? "");
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(
    null
  );
  const [testError, setTestError] = useState<string | null>(null);

  const buildConfig = (): { config: B2Config; secret?: string } => {
    const config: B2Config = {
      type: "BackblazeB2",
      id: editConfig?.id ?? crypto.randomUUID(),
      name: name || bucketName,
      applicationKeyId,
      bucketName,
      region,
      endpoint: endpoint || undefined,
      prefix: prefix || undefined,
    };
    return { config, secret: applicationKey || undefined };
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const { config, secret } = buildConfig();
      await testConnection(config, secret);
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
    const { config, secret } = buildConfig();
    onSave(config, secret);
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
          placeholder="My B2 Bucket"
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Application Key ID</label>
        <input
          type="text"
          value={applicationKeyId}
          onChange={(e) => setApplicationKeyId(e.target.value)}
          placeholder="00xxxxxxxxxxxxx"
          required
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Application Key</label>
        <input
          type="password"
          value={applicationKey}
          onChange={(e) => setApplicationKey(e.target.value)}
          placeholder={editConfig ? "Leave blank to keep existing" : "Enter application key"}
          required={!editConfig}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Bucket Name</label>
          <input
            type="text"
            value={bucketName}
            onChange={(e) => setBucketName(e.target.value)}
            placeholder="my-bucket"
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Region</label>
          <input
            type="text"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="us-west-004"
            required
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Custom Endpoint (optional)</label>
        <input
          type="text"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="https://s3.us-west-004.backblazeb2.com"
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Path Prefix (optional)</label>
        <input
          type="text"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          placeholder="folder/subfolder/"
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
          disabled={!applicationKeyId || !bucketName || isTesting}
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
