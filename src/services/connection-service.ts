import { invoke } from "@tauri-apps/api/core";
import type { ConnectionConfig } from "@/types/connection";

export async function connectToServer(
  config: ConnectionConfig,
  secret?: string
): Promise<string> {
  return invoke<string>("connect", { config, secret: secret ?? null });
}

export async function disconnectFromServer(
  connectionId: string
): Promise<void> {
  return invoke("disconnect", { connectionId });
}

export async function testConnection(
  config: ConnectionConfig,
  secret?: string
): Promise<boolean> {
  return invoke<boolean>("test_connection", { config, secret: secret ?? null });
}

export async function isConnected(connectionId: string): Promise<boolean> {
  return invoke<boolean>("is_connected", { connectionId });
}

export async function saveCredential(
  connectionId: string,
  credentialType: string,
  secret: string
): Promise<void> {
  return invoke("save_credential", { connectionId, credentialType, secret });
}

export async function deleteCredential(
  connectionId: string,
  credentialType: string
): Promise<void> {
  return invoke("delete_credential", { connectionId, credentialType });
}
