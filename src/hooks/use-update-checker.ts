import { useState, useEffect, useCallback, useRef } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useSettingsStore } from "@/stores/use-settings-store";

export interface UpdateState {
  available: boolean;
  version: string | null;
  body: string | null;
  downloading: boolean;
  progress: number;
  readyToRestart: boolean;
  dismissed: boolean;
  error: string | null;
  checkForUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  dismiss: () => void;
}

const CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

export function useUpdateChecker(): UpdateState {
  const autoUpdate = useSettingsStore((s) => s.autoUpdate);
  const [available, setAvailable] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [readyToRestart, setReadyToRestart] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);

  const checkForUpdate = useCallback(async () => {
    try {
      setError(null);
      const update = await check();
      if (update) {
        updateRef.current = update;
        setVersion(update.version);
        setBody(update.body ?? null);
        setAvailable(true);
        setDismissed(false);
      }
    } catch (e) {
      console.warn("Update check failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    try {
      setDownloading(true);
      setProgress(0);
      setError(null);

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setProgress(Math.round((downloaded / contentLength) * 100));
            }
            break;
          case "Finished":
            setProgress(100);
            break;
        }
      });

      setDownloading(false);
      setReadyToRestart(true);
    } catch (e) {
      setDownloading(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  // Check on mount + every 4 hours
  useEffect(() => {
    // Delay initial check by 5 seconds to not block startup
    const timeout = setTimeout(() => {
      void checkForUpdate();
    }, 5000);

    const interval = setInterval(() => {
      void checkForUpdate();
    }, CHECK_INTERVAL);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  // Auto-install update when enabled in settings
  useEffect(() => {
    if (available && autoUpdate && !downloading && !readyToRestart) {
      void (async () => {
        await installUpdate();
        await relaunch();
      })();
    }
  }, [available, autoUpdate, downloading, readyToRestart, installUpdate]);

  return {
    available,
    version,
    body,
    downloading,
    progress,
    readyToRestart,
    dismissed,
    error,
    checkForUpdate,
    installUpdate,
    dismiss,
  };
}
