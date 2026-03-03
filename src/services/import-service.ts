import { invoke } from "@tauri-apps/api/core";
import type { ConnectionConfig } from "@/types/connection";

export interface ImportSource {
  id: string;
  name: string;
  sessionCount: number;
}

export interface ImportableSession {
  source: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: { method: string; keyPath?: string; passphraseProtected?: boolean };
  defaultPath?: string;
}

export async function detectImportSources(): Promise<ImportSource[]> {
  return invoke<ImportSource[]>("detect_import_sources");
}

export async function getImportableSessions(
  sourceId: string
): Promise<ImportableSession[]> {
  return invoke<ImportableSession[]>("get_importable_sessions", {
    sourceId,
  });
}

export async function importSessions(
  sessions: ImportableSession[]
): Promise<ConnectionConfig[]> {
  return invoke<ConnectionConfig[]>("import_sessions", { sessions });
}
