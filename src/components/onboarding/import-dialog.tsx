import { useState, useEffect, useCallback } from "react";
import { Check, X, Loader2 } from "lucide-react";
import type { ConnectionConfig } from "@/types/connection";
import {
  detectImportSources,
  getImportableSessions,
  importSessions,
  type ImportSource,
  type ImportableSession,
} from "@/services/import-service";

interface ImportDialogProps {
  isOpen: boolean;
  isOnboarding?: boolean;
  onClose: () => void;
  onImport: (configs: ConnectionConfig[]) => void;
}

export function ImportDialog({
  isOpen,
  isOnboarding = false,
  onClose,
  onImport,
}: ImportDialogProps) {
  const [sources, setSources] = useState<ImportSource[]>([]);
  const [isDetecting, setIsDetecting] = useState(true);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ImportableSession[]>([]);
  const [selectedSessions, setSelectedSessions] = useState<Set<number>>(
    new Set()
  );
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setIsDetecting(true);
    setSources([]);
    setActiveSourceId(null);
    setSessions([]);
    setSelectedSessions(new Set());
    setImportedCount(0);
    setShowDone(false);

    detectImportSources()
      .then((s) => {
        setSources(s);
        if (s.length > 0) {
          loadSessionsForSource(s[0].id);
        }
      })
      .catch(() => setSources([]))
      .finally(() => setIsDetecting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const loadSessionsForSource = useCallback(async (sourceId: string) => {
    setActiveSourceId(sourceId);
    setIsLoadingSessions(true);
    setSessions([]);
    setSelectedSessions(new Set());
    try {
      const result = await getImportableSessions(sourceId);
      setSessions(result);
      setSelectedSessions(new Set(result.map((_, i) => i)));
    } catch {
      setSessions([]);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  const toggleSession = useCallback((index: number) => {
    setSelectedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedSessions((prev) => {
      if (prev.size === sessions.length) {
        return new Set();
      }
      return new Set(sessions.map((_, i) => i));
    });
  }, [sessions]);

  const handleImport = useCallback(async () => {
    const toImport = sessions.filter((_, i) => selectedSessions.has(i));
    if (toImport.length === 0) return;

    setIsImporting(true);
    try {
      const configs = await importSessions(toImport);
      setImportedCount((prev) => prev + configs.length);
      onImport(configs);
      setShowDone(true);
    } catch {
      // stay on current view
    } finally {
      setIsImporting(false);
    }
  }, [sessions, selectedSessions, onImport]);

  const handleImportMore = useCallback(() => {
    setShowDone(false);
    // Reload sources to refresh counts
    detectImportSources()
      .then((s) => {
        setSources(s);
        if (s.length > 0) {
          const sourceToLoad =
            s.find((src) => src.id === activeSourceId) ?? s[0];
          loadSessionsForSource(sourceToLoad.id);
        }
      })
      .catch(() => setSources([]));
  }, [activeSourceId, loadSessionsForSource]);

  if (!isOpen) return null;

  if (showDone) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
        <div className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-sm m-4">
          <div className="px-5 py-8 text-center">
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-3">
              <Check className="w-6 h-6 text-green-500" />
            </div>
            <h3 className="text-sm font-medium mb-1">
              Successfully imported {importedCount} connection
              {importedCount !== 1 ? "s" : ""}
            </h3>
            <p className="text-xs text-muted-foreground mb-5">
              Your connections are ready in the sidebar.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={handleImportMore}
                className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent transition-colors"
              >
                Import More
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-xl m-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">
            {isOnboarding ? "Welcome to EverythingBrowser" : "Import Sessions"}
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md inline-flex items-center justify-center hover:bg-foreground/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isOnboarding && (
          <div className="px-5 pt-3">
            <p className="text-sm text-muted-foreground">
              Import saved sessions from other applications.
            </p>
          </div>
        )}

        {/* Content */}
        {isDetecting ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Scanning for sessions...
            </span>
          </div>
        ) : sources.length === 0 ? (
          <div className="py-10 text-center px-5">
            <p className="text-sm text-muted-foreground mb-4">
              No importable sessions found.
              {isOnboarding &&
                " You can add connections manually from the sidebar."}
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              {isOnboarding ? "Get Started" : "Close"}
            </button>
          </div>
        ) : (
          <div className="flex min-h-[320px]">
            {/* Sources column */}
            <div className="w-44 shrink-0 border-r border-border py-2">
              {sources.map((source) => (
                <button
                  key={source.id}
                  onClick={() => loadSessionsForSource(source.id)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                    activeSourceId === source.id
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  <SourceIcon sourceId={source.id} size={20} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {source.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {source.sessionCount} session
                      {source.sessionCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Sessions column */}
            <div className="flex-1 flex flex-col min-w-0">
              {isLoadingSessions ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">
                    Loading sessions...
                  </span>
                </div>
              ) : sessions.length === 0 ? (
                <div className="flex-1 flex items-center justify-center px-4">
                  <p className="text-sm text-muted-foreground text-center">
                    No sessions could be read from this source.
                  </p>
                </div>
              ) : (
                <>
                  {/* Select toolbar */}
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                    <button
                      onClick={toggleAll}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {selectedSessions.size === sessions.length
                        ? "Deselect all"
                        : "Select all"}
                    </button>
                    <span className="text-xs text-muted-foreground">
                      {selectedSessions.size} of {sessions.length}
                    </span>
                  </div>

                  {/* Session list */}
                  <div className="flex-1 overflow-y-auto">
                    {sessions.map((session, index) => {
                      const isSelected = selectedSessions.has(index);
                      return (
                        <button
                          key={index}
                          onClick={() => toggleSession(index)}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors border-b border-border last:border-b-0 ${
                            isSelected ? "bg-primary/5" : "hover:bg-accent"
                          }`}
                        >
                          <div
                            className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                              isSelected
                                ? "bg-primary border-primary"
                                : "border-border"
                            }`}
                          >
                            {isSelected && (
                              <Check className="w-3 h-3 text-primary-foreground" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">
                              {session.name}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {session.username
                                ? `${session.username}@`
                                : ""}
                              {session.host}:{session.port}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Import button */}
                  <div className="px-3 py-3 border-t border-border flex justify-end">
                    <button
                      onClick={handleImport}
                      disabled={selectedSessions.size === 0 || isImporting}
                      className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
                    >
                      {isImporting && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      )}
                      Import {selectedSessions.size} Session
                      {selectedSessions.size !== 1 ? "s" : ""}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SourceIcon({
  sourceId,
  size = 20,
}: {
  sourceId: string;
  size?: number;
}) {
  if (sourceId === "putty") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="flex-shrink-0"
      >
        {/* Terminal/console icon representing PuTTY */}
        <rect
          x="2"
          y="3"
          width="20"
          height="18"
          rx="2"
          className="stroke-current"
          strokeWidth="1.5"
          fill="none"
        />
        <rect
          x="2"
          y="3"
          width="20"
          height="4"
          rx="2"
          className="fill-blue-500/20 stroke-blue-500"
          strokeWidth="1.5"
        />
        <circle cx="5" cy="5" r="0.75" className="fill-blue-500" />
        <circle cx="7.5" cy="5" r="0.75" className="fill-blue-500" />
        <circle cx="10" cy="5" r="0.75" className="fill-blue-500" />
        <path
          d="M6 12l3 2-3 2"
          className="stroke-current"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M12 16h4"
          className="stroke-current"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (sourceId === "winscp") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="flex-shrink-0"
      >
        {/* File transfer icon representing WinSCP */}
        <rect
          x="2"
          y="4"
          width="8"
          height="10"
          rx="1.5"
          className="stroke-current"
          strokeWidth="1.5"
          fill="none"
        />
        <path d="M4 4v-0.5a1 1 0 011-1h2a1 1 0 011 1V4" className="stroke-current" strokeWidth="1.5" />
        <path d="M4.5 7.5h3M4.5 9.5h2" className="stroke-current" strokeWidth="1" strokeLinecap="round" />
        <rect
          x="14"
          y="10"
          width="8"
          height="10"
          rx="1.5"
          className="stroke-amber-500"
          strokeWidth="1.5"
          fill="none"
        />
        <path d="M16 10v-0.5a1 1 0 011-1h2a1 1 0 011 1V10" className="stroke-amber-500" strokeWidth="1.5" />
        <path d="M16.5 13.5h3M16.5 15.5h2" className="stroke-amber-500" strokeWidth="1" strokeLinecap="round" />
        <path
          d="M10 9h1.5l2 2-2 2H10"
          className="stroke-green-500"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    );
  }

  // Fallback generic icon
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="flex-shrink-0 stroke-current"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
