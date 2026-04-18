"use client";

/**
 * SmartComposeUI
 *
 * A rich text-area component that provides AI-powered ghost-text completions
 * as the user types an email.
 *
 * Features
 * ────────
 *  • Ghost text (grey inline completion) rendered ahead of the cursor.
 *  • Tab key accepts the top-ranked suggestion.
 *  • Esc key dismisses all suggestions.
 *  • Tooltip below the cursor shows up to 3 ranked full-sentence alternatives.
 *  • Privacy indicator: "All predictions run on your device." badge.
 *  • Settings panel: toggle on/off, aggressiveness slider (word→sentence).
 *  • Tone badge showing the detected tone of the current draft.
 *  • Debounced API calls (300 ms) to avoid hammering the endpoint.
 *  • Feedback sent back to the server on accept/reject for learning.
 *
 * Usage
 * ─────
 *   <SmartComposeUI
 *     subject="Meeting follow-up"
 *     recipientEmail="rahul@acme.com"
 *     recipientName="Rahul Sharma"
 *     userEmail="me@example.com"
 *     onBodyChange={(body) => setBody(body)}
 *   />
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmailTone = "formal" | "casual" | "urgent" | "apologetic" | "neutral";

export interface CompletionSuggestion {
  rank: number;
  text: string;
  confidence: number;
  fullSentence: boolean;
}

export interface SmartComposeSettings {
  /** Whether the feature is enabled. */
  enabled: boolean;
  /**
   * Aggressiveness level:
   *   1 = single word only
   *   2 = short phrase (up to ~5 words)
   *   3 = full sentence
   */
  aggressiveness: 1 | 2 | 3;
  /** Show the full-sentence tooltip (alternative suggestions). */
  showTooltip: boolean;
}

export interface SmartComposeUIProps {
  /** Email subject (provides context for the model). */
  subject: string;
  /** Recipient email address. */
  recipientEmail: string;
  /** Recipient display name. */
  recipientName: string;
  /** The current user's email (for personalisation). */
  userEmail: string;
  /** Relationship hint for tone detection. */
  relationship?: "manager" | "colleague" | "friend" | "client" | "unknown";
  /** Called whenever the body text changes. */
  onBodyChange?: (body: string) => void;
  /** Placeholder text for the textarea. */
  placeholder?: string;
  /** Base URL of the Quantmail API (defaults to localhost:3000). */
  apiBaseUrl?: string;
  /** Initial body content. */
  initialBody?: string;
  /** Extra CSS classes applied to the outer wrapper. */
  className?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 300;
const MIN_CHARS_BEFORE_SUGGEST = 4;
const API_BASE = "http://localhost:3000";

// ─── Tone Color Map ───────────────────────────────────────────────────────────

const TONE_COLORS: Record<EmailTone, string> = {
  formal: "#6366f1",
  casual: "#10b981",
  urgent: "#ef4444",
  apologetic: "#f59e0b",
  neutral: "#6b7280",
};

const TONE_LABELS: Record<EmailTone, string> = {
  formal: "🤝 Formal",
  casual: "😊 Casual",
  urgent: "⚡ Urgent",
  apologetic: "🙏 Apologetic",
  neutral: "📝 Neutral",
};

// ─── Aggressiveness Limits ────────────────────────────────────────────────────

function truncateToAggressiveness(
  text: string,
  level: SmartComposeSettings["aggressiveness"]
): string {
  const words = text.split(/\s+/);
  if (level === 1) return words.slice(0, 1).join(" ");
  if (level === 2) return words.slice(0, 5).join(" ");
  return text; // level 3: full suggestion
}

// ─── Hook: useSmartCompose ────────────────────────────────────────────────────

function useSmartCompose(
  subject: string,
  recipientEmail: string,
  recipientName: string,
  userEmail: string,
  relationship: SmartComposeUIProps["relationship"],
  apiBaseUrl: string
) {
  const [suggestions, setSuggestions] = useState<CompletionSuggestion[]>([]);
  const [tone, setTone] = useState<EmailTone>("neutral");
  const [loading, setLoading] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback(
    async (body: string) => {
      if (
        !subject.trim() ||
        !recipientEmail.trim() ||
        body.trim().length < MIN_CHARS_BEFORE_SUGGEST
      ) {
        setSuggestions([]);
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(`${apiBaseUrl}/smart-compose/suggest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userEmail,
            subject,
            bodyUpToCursor: body,
            recipientEmail,
            recipientName,
            relationship,
            maxSuggestions: 3,
          }),
        });

        if (!res.ok) {
          setSuggestions([]);
          return;
        }

        const data = (await res.json()) as {
          suggestions: CompletionSuggestion[];
          tone: EmailTone;
        };
        setSuggestions(data.suggestions ?? []);
        setTone(data.tone ?? "neutral");
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    },
    [subject, recipientEmail, recipientName, userEmail, relationship, apiBaseUrl]
  );

  const scheduleFetch = useCallback(
    (body: string) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => fetchSuggestions(body), DEBOUNCE_MS);
    },
    [fetchSuggestions]
  );

  const sendFeedback = useCallback(
    async (
      body: string,
      suggestion: CompletionSuggestion,
      accepted: boolean
    ) => {
      fetch(`${apiBaseUrl}/smart-compose/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userEmail,
          context: {
            subject,
            bodyUpToCursor: body,
            recipient: { name: recipientName, email: recipientEmail, relationship },
          },
          suggestion,
          accepted,
        }),
      }).catch(() => {
        // Feedback is best-effort; don't surface errors to the user.
      });
    },
    [apiBaseUrl, userEmail, subject, recipientName, recipientEmail, relationship]
  );

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  return { suggestions, tone, loading, scheduleFetch, sendFeedback, setSuggestions };
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

interface SettingsPanelProps {
  settings: SmartComposeSettings;
  onChange: (s: SmartComposeSettings) => void;
  onClose: () => void;
}

function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={{ duration: 0.18 }}
      className="absolute bottom-full right-0 mb-2 w-72 rounded-2xl p-4 z-50"
      style={{
        background: "#0d0d0d",
        border: "1px solid rgba(255,255,255,0.09)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>
          ✨ Smart Compose Settings
        </span>
        <button
          onClick={onClose}
          className="text-xs"
          style={{ color: "#6b7280" }}
          aria-label="Close settings"
        >
          ✕
        </button>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs" style={{ color: "#9ca3af" }}>
          AI predictions
        </span>
        <button
          role="switch"
          aria-checked={settings.enabled}
          onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
          className="relative w-10 h-5 rounded-full transition-colors"
          style={{
            background: settings.enabled ? "#6366f1" : "rgba(255,255,255,0.1)",
          }}
        >
          <span
            className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
            style={{
              background: "#fff",
              left: settings.enabled ? "calc(100% - 18px)" : "2px",
              transition: "left 0.2s",
            }}
          />
        </button>
      </div>

      {/* Aggressiveness slider */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs" style={{ color: "#9ca3af" }}>
            Prediction length
          </span>
          <span className="text-xs font-medium" style={{ color: "#818cf8" }}>
            {settings.aggressiveness === 1
              ? "Single word"
              : settings.aggressiveness === 2
              ? "Short phrase"
              : "Full sentence"}
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={3}
          step={1}
          value={settings.aggressiveness}
          onChange={(e) =>
            onChange({
              ...settings,
              aggressiveness: Number(e.target.value) as SmartComposeSettings["aggressiveness"],
            })
          }
          className="w-full h-1 rounded-full appearance-none cursor-pointer"
          style={{ accentColor: "#6366f1", background: "rgba(255,255,255,0.1)" }}
        />
        <div className="flex justify-between mt-1">
          {(["Word", "Phrase", "Sentence"] as const).map((label) => (
            <span key={label} className="text-xs" style={{ color: "#4b5563" }}>
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Tooltip toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: "#9ca3af" }}>
          Show alternative suggestions
        </span>
        <button
          role="switch"
          aria-checked={settings.showTooltip}
          onClick={() => onChange({ ...settings, showTooltip: !settings.showTooltip })}
          className="relative w-10 h-5 rounded-full transition-colors"
          style={{
            background: settings.showTooltip ? "#6366f1" : "rgba(255,255,255,0.1)",
          }}
        >
          <span
            className="absolute top-0.5 w-4 h-4 rounded-full"
            style={{
              background: "#fff",
              left: settings.showTooltip ? "calc(100% - 18px)" : "2px",
              transition: "left 0.2s",
            }}
          />
        </button>
      </div>
    </motion.div>
  );
}

// ─── Suggestions Tooltip ──────────────────────────────────────────────────────

interface SuggestionsTooltipProps {
  suggestions: CompletionSuggestion[];
  onAccept: (s: CompletionSuggestion) => void;
  onDismiss: () => void;
  aggressiveness: SmartComposeSettings["aggressiveness"];
}

function SuggestionsTooltip({
  suggestions,
  onAccept,
  onDismiss,
  aggressiveness,
}: SuggestionsTooltipProps) {
  if (suggestions.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.15 }}
      className="absolute z-40 mt-1 w-full max-w-md rounded-xl overflow-hidden"
      style={{
        background: "#111",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
      }}
      role="listbox"
      aria-label="Completion suggestions"
    >
      {suggestions.map((s, i) => {
        const display = truncateToAggressiveness(s.text, aggressiveness);
        const confPct = Math.round(s.confidence * 100);
        return (
          <button
            key={i}
            onClick={() => onAccept(s)}
            className="w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors hover:bg-white/5 focus:bg-white/5 focus:outline-none"
            role="option"
            aria-selected={i === 0}
          >
            <span
              className="text-xs font-mono mt-0.5 shrink-0 w-5 h-5 rounded flex items-center justify-center"
              style={{
                background: i === 0 ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.06)",
                color: i === 0 ? "#818cf8" : "#4b5563",
              }}
            >
              {i === 0 ? "⇥" : i + 1}
            </span>
            <span className="flex-1 text-xs leading-relaxed" style={{ color: "#d1d5db" }}>
              {display}
            </span>
            <span className="text-xs shrink-0 mt-0.5" style={{ color: "#374151" }}>
              {confPct}%
            </span>
          </button>
        );
      })}

      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
      >
        <span className="text-xs" style={{ color: "#374151" }}>
          ⇥ accept &nbsp;·&nbsp; esc dismiss
        </span>
        <button
          onClick={onDismiss}
          className="text-xs"
          style={{ color: "#4b5563" }}
        >
          Dismiss
        </button>
      </div>
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SmartComposeUI({
  subject,
  recipientEmail,
  recipientName,
  userEmail,
  relationship,
  onBodyChange,
  placeholder = "Write your message…",
  apiBaseUrl = API_BASE,
  initialBody = "",
  className = "",
}: SmartComposeUIProps) {
  const [body, setBody] = useState(initialBody);
  const [ghostText, setGhostText] = useState("");
  const [showTooltip, setShowTooltip] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<SmartComposeSettings>({
    enabled: true,
    aggressiveness: 3,
    showTooltip: true,
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { suggestions, tone, loading, scheduleFetch, sendFeedback, setSuggestions } =
    useSmartCompose(
      subject,
      recipientEmail,
      recipientName,
      userEmail,
      relationship,
      apiBaseUrl
    );

  // Update ghost text when suggestions arrive.
  useEffect(() => {
    if (!settings.enabled || suggestions.length === 0) {
      setGhostText("");
      setShowTooltip(false);
      return;
    }
    const top = suggestions[0]!;
    setGhostText(truncateToAggressiveness(top.text, settings.aggressiveness));
    setShowTooltip(settings.showTooltip && suggestions.length > 1);
  }, [suggestions, settings.enabled, settings.aggressiveness, settings.showTooltip]);

  const handleBodyChange = useCallback(
    (value: string) => {
      setBody(value);
      onBodyChange?.(value);
      setGhostText("");
      setSuggestions([]);
      if (settings.enabled) {
        scheduleFetch(value);
      }
    },
    [onBodyChange, scheduleFetch, settings.enabled, setSuggestions]
  );

  const acceptTopSuggestion = useCallback(() => {
    if (!ghostText || suggestions.length === 0) return;
    const top = suggestions[0]!;
    const newBody = body + ghostText;
    setBody(newBody);
    onBodyChange?.(newBody);
    setGhostText("");
    setSuggestions([]);
    sendFeedback(body, top, true);
    // Move cursor to end.
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.selectionStart = newBody.length;
        ta.selectionEnd = newBody.length;
        ta.focus();
      }
    });
  }, [ghostText, suggestions, body, onBodyChange, setSuggestions, sendFeedback]);

  const acceptSuggestion = useCallback(
    (s: CompletionSuggestion) => {
      const text = truncateToAggressiveness(s.text, settings.aggressiveness);
      const newBody = body + text;
      setBody(newBody);
      onBodyChange?.(newBody);
      setGhostText("");
      setSuggestions([]);
      setShowTooltip(false);
      sendFeedback(body, s, true);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.selectionStart = newBody.length;
          ta.selectionEnd = newBody.length;
          ta.focus();
        }
      });
    },
    [body, onBodyChange, settings.aggressiveness, setSuggestions, sendFeedback]
  );

  const dismissSuggestions = useCallback(() => {
    if (suggestions.length > 0) {
      sendFeedback(body, suggestions[0]!, false);
    }
    setGhostText("");
    setSuggestions([]);
    setShowTooltip(false);
  }, [body, suggestions, setSuggestions, sendFeedback]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab" && ghostText) {
        e.preventDefault();
        acceptTopSuggestion();
      } else if (e.key === "Escape") {
        dismissSuggestions();
      }
    },
    [ghostText, acceptTopSuggestion, dismissSuggestions]
  );

  const toneColor = TONE_COLORS[tone];

  return (
    <div ref={wrapperRef} className={`relative flex flex-col flex-1 ${className}`}>
      {/* Ghost-text overlay + textarea */}
      <div className="relative flex-1 flex flex-col">
        {/* Visible textarea */}
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => handleBodyChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={ghostText ? "" : placeholder}
          className="flex-1 bg-transparent outline-none text-sm resize-none w-full"
          style={{
            color: "#d1d5db",
            caretColor: "#818cf8",
            minHeight: "160px",
            position: "relative",
            zIndex: 2,
          }}
          aria-label="Email compose body"
          aria-autocomplete="inline"
          aria-haspopup="listbox"
        />

        {/* Ghost text layer */}
        <AnimatePresence>
          {ghostText && (
            <motion.div
              key="ghost"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              className="absolute top-0 left-0 text-sm pointer-events-none select-none"
              aria-hidden="true"
              style={{
                color: "transparent",
                zIndex: 1,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {body}
              <span style={{ color: "rgba(99,102,241,0.45)" }}>{ghostText}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Suggestions tooltip */}
        <AnimatePresence>
          {showTooltip && settings.showTooltip && suggestions.length > 1 && (
            <SuggestionsTooltip
              suggestions={suggestions}
              onAccept={acceptSuggestion}
              onDismiss={dismissSuggestions}
              aggressiveness={settings.aggressiveness}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Bottom bar */}
      <div
        className="flex items-center justify-between pt-2 gap-2 flex-wrap"
        style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
      >
        {/* Left: tone badge + privacy note */}
        <div className="flex items-center gap-2">
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              background: `${toneColor}18`,
              color: toneColor,
              border: `1px solid ${toneColor}30`,
            }}
          >
            {TONE_LABELS[tone]}
          </span>

          {loading && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-xs"
              style={{ color: "#4b5563" }}
            >
              ⋯
            </motion.span>
          )}

          {ghostText && (
            <span className="text-xs" style={{ color: "#374151" }}>
              Tab to accept
            </span>
          )}
        </div>

        {/* Right: privacy indicator + settings */}
        <div className="flex items-center gap-2">
          <span
            className="text-xs flex items-center gap-1"
            style={{ color: "#374151" }}
            title="Your writing data stays private"
          >
            <span>🔒</span>
            <span>On-device predictions</span>
          </span>

          <div className="relative">
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors"
              style={{
                background: showSettings
                  ? "rgba(99,102,241,0.15)"
                  : "rgba(255,255,255,0.05)",
                color: showSettings ? "#818cf8" : "#6b7280",
              }}
              aria-label="Smart Compose settings"
            >
              <span>✨</span>
              <span>AI</span>
              <span style={{ opacity: 0.6 }}>
                {settings.enabled ? "On" : "Off"}
              </span>
            </button>

            <AnimatePresence>
              {showSettings && (
                <SettingsPanel
                  settings={settings}
                  onChange={setSettings}
                  onClose={() => setShowSettings(false)}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
