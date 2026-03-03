import { useEffect, useMemo, useState } from "react";
import {
  getFileInfo,
  listOwnershipOptions,
  setFileProperties,
} from "@/services/file-service";
import type {
  FilePropertyUpdate,
  FileInfo,
  OwnershipOption,
  OwnershipOptions,
  ProviderCapabilities,
} from "@/types/filesystem";
import { formatBytes, formatDate } from "@/lib/utils";

interface PropertiesDialogProps {
  connectionId: string;
  path: string | null;
  capabilities: ProviderCapabilities | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function parsePermissionBits(value?: string): number {
  if (!value) return 0;
  const octal = value.replace(/[^0-7]/g, "");
  if (!octal) return 0;
  const parsed = Number.parseInt(octal, 8);
  if (Number.isNaN(parsed)) return 0;
  return parsed & 0o7777;
}

function hasBit(value: number, bit: number): boolean {
  return (value & bit) === bit;
}

function toggleBit(value: number, bit: number, enabled: boolean): number {
  if (enabled) {
    return value | bit;
  }
  return value & ~bit;
}

function parsePrincipalId(value?: string): number | null {
  if (!value) return null;
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

function mergeCurrentOption(
  options: OwnershipOption[],
  selectedId: number | null,
  labelPrefix: string
): OwnershipOption[] {
  if (selectedId === null || options.some((o) => o.id === selectedId)) {
    return options;
  }
  return [{ id: selectedId, name: `${labelPrefix} ${selectedId}` }, ...options];
}

export function PropertiesDialog({
  connectionId,
  path,
  capabilities,
  isOpen,
  onClose,
  onSaved,
}: PropertiesDialogProps) {
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [ownership, setOwnership] = useState<OwnershipOptions | null>(null);
  const [permissions, setPermissions] = useState(0);
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [originalPermissions, setOriginalPermissions] = useState<number | null>(
    null
  );
  const [originalOwnerId, setOriginalOwnerId] = useState<number | null>(null);
  const [originalGroupId, setOriginalGroupId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !path || !capabilities?.fileProperties) {
      return;
    }

    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const fileInfo = await getFileInfo(connectionId, path);
        if (cancelled) return;
        setInfo(fileInfo);
        const parsedPermissions = parsePermissionBits(fileInfo.permissions);
        const parsedOwnerId = parsePrincipalId(fileInfo.owner);
        const parsedGroupId = parsePrincipalId(fileInfo.group);
        setPermissions(parsedPermissions);
        setOwnerId(parsedOwnerId);
        setGroupId(parsedGroupId);
        setOriginalPermissions(
          fileInfo.permissions !== undefined ? parsedPermissions : null
        );
        setOriginalOwnerId(parsedOwnerId);
        setOriginalGroupId(parsedGroupId);

        if (capabilities.listOwnershipOptions) {
          try {
            const available = await listOwnershipOptions(connectionId);
            if (!cancelled) {
              setOwnership(available);
            }
          } catch {
            if (!cancelled) {
              setOwnership({ owners: [], groups: [] });
            }
          }
        } else {
          setOwnership({ owners: [], groups: [] });
        }
      } catch (e) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : String(e);
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, path, capabilities, connectionId]);

  const ownerOptions = useMemo(
    () => mergeCurrentOption(ownership?.owners ?? [], ownerId, "UID"),
    [ownership, ownerId]
  );
  const groupOptions = useMemo(
    () => mergeCurrentOption(ownership?.groups ?? [], groupId, "GID"),
    [ownership, groupId]
  );

  if (!isOpen || !path || !capabilities?.fileProperties) {
    return null;
  }

  const canEditPermissions = Boolean(capabilities.setPermissions);
  const canEditOwnership = Boolean(capabilities.setOwnerGroup);
  const octal = permissions.toString(8).padStart(4, "0");

  const handleSave = async () => {
    if (!path) return;

    setIsSaving(true);
    setError(null);
    try {
      const update: FilePropertyUpdate = {};

      if (
        canEditPermissions &&
        originalPermissions !== null &&
        permissions !== originalPermissions
      ) {
        update.permissions = permissions;
      }

      if (canEditOwnership && ownerId !== originalOwnerId && ownerId !== null) {
        update.ownerId = ownerId;
      }

      if (canEditOwnership && groupId !== originalGroupId && groupId !== null) {
        update.groupId = groupId;
      }

      if (Object.keys(update).length > 0) {
        await setFileProperties(connectionId, path, update);
      }
      onSaved();
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose}>
      <div
        className="absolute left-1/2 top-1/2 w-[560px] max-w-[95vw] max-h-[90vh] overflow-auto -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-popover shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Properties</h2>
        </div>

        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading...</div>
        ) : error ? (
          <div className="p-4 text-sm text-destructive">{error}</div>
        ) : info ? (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-[120px_1fr] gap-y-2 gap-x-3 text-sm">
              <span className="text-muted-foreground">Name</span>
              <span className="break-all">{info.name}</span>
              <span className="text-muted-foreground">Location</span>
              <span className="break-all">{info.path}</span>
              <span className="text-muted-foreground">Size</span>
              <span>{info.isDir ? "Folder" : formatBytes(info.size)}</span>
              <span className="text-muted-foreground">Modified</span>
              <span>{formatDate(info.modified)}</span>
            </div>

            <div className="grid grid-cols-[120px_1fr] gap-y-2 gap-x-3 items-center text-sm">
              <span className="text-muted-foreground">Owner</span>
              <select
                disabled={!canEditOwnership}
                value={ownerId ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  setOwnerId(value ? Number.parseInt(value, 10) : null);
                }}
                className="h-8 px-2 rounded-md border border-input bg-background disabled:opacity-60"
              >
                <option value="">Unknown</option>
                {ownerOptions.map((owner) => (
                  <option key={`owner-${owner.id}-${owner.name}`} value={owner.id}>
                    {owner.name} ({owner.id})
                  </option>
                ))}
              </select>

              <span className="text-muted-foreground">Group</span>
              <select
                disabled={!canEditOwnership}
                value={groupId ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  setGroupId(value ? Number.parseInt(value, 10) : null);
                }}
                className="h-8 px-2 rounded-md border border-input bg-background disabled:opacity-60"
              >
                <option value="">Unknown</option>
                {groupOptions.map((group) => (
                  <option key={`group-${group.id}-${group.name}`} value={group.id}>
                    {group.name} ({group.id})
                  </option>
                ))}
              </select>
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-sm font-medium mb-2">Permissions</p>

              <div className="grid grid-cols-[120px_repeat(3,minmax(0,1fr))] gap-y-2 gap-x-2 text-sm items-center">
                <span className="text-muted-foreground">Owner</span>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    disabled={!canEditPermissions}
                    checked={hasBit(permissions, 0o400)}
                    onChange={(e) =>
                      setPermissions((prev) =>
                        toggleBit(prev, 0o400, e.target.checked)
                      )
                    }
                  />
                  R
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    disabled={!canEditPermissions}
                    checked={hasBit(permissions, 0o200)}
                    onChange={(e) =>
                      setPermissions((prev) =>
                        toggleBit(prev, 0o200, e.target.checked)
                      )
                    }
                  />
                  W
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    disabled={!canEditPermissions}
                    checked={hasBit(permissions, 0o100)}
                    onChange={(e) =>
                      setPermissions((prev) =>
                        toggleBit(prev, 0o100, e.target.checked)
                      )
                    }
                  />
                  X
                </label>

                <span className="text-muted-foreground">Group</span>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    disabled={!canEditPermissions}
                    checked={hasBit(permissions, 0o040)}
                    onChange={(e) =>
                      setPermissions((prev) =>
                        toggleBit(prev, 0o040, e.target.checked)
                      )
                    }
                  />
                  R
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    disabled={!canEditPermissions}
                    checked={hasBit(permissions, 0o020)}
                    onChange={(e) =>
                      setPermissions((prev) =>
                        toggleBit(prev, 0o020, e.target.checked)
                      )
                    }
                  />
                  W
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    disabled={!canEditPermissions}
                    checked={hasBit(permissions, 0o010)}
                    onChange={(e) =>
                      setPermissions((prev) =>
                        toggleBit(prev, 0o010, e.target.checked)
                      )
                    }
                  />
                  X
                </label>

                <span className="text-muted-foreground">Others</span>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    disabled={!canEditPermissions}
                    checked={hasBit(permissions, 0o004)}
                    onChange={(e) =>
                      setPermissions((prev) =>
                        toggleBit(prev, 0o004, e.target.checked)
                      )
                    }
                  />
                  R
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    disabled={!canEditPermissions}
                    checked={hasBit(permissions, 0o002)}
                    onChange={(e) =>
                      setPermissions((prev) =>
                        toggleBit(prev, 0o002, e.target.checked)
                      )
                    }
                  />
                  W
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    disabled={!canEditPermissions}
                    checked={hasBit(permissions, 0o001)}
                    onChange={(e) =>
                      setPermissions((prev) =>
                        toggleBit(prev, 0o001, e.target.checked)
                      )
                    }
                  />
                  X
                </label>

                <span className="text-muted-foreground">Special</span>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    disabled={!canEditPermissions}
                    checked={hasBit(permissions, 0o4000)}
                    onChange={(e) =>
                      setPermissions((prev) =>
                        toggleBit(prev, 0o4000, e.target.checked)
                      )
                    }
                  />
                  Set UID
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    disabled={!canEditPermissions}
                    checked={hasBit(permissions, 0o2000)}
                    onChange={(e) =>
                      setPermissions((prev) =>
                        toggleBit(prev, 0o2000, e.target.checked)
                      )
                    }
                  />
                  Set GID
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    disabled={!canEditPermissions}
                    checked={hasBit(permissions, 0o1000)}
                    onChange={(e) =>
                      setPermissions((prev) =>
                        toggleBit(prev, 0o1000, e.target.checked)
                      )
                    }
                  />
                  Sticky
                </label>
              </div>

              <div className="grid grid-cols-[120px_1fr] gap-x-3 items-center mt-3 text-sm">
                <span className="text-muted-foreground">Octal</span>
                <input
                  value={octal}
                  disabled={!canEditPermissions}
                  onChange={(e) => {
                    const sanitized = e.target.value.replace(/[^0-7]/g, "").slice(-4);
                    if (!sanitized) {
                      setPermissions(0);
                      return;
                    }
                    const parsed = Number.parseInt(sanitized, 8);
                    if (!Number.isNaN(parsed)) {
                      setPermissions(parsed & 0o7777);
                    }
                  }}
                  className="h-8 w-28 px-2 rounded-md border border-input bg-background font-mono disabled:opacity-60"
                />
              </div>
            </div>
          </div>
        ) : null}

        <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md hover:bg-accent"
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading || isSaving}
            className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
