"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────

interface QuantApp {
  id: string;
  name: string;
  description: string;
  href: string;
  icon: React.ReactNode;
}

interface AppConnection {
  appId: string;
  connected: boolean;
  shareData: boolean;
  lastActivity: string | null;
}

const QUANT_APPS: QuantApp[] = [
  {
    id: "quantmail",
    name: "Quantmail",
    description: "Biometric email gateway",
    href: "/mail",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
      </svg>
    ),
  },
  {
    id: "quantcal",
    name: "QuantCal",
    description: "AI-powered calendar",
    href: "/calendar",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </svg>
    ),
  },
  {
    id: "quantdrive",
    name: "QuantDrive",
    description: "Encrypted file storage",
    href: "/drive",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 6c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
      </svg>
    ),
  },
  {
    id: "quantdocs",
    name: "QuantDocs",
    description: "Collaborative documents",
    href: "/docs",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  },
  {
    id: "quantsheets",
    name: "QuantSheets",
    description: "AI spreadsheets",
    href: "/sheets",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h1.5m-1.5 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5" />
      </svg>
    ),
  },
  {
    id: "quantchat",
    name: "QuantChat",
    description: "Encrypted messaging",
    href: "/chat",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
      </svg>
    ),
  },
  {
    id: "quanttasks",
    name: "QuantTasks",
    description: "Smart task management",
    href: "/tasks",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: "quantnotes",
    name: "QuantNotes",
    description: "AI note-taking",
    href: "/notes",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
      </svg>
    ),
  },
  {
    id: "quantmeet",
    name: "QuantMeet",
    description: "Secure video conferencing",
    href: "/meet",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
  },
];

// ─── Helper ───────────────────────────────────────────────────────

function formatLastActivity(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return d.toLocaleDateString();
}

// ─── Component ────────────────────────────────────────────────────

interface ConnectedAppsProps {
  /** Bearer access token for API calls */
  accessToken?: string;
}

export function ConnectedApps({ accessToken }: ConnectedAppsProps) {
  const [connections, setConnections] = useState<Record<string, AppConnection>>({});
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialise all apps as connected (SSO means all apps share the same identity)
  useEffect(() => {
    const initial: Record<string, AppConnection> = {};
    for (const app of QUANT_APPS) {
      initial[app.id] = {
        appId: app.id,
        connected: true,
        shareData: true,
        lastActivity: null,
      };
    }
    setConnections(initial);
    setLoading(false);
  }, []);

  const toggleDataSharing = useCallback((appId: string) => {
    setConnections((prev) => ({
      ...prev,
      [appId]: {
        ...prev[appId]!,
        shareData: !prev[appId]?.shareData,
      },
    }));
  }, []);

  const revokeAccess = useCallback(
    async (appId: string) => {
      if (!accessToken) {
        setError("Authentication required to revoke access");
        return;
      }
      setRevoking(appId);
      setError(null);

      try {
        // In a full implementation, this would call a per-app revocation endpoint.
        // For now, we update local state to reflect the revocation.
        await new Promise<void>((resolve) => setTimeout(resolve, 400));
        setConnections((prev) => ({
          ...prev,
          [appId]: {
            ...prev[appId]!,
            connected: false,
            shareData: false,
            lastActivity: prev[appId]?.lastActivity ?? null,
          },
        }));
      } catch {
        setError(`Failed to revoke access for ${appId}`);
      } finally {
        setRevoking(null);
      }
    },
    [accessToken]
  );

  const reconnect = useCallback((appId: string) => {
    setConnections((prev) => ({
      ...prev,
      [appId]: {
        ...prev[appId]!,
        connected: true,
        shareData: true,
      },
    }));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading connected apps…
        </div>
      </div>
    );
  }

  const connectedCount = Object.values(connections).filter((c) => c.connected).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--text)" }}>
            Connected Apps
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            {connectedCount} of {QUANT_APPS.length} apps connected via Quantmail SSO
          </p>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="text-xs px-3 py-2 rounded-lg"
          style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          {error}
        </div>
      )}

      {/* App list */}
      <div className="space-y-2">
        {QUANT_APPS.map((app) => {
          const conn = connections[app.id];
          const isConnected = conn?.connected ?? false;
          const sharesData = conn?.shareData ?? false;
          const isRevoking = revoking === app.id;

          return (
            <div
              key={app.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors"
              style={{
                background: "var(--card-bg, rgba(255,255,255,0.03))",
                border: "1px solid var(--border, rgba(255,255,255,0.08))",
                opacity: isConnected ? 1 : 0.6,
              }}
            >
              {/* App icon */}
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  background: isConnected ? "rgba(99,102,241,0.15)" : "rgba(107,114,128,0.1)",
                  color: isConnected ? "#818cf8" : "var(--text-muted)",
                }}
              >
                {app.icon}
              </div>

              {/* App info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate" style={{ color: "var(--text)" }}>
                    {app.name}
                  </span>
                  {isConnected && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ background: "rgba(34,197,94,0.15)", color: "#4ade80" }}
                    >
                      Connected
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                    {app.description}
                  </span>
                  {conn?.lastActivity && (
                    <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
                      · {formatLastActivity(conn.lastActivity)}
                    </span>
                  )}
                </div>
              </div>

              {/* Controls */}
              {isConnected ? (
                <div className="flex items-center gap-2 shrink-0">
                  {/* Data sharing toggle */}
                  <button
                    onClick={() => toggleDataSharing(app.id)}
                    title={sharesData ? "Disable data sharing" : "Enable data sharing"}
                    className="relative w-8 h-4 rounded-full transition-colors focus:outline-none"
                    style={{
                      background: sharesData ? "#6366f1" : "rgba(107,114,128,0.3)",
                    }}
                    aria-pressed={sharesData}
                    aria-label={`${sharesData ? "Disable" : "Enable"} data sharing for ${app.name}`}
                  >
                    <span
                      className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform"
                      style={{
                        transform: sharesData ? "translateX(17px)" : "translateX(2px)",
                      }}
                    />
                  </button>

                  {/* Revoke button */}
                  <button
                    onClick={() => revokeAccess(app.id)}
                    disabled={isRevoking}
                    className="text-xs px-2 py-1 rounded-lg transition-colors focus:outline-none"
                    style={{
                      background: "rgba(239,68,68,0.1)",
                      color: "#f87171",
                      border: "1px solid rgba(239,68,68,0.15)",
                      opacity: isRevoking ? 0.5 : 1,
                      cursor: isRevoking ? "not-allowed" : "pointer",
                    }}
                    aria-label={`Revoke access for ${app.name}`}
                  >
                    {isRevoking ? "Revoking…" : "Revoke"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => reconnect(app.id)}
                  className="text-xs px-2 py-1 rounded-lg transition-colors shrink-0"
                  style={{
                    background: "rgba(99,102,241,0.1)",
                    color: "#818cf8",
                    border: "1px solid rgba(99,102,241,0.2)",
                  }}
                  aria-label={`Reconnect ${app.name}`}
                >
                  Reconnect
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
