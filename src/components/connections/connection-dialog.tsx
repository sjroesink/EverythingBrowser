import { useState } from "react";
import { X } from "lucide-react";
import { SftpForm } from "./sftp-form";
import { B2Form } from "./b2-form";
import { DockerVolumeForm } from "./docker-volume-form";
import { DockerExecForm } from "./docker-exec-form";
import { LocalFsForm } from "./local-fs-form";
import type { ConnectionConfig, ProviderType } from "@/types/connection";

interface ConnectionDialogProps {
  isOpen: boolean;
  editConfig?: ConnectionConfig | null;
  onClose: () => void;
  onSave: (config: ConnectionConfig, secret?: string) => void;
}

const PROVIDER_OPTIONS: { value: ProviderType; label: string }[] = [
  { value: "LocalFs", label: "Local Folder" },
  { value: "Sftp", label: "SFTP" },
  { value: "BackblazeB2", label: "Backblaze B2" },
  { value: "DockerVolume", label: "Docker Volume" },
  { value: "DockerExec", label: "Docker Exec" },
];

export function ConnectionDialog({
  isOpen,
  editConfig,
  onClose,
  onSave,
}: ConnectionDialogProps) {
  const [providerType, setProviderType] = useState<ProviderType>(
    editConfig?.type ?? "LocalFs"
  );

  if (!isOpen) return null;

  const renderForm = () => {
    switch (providerType) {
      case "LocalFs":
        return (
          <LocalFsForm
            editConfig={editConfig?.type === "LocalFs" ? editConfig : null}
            onSave={onSave}
            onCancel={onClose}
          />
        );
      case "Sftp":
        return (
          <SftpForm
            editConfig={editConfig?.type === "Sftp" ? editConfig : null}
            onSave={onSave}
            onCancel={onClose}
          />
        );
      case "BackblazeB2":
        return (
          <B2Form
            editConfig={editConfig?.type === "BackblazeB2" ? editConfig : null}
            onSave={onSave}
            onCancel={onClose}
          />
        );
      case "DockerVolume":
        return (
          <DockerVolumeForm
            editConfig={editConfig?.type === "DockerVolume" ? editConfig : null}
            onSave={onSave}
            onCancel={onClose}
          />
        );
      case "DockerExec":
        return (
          <DockerExecForm
            editConfig={editConfig?.type === "DockerExec" ? editConfig : null}
            onSave={onSave}
            onCancel={onClose}
          />
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto m-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">
            {editConfig ? "Edit Connection" : "New Connection"}
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md inline-flex items-center justify-center hover:bg-foreground/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!editConfig && (
          <div className="px-5 pt-4">
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Protocol
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PROVIDER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setProviderType(opt.value)}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    providerType === opt.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-accent"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="px-5 py-4">{renderForm()}</div>
      </div>
    </div>
  );
}
