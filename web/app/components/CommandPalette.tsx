"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

const apps = [
  { id: "mail", label: "Mail", href: "/mail", description: "Open your inbox", emoji: "✉️" },
  { id: "calendar", label: "Calendar", href: "/calendar", description: "View your schedule", emoji: "📅" },
  { id: "drive", label: "Drive", href: "/drive", description: "Browse your files", emoji: "💾" },
  { id: "docs", label: "Docs", href: "/docs", description: "Edit documents", emoji: "📝" },
  { id: "sheets", label: "Sheets", href: "/sheets", description: "Spreadsheets & data", emoji: "📊" },
  { id: "chat", label: "Chat", href: "/chat", description: "Messages & channels", emoji: "💬" },
  { id: "tasks", label: "Tasks", href: "/tasks", description: "Kanban & sprints", emoji: "✅" },
  { id: "notes", label: "Notes", href: "/notes", description: "Quick notes & ideas", emoji: "🗒️" },
  { id: "meet", label: "Meet", href: "/meet", description: "Video calls & transcription", emoji: "🎥" },
];

const aiSuggestions = [
  "Summarize my last 3 emails",
  "What meetings do I have today?",
  "Find my Q4 report document",
  "Show unread messages in Chat",
  "Draft a reply to the latest email",
];

interface CommandPaletteProps {
  onClose: () => void;
}

function CommandPaletteInner({ onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<"nav" | "ai">("nav");
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filteredApps = apps.filter(
    (a) =>
      a.label.toLowerCase().includes(query.toLowerCase()) ||
      a.description.toLowerCase().includes(query.toLowerCase())
  );

  const filteredSuggestions = aiSuggestions.filter((s) =>
    s.toLowerCase().includes(query.toLowerCase())
  );

  const allItems = mode === "nav" ? filteredApps : filteredSuggestions;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (mode === "nav" && filteredApps[selectedIndex]) {
          router.push(filteredApps[selectedIndex].href);
          onClose();
        } else if (mode === "ai") {
          handleAIQuery(query);
        }
      } else if (e.key === "Tab") {
        e.preventDefault();
        setMode((m) => (m === "nav" ? "ai" : "nav"));
        setSelectedIndex(0);
        setAiResponse(null);
      }
    },
    [allItems, selectedIndex, mode, query, router, onClose]
  );

  const handleAIQuery = async (q: string) => {
    if (!q.trim()) return;
    setIsLoadingAI(true);
    setAiResponse(null);
    // Simulate AI response (connect to real AI Orchestrator API in production)
    await new Promise((r) => setTimeout(r, 1200));
    setAiResponse(
      `AI: Analyzing "${q}"…\n\nHere's what I found: This query has been sent to the Quant AI Orchestrator. In production, this connects to your live inbox, calendar, and documents to generate a real-time answer.`
    );
    setIsLoadingAI(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -8 }}
      transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="w-full max-w-xl rounded-2xl overflow-hidden"
      style={{
        background: "rgba(10,10,10,0.95)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 32px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.05)",
      }}
    >
      {/* Header with mode tabs */}
      <div
        className="flex items-center gap-2 px-4 pt-3 pb-2"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth={2} className="w-4 h-4 shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
            setAiResponse(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={mode === "nav" ? "Go to app, search anything…" : "Ask AI anything…"}
          className="flex-1 bg-transparent outline-none text-sm"
          style={{ color: "#f0f0f0", caretColor: "#6366f1" }}
        />
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.07)", color: "#6b7280" }}>
          ESC
        </span>
      </div>

      {/* Mode switch */}
      <div className="flex px-4 py-2 gap-2">
        {(["nav", "ai"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setSelectedIndex(0); setAiResponse(null); }}
            className="px-3 py-1 rounded-lg text-xs font-medium transition-all"
            style={{
              background: mode === m ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)",
              color: mode === m ? "#818cf8" : "#6b7280",
              border: mode === m ? "1px solid rgba(99,102,241,0.3)" : "1px solid transparent",
            }}
          >
            {m === "nav" ? "🧭 Navigate" : "✨ Ask AI"}
          </button>
        ))}
        <span className="ml-auto text-xs" style={{ color: "#374151" }}>
          Tab to switch
        </span>
      </div>

      {/* Results */}
      <div className="max-h-80 overflow-y-auto pb-2">
        {mode === "nav" ? (
          filteredApps.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm" style={{ color: "#4b5563" }}>
              No apps found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            filteredApps.map((app, i) => (
              <motion.button
                key={app.id}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => { router.push(app.href); onClose(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                style={{
                  background: i === selectedIndex ? "rgba(99,102,241,0.12)" : "transparent",
                  borderLeft: i === selectedIndex ? "2px solid #6366f1" : "2px solid transparent",
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="text-lg w-6 text-center">{app.emoji}</span>
                <div>
                  <div className="text-sm font-medium" style={{ color: "#f0f0f0" }}>
                    {app.label}
                  </div>
                  <div className="text-xs" style={{ color: "#6b7280" }}>
                    {app.description}
                  </div>
                </div>
                {i === selectedIndex && (
                  <span className="ml-auto text-xs" style={{ color: "#4b5563" }}>↵</span>
                )}
              </motion.button>
            ))
          )
        ) : (
          <div className="px-4 py-2">
            {aiResponse ? (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-xl text-sm whitespace-pre-wrap"
                style={{
                  background: "rgba(99,102,241,0.08)",
                  border: "1px solid rgba(99,102,241,0.2)",
                  color: "#c7d2fe",
                  lineHeight: 1.6,
                }}
              >
                {aiResponse}
              </motion.div>
            ) : isLoadingAI ? (
              <div className="py-8 flex flex-col items-center gap-3">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                  className="w-6 h-6 rounded-full"
                  style={{ border: "2px solid rgba(99,102,241,0.2)", borderTop: "2px solid #6366f1" }}
                />
                <span className="text-sm" style={{ color: "#6b7280" }}>AI is thinking…</span>
              </div>
            ) : (
              <div>
                <p className="text-xs mb-3" style={{ color: "#4b5563" }}>
                  Suggestions — press Enter to ask
                </p>
                {filteredSuggestions.map((s, i) => (
                  <button
                    key={s}
                    onClick={() => handleAIQuery(s)}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors mb-1"
                    style={{
                      background: i === selectedIndex ? "rgba(99,102,241,0.12)" : "rgba(255,255,255,0.03)",
                      color: "#9ca3af",
                    }}
                    onMouseEnter={() => setSelectedIndex(i)}
                  >
                    <span className="mr-2">✨</span>{s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between px-4 py-2 text-xs"
        style={{ borderTop: "1px solid rgba(255,255,255,0.04)", color: "#374151" }}
      >
        <span>↑↓ navigate</span>
        <span>Quant Workspace</span>
        <span>⌘K to close</span>
      </div>
    </motion.div>
  );
}

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsOpen(false);
          }}
        >
          <div className="w-full max-w-xl px-4">
            <CommandPaletteInner onClose={() => setIsOpen(false)} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
