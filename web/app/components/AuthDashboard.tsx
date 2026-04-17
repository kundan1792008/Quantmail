"use client";

/**
 * AuthDashboard
 *
 * Real-time behavioral biometrics confidence dashboard.
 *
 * Displays:
 *   - Composite "Identity Strength" confidence meter (green / yellow / red)
 *   - Per-signal breakdown (Typing, Mouse, Device)
 *   - Alert history showing detected anomalies
 *   - Enrolled device list with per-device confidence
 *   - Session lock / soft re-auth warning banners
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SignalScores {
  typing: number;
  mouse: number;
  device: number;
}

interface ConfidenceResponse {
  userId: string;
  confidence: number;
  signals: SignalScores;
  locked: boolean;
  softReauthRequired: boolean;
  lastUpdatedAt: string;
}

interface EnrolledDevice {
  deviceId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  platform: "mobile" | "desktop";
  enrolledConfidence: number;
}

interface AuditEvent {
  id: string;
  eventType: string;
  details: string;
  occurredAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps a [0,1] confidence value to a Tailwind colour class.
 */
function confidenceColor(value: number): string {
  if (value >= 0.7) return "text-emerald-400";
  if (value >= 0.3) return "text-amber-400";
  return "text-red-500";
}

function confidenceBg(value: number): string {
  if (value >= 0.7) return "bg-emerald-500";
  if (value >= 0.3) return "bg-amber-500";
  return "bg-red-500";
}

function confidenceLabel(value: number): string {
  if (value >= 0.85) return "Strong";
  if (value >= 0.7) return "Good";
  if (value >= 0.5) return "Weak";
  if (value >= 0.3) return "At Risk";
  return "Critical";
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1_000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatEventType(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ConfidenceMeterProps {
  label: string;
  value: number;
  description?: string;
}

function ConfidenceMeter({ label, value, description }: ConfidenceMeterProps) {
  const pct = Math.round(value * 100);
  const bgClass = confidenceBg(value);
  const textClass = confidenceColor(value);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-300">{label}</span>
        <span className={`text-sm font-bold tabular-nums ${textClass}`}>
          {pct}%
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-zinc-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${bgClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {description && (
        <p className="text-xs text-zinc-500">{description}</p>
      )}
    </div>
  );
}

interface StatusBannerProps {
  locked: boolean;
  softReauthRequired: boolean;
  onClearLock: () => void;
}

function StatusBanner({ locked, softReauthRequired, onClearLock }: StatusBannerProps) {
  if (!locked && !softReauthRequired) return null;

  if (locked) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-red-600 bg-red-950/40 p-4">
        <span className="mt-0.5 text-red-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </span>
        <div className="flex-1">
          <p className="font-semibold text-red-400">Session Locked</p>
          <p className="mt-0.5 text-sm text-red-300">
            Identity confidence dropped critically low. Full biometric
            re-authentication is required.
          </p>
        </div>
        <button
          onClick={onClearLock}
          className="shrink-0 rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 transition-colors"
        >
          Re-authenticate
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-600 bg-amber-950/40 p-4">
      <span className="mt-0.5 text-amber-400">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </span>
      <div className="flex-1">
        <p className="font-semibold text-amber-400">Verification Required</p>
        <p className="mt-0.5 text-sm text-amber-300">
          Behavioral patterns have been inconsistent. Please complete a quick
          face scan to confirm your identity.
        </p>
      </div>
      <button
        onClick={onClearLock}
        className="shrink-0 rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 transition-colors"
      >
        Verify Now
      </button>
    </div>
  );
}

interface DeviceCardProps {
  device: EnrolledDevice;
}

function DeviceCard({ device }: DeviceCardProps) {
  const pct = Math.round(device.enrolledConfidence * 100);
  const textClass = confidenceColor(device.enrolledConfidence);

  return (
    <div className="flex items-center gap-3 rounded-lg bg-zinc-800/60 px-4 py-3 border border-zinc-700/50">
      <span className="text-zinc-400">
        {device.platform === "mobile" ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18h3" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
          </svg>
        )}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-200 truncate capitalize">
          {device.platform} Device
        </p>
        <p className="text-xs text-zinc-500 truncate font-mono">
          {device.deviceId.slice(0, 16)}…
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className={`text-sm font-bold tabular-nums ${textClass}`}>{pct}%</p>
        <p className="text-xs text-zinc-500">{formatRelativeTime(device.lastSeenAt)}</p>
      </div>
    </div>
  );
}

interface AuditEventRowProps {
  event: AuditEvent;
}

function AuditEventRow({ event }: AuditEventRowProps) {
  const isLock = event.eventType.includes("LOCK") || event.eventType.includes("LOCKED");
  const isAnomaly = event.eventType.includes("ANOMALY");

  const iconClass = isLock
    ? "text-red-400"
    : isAnomaly
    ? "text-amber-400"
    : "text-zinc-500";

  return (
    <div className="flex items-start gap-3 py-3 border-b border-zinc-800/60 last:border-0">
      <span className={`mt-0.5 shrink-0 ${iconClass}`}>
        {isLock ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        )}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-300">{formatEventType(event.eventType)}</p>
        <p className="text-xs text-zinc-600 truncate">{formatRelativeTime(event.occurredAt)}</p>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000;
const API_BASE = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

export default function AuthDashboard() {
  const [confidence, setConfidence] = useState<ConfidenceResponse | null>(null);
  const [devices, setDevices] = useState<EnrolledDevice[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getToken = useCallback((): string | null => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("quantmail_access_token");
  }, []);

  const fetchConfidence = useCallback(async () => {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/behavioral/confidence`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ConfidenceResponse;
      setConfidence(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch confidence");
    }
  }, [getToken]);

  const fetchDevices = useCallback(async () => {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/behavioral/devices`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { devices: EnrolledDevice[] };
      setDevices(data.devices);
    } catch {
      // Non-critical – keep existing devices
    }
  }, [getToken]);

  const fetchAuditLog = useCallback(async () => {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/behavioral/audit?limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { events: AuditEvent[] };
      setAuditLog(data.events);
    } catch {
      // Non-critical
    }
  }, [getToken]);

  const handleClearLock = useCallback(async () => {
    const token = getToken();
    if (!token) return;

    try {
      await fetch(`${API_BASE}/behavioral/clear`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchConfidence();
    } catch {
      // handled by next poll
    }
  }, [getToken, fetchConfidence]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchConfidence(), fetchDevices(), fetchAuditLog()]);
      setLoading(false);
    };
    void init();

    pollRef.current = setInterval(() => {
      void fetchConfidence();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchConfidence, fetchDevices, fetchAuditLog]);

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-500 text-sm">
        <span className="animate-pulse">Loading identity data…</span>
      </div>
    );
  }

  if (error && !confidence) {
    return (
      <div className="rounded-lg border border-red-700 bg-red-950/40 p-4 text-sm text-red-400">
        Unable to load identity confidence: {error}
      </div>
    );
  }

  const compositeConfidence = confidence?.confidence ?? 0.8;
  const compositePct = Math.round(compositeConfidence * 100);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl mx-auto">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Identity Dashboard</h1>
          <p className="text-sm text-zinc-500">
            Continuous behavioral authentication
          </p>
        </div>
        {confidence?.lastUpdatedAt && (
          <p className="text-xs text-zinc-600">
            Updated {formatRelativeTime(confidence.lastUpdatedAt)}
          </p>
        )}
      </div>

      {/* ── Status banners ────────────────────────────────────────── */}
      {confidence && (
        <StatusBanner
          locked={confidence.locked}
          softReauthRequired={confidence.softReauthRequired}
          onClearLock={handleClearLock}
        />
      )}

      {/* ── Composite confidence ──────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/70 p-5 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-zinc-200">Identity Strength</h2>
          <span
            className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
              compositeConfidence >= 0.7
                ? "border-emerald-700 bg-emerald-950/60 text-emerald-400"
                : compositeConfidence >= 0.3
                ? "border-amber-700 bg-amber-950/60 text-amber-400"
                : "border-red-700 bg-red-950/60 text-red-400"
            }`}
          >
            {confidenceLabel(compositeConfidence)}
          </span>
        </div>

        {/* Big dial-style indicator */}
        <div className="flex items-center gap-6 mb-4">
          <div className="relative w-24 h-24 shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle
                cx="50" cy="50" r="40"
                fill="none"
                stroke="#27272a"
                strokeWidth="12"
              />
              <circle
                cx="50" cy="50" r="40"
                fill="none"
                stroke={
                  compositeConfidence >= 0.7
                    ? "#10b981"
                    : compositeConfidence >= 0.3
                    ? "#f59e0b"
                    : "#ef4444"
                }
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={`${compositeConfidence * 251.2} 251.2`}
                className="transition-all duration-700 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className={`text-xl font-bold tabular-nums leading-none ${confidenceColor(compositeConfidence)}`}
              >
                {compositePct}
              </span>
              <span className="text-xs text-zinc-500 leading-none mt-0.5">%</span>
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-2">
            <p className="text-sm text-zinc-400">
              Based on your typing rhythm, mouse movement patterns, and device
              fingerprint, your current identity confidence is{" "}
              <span className={`font-semibold ${confidenceColor(compositeConfidence)}`}>
                {confidenceLabel(compositeConfidence).toLowerCase()}
              </span>.
            </p>
          </div>
        </div>

        {/* Per-signal breakdown */}
        <div className="flex flex-col gap-3 mt-2">
          <ConfidenceMeter
            label="Typing Rhythm"
            value={confidence?.signals.typing ?? 0.8}
            description="Keystroke timing and pressure patterns"
          />
          <ConfidenceMeter
            label="Mouse Dynamics"
            value={confidence?.signals.mouse ?? 0.8}
            description="Pointer velocity, acceleration, and click precision"
          />
          <ConfidenceMeter
            label="Device Trust"
            value={confidence?.signals.device ?? 0.8}
            description="Hardware fingerprint and sensor patterns"
          />
        </div>
      </div>

      {/* ── Enrolled Devices ──────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/70 p-5 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-zinc-200">Enrolled Devices</h2>
          <span className="text-xs text-zinc-500">{devices.length} device{devices.length !== 1 ? "s" : ""}</span>
        </div>
        {devices.length === 0 ? (
          <p className="text-sm text-zinc-600 py-4 text-center">
            No devices enrolled yet. Your current device will be enrolled
            automatically.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {devices.map((d) => (
              <DeviceCard key={d.deviceId} device={d} />
            ))}
          </div>
        )}
      </div>

      {/* ── Alert History ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/70 p-5 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-zinc-200">Alert History</h2>
          {auditLog.length > 0 && (
            <span className="text-xs text-zinc-500">{auditLog.length} event{auditLog.length !== 1 ? "s" : ""}</span>
          )}
        </div>
        {auditLog.length === 0 ? (
          <p className="text-sm text-zinc-600 py-4 text-center">
            No anomalies detected. Your session is clean.
          </p>
        ) : (
          <div>
            {auditLog.map((event) => (
              <AuditEventRow key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
