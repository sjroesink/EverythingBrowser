import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Folder, Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { SftpConfig, SftpAuthMethod } from "@/types/connection";
import { testConnection } from "@/services/connection-service";

interface SftpFormProps {
  editConfig: SftpConfig | null;
  onSave: (config: SftpConfig, secret?: string) => void;
  onCancel: () => void;
}

type AuthMethodType = "Password" | "PrivateKey" | "KeyboardInteractive";

export function SftpForm({ editConfig, onSave, onCancel }: SftpFormProps) {
  const [name, setName] = useState(editConfig?.name ?? "");
  const [host, setHost] = useState(editConfig?.host ?? "");
  const [port, setPort] = useState(editConfig?.port ?? 22);
  const [username, setUsername] = useState(editConfig?.username ?? "");
  const [authMethodType, setAuthMethodType] = useState<AuthMethodType>(
    editConfig?.authMethod?.method ?? "Password"
  );
  const [password, setPassword] = useState("");
  const [keyPath, setKeyPath] = useState(
    editConfig?.authMethod?.method === "PrivateKey"
      ? editConfig.authMethod.keyPath
      : ""
  );
  const [passphraseProtected, setPassphraseProtected] = useState(
    editConfig?.authMethod?.method === "PrivateKey"
      ? editConfig.authMethod.passphraseProtected
      : false
  );
  const [passphrase, setPassphrase] = useState("");
  const [useSshAgent, setUseSshAgent] = useState(
    editConfig?.useSshAgent ?? false
  );
  const [defaultPath, setDefaultPath] = useState(
    editConfig?.defaultPath ?? ""
  );
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(
    null
  );
  const [testError, setTestError] = useState<string | null>(null);

  const buildConfig = (): { config: SftpConfig; secret?: string } => {
    let authMethod: SftpAuthMethod;
    let secret: string | undefined;

    switch (authMethodType) {
      case "Password":
        authMethod = { method: "Password" };
        secret = password || undefined;
        break;
      case "PrivateKey":
        authMethod = {
          method: "PrivateKey",
          keyPath,
          passphraseProtected,
        };
        secret = passphraseProtected ? passphrase || undefined : undefined;
        break;
      case "KeyboardInteractive":
        authMethod = { method: "KeyboardInteractive" };
        secret = password || undefined;
        break;
    }

    const config: SftpConfig = {
      type: "Sftp",
      id: editConfig?.id ?? crypto.randomUUID(),
      name: name || `${host}:${port}`,
      host,
      port,
      username,
      authMethod,
      useSshAgent,
      defaultPath: defaultPath || undefined,
    };

    return { config, secret };
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

  const handleBrowseKey = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        { name: "SSH Keys", extensions: ["pem", "ppk", "pub", "key", "*"] },
      ],
    });
    if (selected) {
      setKeyPath(selected as string);
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
          placeholder="My Server"
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className={labelClass}>Host</label>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="example.com"
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Port</label>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(parseInt(e.target.value) || 22)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Username</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="user"
          required
          className={inputClass}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="use-ssh-agent"
          checked={useSshAgent}
          onChange={(e) => setUseSshAgent(e.target.checked)}
          className="rounded border-input"
        />
        <label htmlFor="use-ssh-agent" className="text-sm text-foreground">
          Try SSH agent first
        </label>
        <span className="text-xs text-muted-foreground">
          (Pageant / OpenSSH Agent)
        </span>
      </div>

      <div>
        <label className={labelClass}>Authentication Method</label>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { value: "Password", label: "Password" },
              { value: "PrivateKey", label: "Private Key" },
              { value: "KeyboardInteractive", label: "Interactive" },
            ] as { value: AuthMethodType; label: string }[]
          ).map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setAuthMethodType(m.value)}
              className={`px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                authMethodType === m.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-accent text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {authMethodType === "Password" && (
        <div>
          <label className={labelClass}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
          />
        </div>
      )}

      {authMethodType === "PrivateKey" && (
        <>
          <div>
            <label className={labelClass}>Private Key File</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={keyPath}
                onChange={(e) => setKeyPath(e.target.value)}
                placeholder="/path/to/id_rsa"
                required
                className={`${inputClass} flex-1`}
              />
              <button
                type="button"
                onClick={handleBrowseKey}
                className="px-3 py-2 rounded-lg border border-input hover:bg-accent transition-colors"
              >
                <Folder className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="passphrase-protected"
              checked={passphraseProtected}
              onChange={(e) => setPassphraseProtected(e.target.checked)}
              className="rounded border-input"
            />
            <label
              htmlFor="passphrase-protected"
              className="text-sm text-foreground"
            >
              Key has passphrase
            </label>
          </div>
          {passphraseProtected && (
            <div>
              <label className={labelClass}>Passphrase</label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="••••••••"
                className={inputClass}
              />
            </div>
          )}
        </>
      )}

      {authMethodType === "KeyboardInteractive" && (
        <div>
          <label className={labelClass}>One-Time Password / Code</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter OTP"
            className={inputClass}
          />
        </div>
      )}

      <div>
        <label className={labelClass}>Default Path (optional)</label>
        <input
          type="text"
          value={defaultPath}
          onChange={(e) => setDefaultPath(e.target.value)}
          placeholder="/home/user"
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
          disabled={!host || !username || isTesting}
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
