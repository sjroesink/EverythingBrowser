import { useState, useEffect, useRef } from "react";
import { Loader2, CheckCircle2, XCircle, ChevronDown } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { DockerVolumeConfig } from "@/types/connection";
import { testConnection } from "@/services/connection-service";

interface DockerVolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
}

interface DockerVolumeFormProps {
  editConfig: DockerVolumeConfig | null;
  onSave: (config: DockerVolumeConfig) => void;
  onCancel: () => void;
}

export function DockerVolumeForm({ editConfig, onSave, onCancel }: DockerVolumeFormProps) {
  const [name, setName] = useState(editConfig?.name ?? "");
  const [volumeName, setVolumeName] = useState(editConfig?.volumeName ?? "");
  const [image, setImage] = useState(editConfig?.image ?? "");
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const [volumes, setVolumes] = useState<DockerVolumeInfo[]>([]);
  const [volumesLoading, setVolumesLoading] = useState(false);
  const [volumesError, setVolumesError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVolumesLoading(true);
    invoke<DockerVolumeInfo[]>("list_docker_volumes")
      .then((v) => {
        setVolumes(v);
        setVolumesError(null);
      })
      .catch((e) => {
        setVolumesError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setVolumesLoading(false));
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  const filteredVolumes = volumeName
    ? volumes.filter((v) => v.name.toLowerCase().includes(volumeName.toLowerCase()))
    : volumes;

  const buildConfig = (): DockerVolumeConfig => ({
    type: "DockerVolume",
    id: editConfig?.id ?? crypto.randomUUID(),
    name: name || volumeName,
    volumeName,
    image: image || undefined,
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
          placeholder="My Docker Volume"
          className={inputClass}
        />
      </div>

      <div ref={dropdownRef} className="relative">
        <label className={labelClass}>Volume Name</label>
        <div className="relative">
          <input
            type="text"
            value={volumeName}
            onChange={(e) => {
              setVolumeName(e.target.value);
              setDropdownOpen(true);
            }}
            onFocus={() => setDropdownOpen(true)}
            placeholder={volumesLoading ? "Loading volumes..." : "Type or select a volume"}
            required
            className={`${inputClass} pr-8`}
          />
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
        {dropdownOpen && filteredVolumes.length > 0 && (
          <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-popover border border-border rounded-lg shadow-lg py-1">
            {filteredVolumes.map((v) => (
              <button
                key={v.name}
                type="button"
                onClick={() => {
                  setVolumeName(v.name);
                  if (!name) setName(v.name);
                  setDropdownOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors ${
                  v.name === volumeName ? "bg-primary/10 text-primary" : ""
                }`}
              >
                <div className="font-medium">{v.name}</div>
                <div className="text-xs text-muted-foreground truncate">{v.driver} &middot; {v.mountpoint}</div>
              </button>
            ))}
          </div>
        )}
        {dropdownOpen && !volumesLoading && filteredVolumes.length === 0 && volumes.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg py-2 px-3 text-sm text-muted-foreground">
            No matching volumes
          </div>
        )}
        {volumesError && (
          <p className="text-xs text-destructive mt-1">{volumesError}</p>
        )}
      </div>

      <div>
        <label className={labelClass}>Image (optional)</label>
        <input
          type="text"
          value={image}
          onChange={(e) => setImage(e.target.value)}
          placeholder="alpine:latest"
          className={inputClass}
        />
        <p className="text-xs text-muted-foreground mt-1">
          Helper image to mount the volume. Defaults to alpine:latest.
        </p>
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
          disabled={!volumeName || isTesting}
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
