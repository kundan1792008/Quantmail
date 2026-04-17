"use client";

/**
 * SecureReader Component
 *
 * Displays a self-destructing, end-to-end encrypted message in a security-
 * hardened environment.
 *
 * Features
 * ────────
 * • Decrypts the message entirely in the browser using the Web Crypto API.
 *   The AES-256-GCM key lives only in the URL fragment — it is never sent
 *   to the server.
 * • SCREENSHOT_PROOF mode: CSS user-select:none + JS-level event prevention
 *   for right-click, print, and clipboard access.  A semi-transparent
 *   watermark overlay shows the recipient's email on every "frame".
 * • Self-destruct countdown timer displayed in the corner.
 *   "This message will self-destruct in…" animation for READ_ONCE /
 *   SCREENSHOT_PROOF modes.
 * • "Shredding" animation plays when the message is destroyed.
 * • Renders decrypted HTML content inside a sandboxed <iframe> so any
 *   injected scripts cannot escape to the parent page.
 *
 * Props
 * ─────
 *   messageId        string   — ID of the ephemeral message to fetch.
 *   recipientEmail   string   — used for the watermark overlay.
 *   apiBase          string   — base URL of the Quantmail backend (optional).
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FC,
} from "react";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ─────────────────────────────────────────────────────────────────────

type DestructionMode =
  | "READ_ONCE"
  | "TIMER_1H"
  | "TIMER_24H"
  | "TIMER_7D"
  | "SCREENSHOT_PROOF";

interface SecureMessagePayload {
  id: string;
  encryptedBlob: string | null;
  iv: string | null;
  authTag: string | null;
  subject: string;
  destructionMode: DestructionMode;
  screenshotProof: boolean;
  senderPublicKey: string | null;
  alreadyDestroyed: boolean;
  destroyedAt: string | null;
}

type ComponentState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "awaiting_key" }
  | { phase: "decrypting" }
  | { phase: "ready"; plainHtml: string; subject: string; mode: DestructionMode; screenshotProof: boolean; expiresIn: number | null }
  | { phase: "destroyed"; at: Date }
  | { phase: "error"; message: string };

export interface SecureReaderProps {
  messageId: string;
  recipientEmail?: string;
  apiBase?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_API_BASE =
  typeof window !== "undefined"
    ? window.location.origin.replace(":3000", ":3001")
    : "http://localhost:3001";

// ─── Web Crypto helpers ────────────────────────────────────────────────────────

/**
 * Decodes a base64url string to a Uint8Array.
 */
function base64urlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Parses the URL fragment to extract the AES key material.
 * Expected fragment format: #key=<base64url-raw-key>
 *   or (ECDH mode): #pub=<senderPubKey>&s=<salt>
 */
function parseKeyFragment(): { rawKey?: string; senderPubKey?: string; salt?: string } {
  if (typeof window === "undefined") return {};
  const hash = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  return {
    rawKey: params.get("key") ?? undefined,
    senderPubKey: params.get("pub") ?? undefined,
    salt: params.get("s") ?? undefined,
  };
}

/**
 * Imports a raw 256-bit AES-GCM key from base64url-encoded bytes.
 */
async function importRawAesKey(rawBase64url: string): Promise<CryptoKey> {
  const raw = base64urlToUint8Array(rawBase64url);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
}

/**
 * Decrypts an AES-256-GCM ciphertext using the provided CryptoKey.
 */
async function aesGcmDecrypt(
  key: CryptoKey,
  ivBase64url: string,
  authTagBase64url: string,
  ciphertextBase64url: string
): Promise<string> {
  const iv = base64urlToUint8Array(ivBase64url);
  const authTag = base64urlToUint8Array(authTagBase64url);
  const ciphertext = base64urlToUint8Array(ciphertextBase64url);

  // The Web Crypto API expects ciphertext || authTag concatenated.
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext, 0);
  combined.set(authTag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    combined
  );

  return new TextDecoder().decode(decrypted);
}

// ─── Timer helpers ─────────────────────────────────────────────────────────────

const MODE_DURATIONS_MS: Partial<Record<DestructionMode, number>> = {
  TIMER_1H: 60 * 60 * 1_000,
  TIMER_24H: 24 * 60 * 60 * 1_000,
  TIMER_7D: 7 * 24 * 60 * 60 * 1_000,
};

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours.toString().padStart(2, "0")}h`;
  if (hours > 0)
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

const ShredAnimation: FC = () => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="fixed inset-0 z-50 flex flex-col items-center justify-center"
    style={{ background: "rgba(0,0,0,0.92)" }}
  >
    <motion.div
      initial={{ scaleY: 1 }}
      animate={{ scaleY: 0, transition: { duration: 1.2, ease: "easeIn" } }}
      style={{
        width: 280,
        height: 200,
        background: "linear-gradient(180deg,#1e1e1e 0%,#111 100%)",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.1)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {Array.from({ length: 12 }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ x: 0 }}
          animate={{
            x: [(i % 2 === 0 ? 1 : -1) * (Math.random() * 20 + 5), 0],
            transition: {
              repeat: Infinity,
              duration: 0.08 + Math.random() * 0.06,
              ease: "linear",
            },
          }}
          style={{
            flex: 1,
            background: `rgba(255,255,255,${0.03 + Math.random() * 0.04})`,
            borderBottom: "1px solid rgba(0,0,0,0.3)",
          }}
        />
      ))}
    </motion.div>
    <motion.p
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { delay: 0.3 } }}
      className="mt-6 text-sm font-medium"
      style={{ color: "#ef4444" }}
    >
      Message destroyed
    </motion.p>
    <motion.p
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { delay: 0.6 } }}
      className="mt-1 text-xs"
      style={{ color: "#6b7280" }}
    >
      This message no longer exists.
    </motion.p>
  </motion.div>
);

const DestroyedScreen: FC<{ at: Date }> = ({ at }) => (
  <div
    className="flex flex-col items-center justify-center h-full gap-4"
    style={{ color: "#9ca3af" }}
  >
    <div
      className="w-16 h-16 rounded-full flex items-center justify-center"
      style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth={1.5} className="w-8 h-8">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
        />
      </svg>
    </div>
    <h2 className="text-lg font-semibold" style={{ color: "#f0f0f0" }}>
      Message Destroyed
    </h2>
    <p className="text-sm text-center max-w-xs">
      This self-destructing message has been permanently deleted and cannot be
      recovered.
    </p>
    <p className="text-xs" style={{ color: "#4b5563" }}>
      Destroyed at {at.toLocaleString()}
    </p>
  </div>
);

// ─── Main component ────────────────────────────────────────────────────────────

export default function SecureReader({
  messageId,
  recipientEmail = "",
  apiBase = DEFAULT_API_BASE,
}: SecureReaderProps) {
  const [state, setState] = useState<ComponentState>({ phase: "idle" });
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showShred, setShowShred] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiresAtRef = useRef<number | null>(null);

  // ── Screenshot / print prevention ──────────────────────────────────────────

  useEffect(() => {
    const isScreenshotProof =
      state.phase === "ready" && state.screenshotProof;

    if (!isScreenshotProof) return;

    const preventContextMenu = (e: MouseEvent) => e.preventDefault();
    const preventKeyboard = (e: KeyboardEvent) => {
      // Block Print (Ctrl+P / Cmd+P), Save (Ctrl+S), Copy (Ctrl+C)
      if (
        e.key === "p" && (e.ctrlKey || e.metaKey) ||
        e.key === "s" && (e.ctrlKey || e.metaKey) ||
        e.key === "c" && (e.ctrlKey || e.metaKey)
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const preventBeforePrint = () => {
      document.body.style.visibility = "hidden";
    };
    const restoreAfterPrint = () => {
      document.body.style.visibility = "visible";
    };

    document.addEventListener("contextmenu", preventContextMenu);
    document.addEventListener("keydown", preventKeyboard);
    window.addEventListener("beforeprint", preventBeforePrint);
    window.addEventListener("afterprint", restoreAfterPrint);

    return () => {
      document.removeEventListener("contextmenu", preventContextMenu);
      document.removeEventListener("keydown", preventKeyboard);
      window.removeEventListener("beforeprint", preventBeforePrint);
      window.removeEventListener("afterprint", restoreAfterPrint);
    };
  }, [state]);

  // ── Countdown ticker ────────────────────────────────────────────────────────

  const startCountdown = useCallback((expiresAtMs: number) => {
    expiresAtRef.current = expiresAtMs;
    setCountdown(Math.max(0, expiresAtMs - Date.now()));

    countdownRef.current = setInterval(() => {
      const remaining = Math.max(0, (expiresAtRef.current ?? 0) - Date.now());
      setCountdown(remaining);

      if (remaining <= 0) {
        if (countdownRef.current) clearInterval(countdownRef.current);
        // Trigger shred animation then switch to destroyed state.
        setShowShred(true);
        setTimeout(() => {
          setShowShred(false);
          setState({ phase: "destroyed", at: new Date() });
        }, 1_800);
      }
    }, 1_000);
  }, []);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // ── Fetch & decrypt flow ────────────────────────────────────────────────────

  const loadAndDecrypt = useCallback(async () => {
    setState({ phase: "loading" });

    let payload: SecureMessagePayload;

    try {
      const resp = await fetch(`${apiBase}/ephemeral/${messageId}`);

      if (resp.status === 410) {
        const body = (await resp.json()) as { destroyedAt?: string };
        setState({
          phase: "destroyed",
          at: body.destroyedAt ? new Date(body.destroyedAt) : new Date(),
        });
        return;
      }

      if (!resp.ok) {
        throw new Error(`Server returned ${resp.status}`);
      }

      const json = (await resp.json()) as { message: SecureMessagePayload };
      payload = json.message;
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "Failed to fetch message.",
      });
      return;
    }

    if (payload.alreadyDestroyed) {
      setState({
        phase: "destroyed",
        at: payload.destroyedAt ? new Date(payload.destroyedAt) : new Date(),
      });
      return;
    }

    if (!payload.encryptedBlob || !payload.iv || !payload.authTag) {
      setState({ phase: "error", message: "Message data is incomplete." });
      return;
    }

    // Parse decryption key from URL fragment.
    setState({ phase: "awaiting_key" });
    const { rawKey } = parseKeyFragment();

    if (!rawKey) {
      setState({
        phase: "error",
        message:
          "Decryption key not found in URL fragment. Ensure you opened the full secure link.",
      });
      return;
    }

    setState({ phase: "decrypting" });

    try {
      const cryptoKey = await importRawAesKey(rawKey);
      const plainHtml = await aesGcmDecrypt(
        cryptoKey,
        payload.iv,
        payload.authTag,
        payload.encryptedBlob
      );

      // Compute timer expiry for display.
      let expiresIn: number | null = null;
      const durationMs = MODE_DURATIONS_MS[payload.destructionMode];
      if (durationMs !== undefined) {
        expiresIn = durationMs; // Approximate; server knows exact expiresAt.
        startCountdown(Date.now() + durationMs);
      }

      setState({
        phase: "ready",
        plainHtml,
        subject: payload.subject,
        mode: payload.destructionMode,
        screenshotProof: payload.screenshotProof,
        expiresIn,
      });
    } catch (err) {
      setState({
        phase: "error",
        message:
          "Decryption failed. The key may be invalid or the message may have been tampered with.",
      });
    }
  }, [messageId, apiBase, startCountdown]);

  useEffect(() => {
    if (state.phase === "idle") {
      loadAndDecrypt();
    }
  }, [state.phase, loadAndDecrypt]);

  // ── Build sandboxed iframe content ──────────────────────────────────────────

  const buildIframeSrcdoc = useCallback(
    (html: string, isScreenshotProof: boolean): string => {
      const watermarkStyle = isScreenshotProof
        ? `
        body::before {
          content: '${recipientEmail || "CONFIDENTIAL"}';
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-30deg);
          font-size: 48px;
          font-weight: 700;
          color: rgba(255,255,255,0.04);
          white-space: nowrap;
          pointer-events: none;
          z-index: 9999;
          user-select: none;
        }`
        : "";

      const preventScripts = isScreenshotProof
        ? `<script>
          document.addEventListener('contextmenu', e => e.preventDefault());
          document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && ['p','s','c','a'].includes(e.key)) {
              e.preventDefault();
            }
          });
        </script>`
        : "";

      return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #e5e7eb;
      background: #0a0a0a;
    }
    ${
      isScreenshotProof
        ? "* { user-select: none !important; -webkit-user-select: none !important; }"
        : ""
    }
    ${watermarkStyle}
    a { color: #818cf8; }
    img { max-width: 100%; height: auto; }
    pre, code { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  ${html}
  ${preventScripts}
</body>
</html>`;
    },
    [recipientEmail]
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="relative flex flex-col h-full"
      style={{ background: "#000", color: "#f0f0f0" }}
    >
      <AnimatePresence>
        {showShred && <ShredAnimation key="shred" />}
      </AnimatePresence>

      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: "#ef4444" }}
          />
          <span className="text-xs font-medium" style={{ color: "#ef4444" }}>
            SECURE MESSAGE
          </span>
        </div>

        {/* Countdown timer */}
        {countdown !== null && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold"
            style={{
              background: countdown < 60_000 ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.06)",
              color: countdown < 60_000 ? "#ef4444" : "#9ca3af",
              border: `1px solid ${countdown < 60_000 ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.1)"}`,
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
            </svg>
            {formatCountdown(countdown)}
          </motion.div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden relative">
        {/* Loading / status screens */}
        {(state.phase === "loading" ||
          state.phase === "awaiting_key" ||
          state.phase === "decrypting") && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
              className="w-8 h-8 rounded-full"
              style={{ border: "2px solid rgba(99,102,241,0.3)", borderTopColor: "#6366f1" }}
            />
            <p className="text-sm" style={{ color: "#6b7280" }}>
              {state.phase === "loading" && "Fetching encrypted message…"}
              {state.phase === "awaiting_key" && "Locating decryption key…"}
              {state.phase === "decrypting" && "Decrypting…"}
            </p>
          </div>
        )}

        {state.phase === "error" && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: "rgba(239,68,68,0.1)" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth={1.5} className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <p className="text-sm font-medium" style={{ color: "#f0f0f0" }}>
              Unable to open message
            </p>
            <p className="text-xs text-center" style={{ color: "#6b7280" }}>
              {state.message}
            </p>
          </div>
        )}

        {state.phase === "destroyed" && <DestroyedScreen at={state.at} />}

        {state.phase === "ready" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col h-full"
          >
            {/* Subject */}
            <div
              className="px-5 py-3 shrink-0"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
            >
              <h2 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>
                {state.subject || "(No subject)"}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{
                    background: "rgba(239,68,68,0.12)",
                    color: "#ef4444",
                    border: "1px solid rgba(239,68,68,0.25)",
                  }}
                >
                  {state.mode === "SCREENSHOT_PROOF"
                    ? "🛡 Screenshot-Proof"
                    : state.mode === "READ_ONCE"
                    ? "👁 Read Once"
                    : `⏱ ${state.mode.replace("TIMER_", "").toLowerCase()}`}
                </span>
                {state.screenshotProof && (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(139,92,246,0.12)", color: "#a78bfa" }}
                  >
                    Protected
                  </span>
                )}
              </div>
            </div>

            {/* READ_ONCE / SCREENSHOT_PROOF self-destruct notice */}
            {(state.mode === "READ_ONCE" || state.mode === "SCREENSHOT_PROOF") && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mx-4 mt-3 px-3 py-2 rounded-lg text-xs flex items-center gap-2 shrink-0"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  color: "#fca5a5",
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 shrink-0">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                </svg>
                This message has already been delivered to your browser and will self-destruct on the server. Do not close this tab.
              </motion.div>
            )}

            {/* Sandboxed iframe */}
            <div className="flex-1 relative mx-4 my-3 rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
              <iframe
                ref={iframeRef}
                srcDoc={buildIframeSrcdoc(state.plainHtml, state.screenshotProof)}
                sandbox="allow-same-origin"
                className="w-full h-full"
                style={{ border: "none", background: "#0a0a0a" }}
                title="Secure Message Content"
              />
              {/* Screenshot-proof watermark overlay (CSS layer outside iframe) */}
              {state.screenshotProof && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    backgroundImage: `repeating-linear-gradient(
                      -45deg,
                      transparent,
                      transparent 60px,
                      rgba(255,255,255,0.015) 60px,
                      rgba(255,255,255,0.015) 61px
                    )`,
                    userSelect: "none",
                  }}
                />
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
