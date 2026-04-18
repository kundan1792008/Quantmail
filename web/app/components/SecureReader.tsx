"use client";

/**
 * SecureReader
 *
 * Client-side viewer for Self-Destructing Encrypted Messages (issue #45).
 *
 * Responsibilities
 * ────────────────
 *   1. Extract the AES-256-GCM message key from `window.location.hash`
 *      (the `#k=<base64url>` fragment that the server never saw).
 *   2. GET `/ephemeral/:id` to retrieve the ciphertext + IV + auth tag.
 *      The server transitions the message to READ/DESTROYED as a side
 *      effect of that request, so this component is the destruction
 *      trigger.
 *   3. Decrypt the payload locally via WebCrypto (AES-GCM).
 *   4. Render the plaintext inside a sandboxed iframe (`sandbox` attr
 *      with no `allow-same-origin` / `allow-scripts`) so any HTML in
 *      the message cannot exfiltrate the key or call APIs.
 *   5. Apply the destruction-mode UX:
 *        • READ_ONCE        – one visible countdown, then shred.
 *        • TIMER_*          – countdown to `expiresAt`.
 *        • SCREENSHOT_PROOF – user-select:none, overlay watermark,
 *                             blocked right-click / copy / print.
 *   6. When the countdown reaches 0 or the user dismisses the reader,
 *      trigger the "shredding" animation and wipe the decrypted copy
 *      from React state and the clipboard.
 *
 *  This component is self-contained – it has no external dependencies
 *  beyond React + the browser's WebCrypto + fetch implementations.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

// ─── Types mirroring the server response ──────────────────────────

type DestructionMode =
  | "READ_ONCE"
  | "TIMER_1H"
  | "TIMER_24H"
  | "TIMER_7D"
  | "SCREENSHOT_PROOF";

interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  algorithm: "AES-256-GCM";
}

interface FetchSuccess {
  ok: true;
  id: string;
  subject: string;
  payload: EncryptedPayload;
  attachments: EncryptedPayload | null;
  destructionMode: DestructionMode;
  expiresAt: string | null;
  senderEphemeralPublicKey: string;
  vaultAllowed: boolean;
  remainingReads: number;
  screenshotProof: boolean;
}

interface FetchFailure {
  error: "NOT_FOUND" | "EXPIRED" | "ALREADY_READ" | "DESTROYED" | "REVOKED";
}

export interface SecureReaderProps {
  /** The ephemeral message id (from the path, not the fragment). */
  messageId: string;
  /**
   * Override the automatic fragment reader – used in tests.  When
   * provided, the component skips reading `window.location.hash`.
   */
  keyOverride?: string;
  /** Base URL for the API; defaults to empty (same origin). */
  apiBase?: string;
  /** Optional callback fired after the shredding animation finishes. */
  onDestroyed?: () => void;
  /**
   * Invoked when the user clicks "Save to Vault" – only rendered when
   * the sender set `vaultAllowed = true`.  The caller is responsible
   * for running the WebAuthn flow and POSTing to `/vault`.
   */
  onSaveToVault?: (params: {
    messageId: string;
    messageKey: string;
    payload: EncryptedPayload;
    subject: string;
  }) => Promise<void> | void;
}

type Phase =
  | "LOADING"
  | "READY"
  | "ERROR"
  | "SHREDDING"
  | "DESTROYED";

// ─── base64url helpers (the fragment uses base64url) ──────────────

function base64UrlToBytes(input: string): Uint8Array {
  const padded =
    input.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((input.length + 3) % 4);
  const binary =
    typeof atob === "function"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function extractKeyFromHash(hash: string): string | null {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!trimmed) return null;
  const params = new URLSearchParams(trimmed);
  const k = params.get("k");
  if (k) return k;
  // Fallback: treat the whole fragment as the key.
  return trimmed;
}

// ─── WebCrypto helpers ────────────────────────────────────────────

async function importAesKey(keyB64Url: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(keyB64Url);
  if (raw.length !== 32) {
    throw new Error("Invalid AES-256 key length");
  }
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
}

async function decryptAesGcm(
  payload: EncryptedPayload,
  key: CryptoKey
): Promise<string> {
  // WebCrypto expects the auth tag appended to the ciphertext.
  const ct = base64UrlToBytes(payload.ciphertext);
  const iv = base64UrlToBytes(payload.iv);
  const tag = base64UrlToBytes(payload.authTag);
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct, 0);
  combined.set(tag, ct.length);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    combined
  );
  return new TextDecoder().decode(plain);
}

// ─── Countdown hook ───────────────────────────────────────────────

function useCountdown(destructionMode: DestructionMode, expiresAt: string | null) {
  const deadline = useMemo(() => {
    if (destructionMode === "READ_ONCE" || destructionMode === "SCREENSHOT_PROOF") {
      // 60-second soft countdown for read-once modes.
      return Date.now() + 60_000;
    }
    if (expiresAt) return new Date(expiresAt).getTime();
    return null;
  }, [destructionMode, expiresAt]);

  const [remainingMs, setRemainingMs] = useState(
    deadline ? Math.max(0, deadline - Date.now()) : 0
  );

  useEffect(() => {
    if (!deadline) return;
    const interval = setInterval(() => {
      const r = Math.max(0, deadline - Date.now());
      setRemainingMs(r);
      if (r <= 0) {
        clearInterval(interval);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [deadline]);

  return { remainingMs, hasDeadline: deadline !== null };
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return `${h}h ${rm}m`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d}d ${rh}h`;
}

// ─── Main component ──────────────────────────────────────────────

export function SecureReader(props: SecureReaderProps) {
  const { messageId, keyOverride, apiBase = "", onDestroyed, onSaveToVault } =
    props;

  const [phase, setPhase] = useState<Phase>("LOADING");
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [meta, setMeta] = useState<Omit<
    FetchSuccess,
    "payload" | "attachments"
  > | null>(null);
  const [plaintext, setPlaintext] = useState<string>("");
  const plaintextRef = useRef<string>("");
  const keyRef = useRef<string>("");
  const payloadRef = useRef<EncryptedPayload | null>(null);
  const hasFetchedRef = useRef(false);

  const { remainingMs, hasDeadline } = useCountdown(
    meta?.destructionMode ?? "READ_ONCE",
    meta?.expiresAt ?? null
  );

  // ─── Anti-screenshot / anti-copy handlers ──────────────────────

  useEffect(() => {
    if (!meta?.screenshotProof) return;
    const prevent = (e: Event) => {
      e.preventDefault();
      return false;
    };
    const handleKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (
        (e.ctrlKey || e.metaKey) &&
        (key === "c" || key === "x" || key === "p" || key === "s")
      ) {
        e.preventDefault();
      }
      // Print-screen, F12 (devtools)
      if (key === "printscreen" || key === "f12") {
        e.preventDefault();
      }
    };
    document.addEventListener("contextmenu", prevent);
    document.addEventListener("copy", prevent);
    document.addEventListener("cut", prevent);
    document.addEventListener("dragstart", prevent);
    document.addEventListener("selectstart", prevent);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("contextmenu", prevent);
      document.removeEventListener("copy", prevent);
      document.removeEventListener("cut", prevent);
      document.removeEventListener("dragstart", prevent);
      document.removeEventListener("selectstart", prevent);
      document.removeEventListener("keydown", handleKey);
    };
  }, [meta?.screenshotProof]);

  // ─── Shred helper (wipes plaintext copies) ────────────────────

  const shred = useCallback(
    (reason: "COUNTDOWN" | "DISMISS" | "EXTERNAL") => {
      setPhase("SHREDDING");
      setPlaintext("");
      plaintextRef.current = "";
      keyRef.current = "";
      payloadRef.current = null;
      // Best-effort clipboard wipe (ignored if not permitted).
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText("").catch(() => {
          /* clipboard API refused – non-fatal */
        });
      }
      // Small delay for the shred animation.
      window.setTimeout(() => {
        setPhase("DESTROYED");
        onDestroyed?.();
      }, reason === "COUNTDOWN" ? 1200 : 600);
    },
    [onDestroyed]
  );

  // ─── Auto-shred when countdown hits 0 ─────────────────────────

  useEffect(() => {
    if (phase !== "READY") return;
    if (!hasDeadline) return;
    if (remainingMs > 0) return;
    shred("COUNTDOWN");
  }, [phase, hasDeadline, remainingMs, shred]);

  // ─── Initial fetch + decrypt ──────────────────────────────────

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    const keyB64 =
      keyOverride ??
      (typeof window !== "undefined"
        ? extractKeyFromHash(window.location.hash)
        : null);

    if (!keyB64) {
      setErrorReason("MISSING_KEY");
      setPhase("ERROR");
      return;
    }

    keyRef.current = keyB64;

    // Strip the fragment from the URL so a casual shoulder-surfer
    // won't see the raw key after the page loads.
    if (typeof window !== "undefined" && !keyOverride) {
      try {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      } catch {
        /* non-fatal in sandboxed contexts */
      }
    }

    (async () => {
      try {
        const res = await fetch(`${apiBase}/ephemeral/${encodeURIComponent(messageId)}`, {
          method: "GET",
          credentials: "include",
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as FetchFailure;
          setErrorReason(data.error ?? `HTTP_${res.status}`);
          setPhase("ERROR");
          return;
        }
        const data = (await res.json()) as FetchSuccess;
        const { payload, attachments, ...rest } = data;
        payloadRef.current = payload;
        // Attachment ciphertext is intentionally not rendered in this
        // iteration – the SecureReader shows the message body only; a
        // future pass will surface downloadable encrypted attachments.
        void attachments;
        const cryptoKey = await importAesKey(keyB64);
        const decrypted = await decryptAesGcm(payload, cryptoKey);
        plaintextRef.current = decrypted;
        setPlaintext(decrypted);
        setMeta(rest);
        setPhase("READY");
      } catch (err) {
        setErrorReason(err instanceof Error ? err.message : "DECRYPT_FAILED");
        setPhase("ERROR");
      }
    })();
  }, [apiBase, keyOverride, messageId]);

  // ─── Save-to-vault button handler ─────────────────────────────

  const handleSaveToVault = useCallback(async () => {
    if (!meta || !payloadRef.current || !keyRef.current || !onSaveToVault) return;
    await onSaveToVault({
      messageId,
      messageKey: keyRef.current,
      payload: payloadRef.current,
      subject: meta.subject,
    });
  }, [messageId, meta, onSaveToVault]);

  // ─── Render helpers ───────────────────────────────────────────

  const sandboxedSrcDoc = useMemo(() => {
    if (phase !== "READY") return "";
    const screenshotCss = meta?.screenshotProof
      ? `
        html, body {
          user-select: none !important;
          -webkit-user-select: none !important;
          -webkit-touch-callout: none !important;
        }
        body::after {
          content: 'QUANTMAIL • CONFIDENTIAL';
          position: fixed;
          inset: 0;
          display: grid;
          place-items: center;
          font-size: 48px;
          color: rgba(148, 163, 184, 0.18);
          transform: rotate(-30deg);
          pointer-events: none;
          letter-spacing: 8px;
          z-index: 9999;
        }
        @media print { body { display: none !important; } }
      `
      : "";
    const escapedBody = escapeHtml(plaintext);
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      body {
        margin: 0;
        padding: 24px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0f172a;
        color: #e2e8f0;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
      }
      a { color: #60a5fa; }
      ${screenshotCss}
    </style></head><body>${escapedBody}</body></html>`;
  }, [phase, plaintext, meta?.screenshotProof]);

  // ─── Styles (inline to keep component self-contained) ─────────

  const containerStyle: CSSProperties = {
    maxWidth: 720,
    margin: "48px auto",
    borderRadius: 16,
    background: "linear-gradient(180deg, #0b1120 0%, #111827 100%)",
    color: "#e2e8f0",
    boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
    overflow: "hidden",
    position: "relative",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  };

  const headerStyle: CSSProperties = {
    padding: "16px 24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1px solid rgba(148,163,184,0.15)",
  };

  const countdownStyle: CSSProperties = {
    fontVariantNumeric: "tabular-nums",
    fontSize: 13,
    padding: "4px 10px",
    borderRadius: 999,
    background:
      remainingMs > 0
        ? "rgba(56,189,248,0.15)"
        : "rgba(244,63,94,0.15)",
    color: remainingMs > 0 ? "#38bdf8" : "#fb7185",
    border: "1px solid rgba(148,163,184,0.2)",
  };

  const iframeStyle: CSSProperties = {
    width: "100%",
    minHeight: 360,
    border: "none",
    background: "#0f172a",
  };

  const footerStyle: CSSProperties = {
    padding: "12px 24px",
    display: "flex",
    gap: 12,
    justifyContent: "flex-end",
    borderTop: "1px solid rgba(148,163,184,0.15)",
  };

  const buttonStyle: CSSProperties = {
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid rgba(148,163,184,0.25)",
    background: "rgba(30,41,59,0.8)",
    color: "#e2e8f0",
    cursor: "pointer",
    fontSize: 13,
  };

  const shredOverlayStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    background:
      "repeating-linear-gradient(180deg, rgba(15,23,42,0.85) 0 6px, rgba(30,41,59,0.55) 6px 12px)",
    display: "grid",
    placeItems: "center",
    color: "#fca5a5",
    fontSize: 14,
    letterSpacing: 4,
    animation: "qm-shred 1.2s ease-in-out forwards",
  };

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div
      data-testid="secure-reader"
      data-phase={phase}
      style={containerStyle}
      role="region"
      aria-label="Self-destructing secure message"
    >
      <style>{`
        @keyframes qm-shred {
          0%   { transform: translateY(0);   opacity: 1; }
          60%  { transform: translateY(6px); opacity: 0.9; }
          100% { transform: translateY(24px); opacity: 0; }
        }
      `}</style>

      <div style={headerStyle}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.6, letterSpacing: 2 }}>
            SECURE MESSAGE
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {meta?.subject ?? "Decrypting…"}
          </div>
        </div>
        {phase === "READY" && hasDeadline && (
          <div style={countdownStyle} aria-live="polite">
            Self-destructs in {formatRemaining(remainingMs)}
          </div>
        )}
      </div>

      {phase === "LOADING" && (
        <div style={{ padding: 48, textAlign: "center", opacity: 0.7 }}>
          Unwrapping biometric key…
        </div>
      )}

      {phase === "ERROR" && (
        <div
          style={{ padding: 48, textAlign: "center", color: "#fb7185" }}
          data-testid="secure-reader-error"
        >
          This message is unavailable ({errorReason}).
        </div>
      )}

      {phase === "READY" && (
        <iframe
          title="Decrypted message"
          data-testid="secure-reader-iframe"
          sandbox=""
          srcDoc={sandboxedSrcDoc}
          style={iframeStyle}
          referrerPolicy="no-referrer"
        />
      )}

      {phase === "SHREDDING" && (
        <div style={shredOverlayStyle} data-testid="secure-reader-shred">
          SHREDDING…
        </div>
      )}

      {phase === "DESTROYED" && (
        <div
          style={{ padding: 48, textAlign: "center", opacity: 0.6 }}
          data-testid="secure-reader-destroyed"
        >
          This message has self-destructed.
        </div>
      )}

      {phase === "READY" && (
        <div style={footerStyle}>
          {meta?.vaultAllowed && onSaveToVault && (
            <button
              type="button"
              style={buttonStyle}
              onClick={handleSaveToVault}
              data-testid="secure-reader-vault"
            >
              Save to Vault
            </button>
          )}
          <button
            type="button"
            style={buttonStyle}
            onClick={() => shred("DISMISS")}
            data-testid="secure-reader-dismiss"
          >
            Destroy now
          </button>
        </div>
      )}
    </div>
  );
}

/** Minimal HTML escaper for the sandboxed srcDoc. */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default SecureReader;
