import { useState, useEffect, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";
import type { ConnectionConfig, SavedConnection } from "@/types/connection";
import {
  connectToServer,
  disconnectFromServer,
  saveCredential,
  deleteCredential,
} from "@/services/connection-service";

const STORE_KEY = "connections";

export function useConnections() {
  const [savedConnections, setSavedConnections] = useState<SavedConnection[]>(
    []
  );
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(
    null
  );
  const [activeConfig, setActiveConfig] = useState<ConnectionConfig | null>(
    null
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load saved connections from store
  useEffect(() => {
    (async () => {
      try {
        const store = await load("connections.json", { defaults: {}, autoSave: true });
        const saved = await store.get<SavedConnection[]>(STORE_KEY);
        if (saved) {
          setSavedConnections(saved);
        }
      } catch (e) {
        console.error("Failed to load connections:", e);
      }
    })();
  }, []);

  // Persist connections to store
  const persistConnections = useCallback(
    async (connections: SavedConnection[]) => {
      try {
        const store = await load("connections.json", { defaults: {}, autoSave: true });
        await store.set(STORE_KEY, connections);
      } catch (e) {
        console.error("Failed to persist connections:", e);
      }
    },
    []
  );

  const addConnection = useCallback(
    async (config: ConnectionConfig, secret?: string) => {
      const saved: SavedConnection = {
        config,
        createdAt: Math.floor(Date.now() / 1000),
        sortOrder: savedConnections.length,
      };

      // Save secret to OS keyring if provided
      if (secret) {
        await saveCredential(config.id, "password", secret);
      }

      const updated = [...savedConnections, saved];
      setSavedConnections(updated);
      await persistConnections(updated);
    },
    [savedConnections, persistConnections]
  );

  const addConnections = useCallback(
    async (configs: ConnectionConfig[]) => {
      const now = Math.floor(Date.now() / 1000);
      const newEntries: SavedConnection[] = configs.map((config, i) => ({
        config,
        createdAt: now,
        sortOrder: savedConnections.length + i,
      }));
      const updated = [...savedConnections, ...newEntries];
      setSavedConnections(updated);
      await persistConnections(updated);
    },
    [savedConnections, persistConnections]
  );

  const updateConnection = useCallback(
    async (config: ConnectionConfig, secret?: string) => {
      if (secret) {
        await saveCredential(config.id, "password", secret);
      }

      const updated = savedConnections.map((c) =>
        c.config.id === config.id ? { ...c, config } : c
      );
      setSavedConnections(updated);
      await persistConnections(updated);
    },
    [savedConnections, persistConnections]
  );

  const removeConnection = useCallback(
    async (id: string) => {
      // Clean up credentials
      try {
        await deleteCredential(id, "password");
      } catch {
        // Ignore if no credential
      }

      // Disconnect if active
      if (activeConnectionId === id) {
        try {
          await disconnectFromServer(id);
        } catch {
          // Ignore
        }
        setActiveConnectionId(null);
        setActiveConfig(null);
      }

      const updated = savedConnections.filter((c) => c.config.id !== id);
      setSavedConnections(updated);
      await persistConnections(updated);
    },
    [savedConnections, activeConnectionId, persistConnections]
  );

  const connect = useCallback(
    async (config: ConnectionConfig, secret?: string) => {
      setIsConnecting(true);
      setError(null);
      try {
        // Disconnect current if any
        if (activeConnectionId) {
          try {
            await disconnectFromServer(activeConnectionId);
          } catch {
            // Ignore
          }
        }

        const id = await connectToServer(config, secret);
        setActiveConnectionId(id);
        setActiveConfig(config);

        // Update last_connected
        const updated = savedConnections.map((c) =>
          c.config.id === config.id
            ? { ...c, lastConnected: Math.floor(Date.now() / 1000) }
            : c
        );
        setSavedConnections(updated);
        await persistConnections(updated);

        return id;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setIsConnecting(false);
      }
    },
    [activeConnectionId, savedConnections, persistConnections]
  );

  const disconnect = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      await disconnectFromServer(activeConnectionId);
    } catch {
      // Ignore
    }
    setActiveConnectionId(null);
    setActiveConfig(null);
  }, [activeConnectionId]);

  return {
    savedConnections,
    activeConnectionId,
    activeConfig,
    isConnecting,
    error,
    addConnection,
    addConnections,
    updateConnection,
    removeConnection,
    connect,
    disconnect,
  };
}
