import { useState, useEffect, useCallback, useRef } from "react";
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
  const [activeConnectionIds, setActiveConnectionIds] = useState<Set<string>>(
    new Set()
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedConnectionsRef = useRef<SavedConnection[]>([]);

  useEffect(() => {
    savedConnectionsRef.current = savedConnections;
  }, [savedConnections]);

  // Load saved connections from store
  useEffect(() => {
    (async () => {
      try {
        const store = await load("connections.json", {
          defaults: {},
          autoSave: true,
        });
        const saved = await store.get<SavedConnection[]>(STORE_KEY);
        if (saved) {
          setSavedConnections(saved);
          savedConnectionsRef.current = saved;
        }
      } catch (e) {
        console.error("Failed to load connections:", e);
      } finally {
        setIsLoaded(true);
      }
    })();
  }, []);

  // Persist connections to store
  const persistConnections = useCallback(async (connections: SavedConnection[]) => {
    try {
      const store = await load("connections.json", { defaults: {}, autoSave: true });
      await store.set(STORE_KEY, connections);
    } catch (e) {
      console.error("Failed to persist connections:", e);
    }
  }, []);

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
      savedConnectionsRef.current = updated;
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
      savedConnectionsRef.current = updated;
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
      savedConnectionsRef.current = updated;
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
      if (activeConnectionIds.has(id)) {
        try {
          await disconnectFromServer(id);
        } catch {
          // Ignore
        }
        setActiveConnectionIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }

      const updated = savedConnections.filter((c) => c.config.id !== id);
      setSavedConnections(updated);
      savedConnectionsRef.current = updated;
      await persistConnections(updated);
    },
    [savedConnections, activeConnectionIds, persistConnections]
  );

  const connect = useCallback(
    async (config: ConnectionConfig, secret?: string) => {
      setIsConnecting(true);
      setError(null);
      try {
        const id = await connectToServer(config, secret);
        setActiveConnectionIds((prev) => new Set([...prev, id]));

        // Update lastConnected only when this connection exists in saved connections.
        // This avoids overwriting the store with [] when reconnecting tabs before load.
        const currentSaved = savedConnectionsRef.current;
        const hasSavedEntry = currentSaved.some((c) => c.config.id === config.id);
        if (hasSavedEntry) {
          const updated = currentSaved.map((c) =>
            c.config.id === config.id
              ? { ...c, lastConnected: Math.floor(Date.now() / 1000) }
              : c
          );
          setSavedConnections(updated);
          savedConnectionsRef.current = updated;
          await persistConnections(updated);
        }

        return id;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setIsConnecting(false);
      }
    },
    [persistConnections]
  );

  const disconnect = useCallback(async (connectionId: string) => {
    try {
      await disconnectFromServer(connectionId);
    } catch {
      // Ignore
    }
    setActiveConnectionIds((prev) => {
      const next = new Set(prev);
      next.delete(connectionId);
      return next;
    });
  }, []);

  return {
    savedConnections,
    activeConnectionIds,
    isConnecting,
    isLoaded,
    error,
    addConnection,
    addConnections,
    updateConnection,
    removeConnection,
    connect,
    disconnect,
  };
}
