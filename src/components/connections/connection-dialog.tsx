import { useState } from "react";
import { X } from "lucide-react";
import { SftpForm } from "./sftp-form";
import { B2Form } from "./b2-form";
import type { ConnectionConfig, ProviderType } from "@/types/connection";

interface ConnectionDialogProps {
  isOpen: boolean;
  editConfig?: ConnectionConfig | null;
  onClose: () => void;
  onSave: (config: ConnectionConfig, secret?: string) => void;
}

export function ConnectionDialog({
  isOpen,
  editConfig,
  onClose,
  onSave,
}: ConnectionDialogProps) {
  const [providerType, setProviderType] = useState<ProviderType>(
    editConfig?.type ?? "Sftp"
  );

  if (!isOpen) return null;

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
            <div className="flex gap-2">
              <button
                onClick={() => setProviderType("Sftp")}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  providerType === "Sftp"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-accent"
                }`}
              >
                SFTP
              </button>
              <button
                onClick={() => setProviderType("BackblazeB2")}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  providerType === "BackblazeB2"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-accent"
                }`}
              >
                Backblaze B2
              </button>
            </div>
          </div>
        )}

        <div className="px-5 py-4">
          {providerType === "Sftp" ? (
            <SftpForm
              editConfig={editConfig?.type === "Sftp" ? editConfig : null}
              onSave={onSave}
              onCancel={onClose}
            />
          ) : (
            <B2Form
              editConfig={
                editConfig?.type === "BackblazeB2" ? editConfig : null
              }
              onSave={onSave}
              onCancel={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}
