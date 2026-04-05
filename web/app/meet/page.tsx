"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";

const participants = [
  { id: 1, name: "You", initials: "Y", isSelf: true },
  { id: 2, name: "Rahul Sharma", initials: "R" },
  { id: 3, name: "Priya Singh", initials: "P" },
  { id: 4, name: "Alex Johnson", initials: "A" },
];

const transcriptItems = [
  { speaker: "Rahul Sharma", time: "0:12", text: "Let's kick off with a quick status update from everyone." },
  { speaker: "You", time: "0:28", text: "The AI command palette is complete and working beautifully. Framer Motion animations feel incredibly smooth." },
  { speaker: "Priya Singh", time: "0:45", text: "Design system tokens are finalized. All 9 apps now follow the same dark-mode aesthetic." },
  { speaker: "Alex Johnson", time: "1:03", text: "Investors are ready for the demo. Series A term sheet is on its way." },
  { speaker: "Rahul Sharma", time: "1:22", text: "Perfect. We ship next week. This is going to change everything." },
];

const actionItems = [
  { done: false, text: "Finalize Series A term sheet review" },
  { done: false, text: "Schedule production deployment with Rahul" },
  { done: true, text: "Ship AI command palette (Cmd+K)" },
  { done: true, text: "Design system tokens applied to all apps" },
];

export default function MeetPage() {
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [showTranscript, setShowTranscript] = useState(true);
  const [inCall, setInCall] = useState(false);
  const [elapsed, setElapsed] = useState("00:00");

  const handleJoin = () => {
    setInCall(true);
    let seconds = 0;
    const interval = setInterval(() => {
      seconds++;
      const m = String(Math.floor(seconds / 60)).padStart(2, "0");
      const s = String(seconds % 60).padStart(2, "0");
      setElapsed(`${m}:${s}`);
      if (seconds > 3600) clearInterval(interval);
    }, 1000);
  };

  if (!inCall) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center h-full"
        style={{ background: "#000" }}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="text-center max-w-md"
        >
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
            style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth={1.5} className="w-9 h-9">
              <path strokeLinecap="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold mb-2" style={{ color: "#f0f0f0" }}>Quant Meet</h1>
          <p className="text-sm mb-8" style={{ color: "#6b7280" }}>
            Video calls with Live AI Transcription &amp; Action Items
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={handleJoin}
              className="px-8 py-3 rounded-2xl text-sm font-semibold transition-all"
              style={{ background: "#6366f1", color: "#fff", boxShadow: "0 0 24px rgba(99,102,241,0.3)" }}
            >
              🎥 Join with AI Transcription
            </button>
            <button className="px-8 py-3 rounded-2xl text-sm font-medium" style={{ background: "rgba(255,255,255,0.05)", color: "#9ca3af", border: "1px solid rgba(255,255,255,0.08)" }}>
              🔗 Share Meeting Link
            </button>
          </div>

          <p className="text-xs mt-6" style={{ color: "#374151" }}>
            ✨ AI will automatically transcribe and extract action items
          </p>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex h-full"
      style={{ background: "#000" }}
    >
      {/* Main video area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full" style={{ background: "#ef4444" }}>
              <motion.div
                animate={{ scale: [1, 1.4, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                className="w-2 h-2 rounded-full"
                style={{ background: "#ef4444" }}
              />
            </div>
            <span className="text-sm font-medium" style={{ color: "#f0f0f0" }}>Team Standup — Quant Workspace</span>
            <span className="text-xs font-mono" style={{ color: "#6b7280" }}>{elapsed}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: "#4b5563" }}>{participants.length} participants</span>
            <button
              onClick={() => setShowTranscript((v) => !v)}
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{
                background: showTranscript ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.05)",
                color: showTranscript ? "#818cf8" : "#6b7280",
                border: showTranscript ? "1px solid rgba(99,102,241,0.3)" : "1px solid transparent",
              }}
            >
              ✨ AI Transcription
            </button>
          </div>
        </div>

        {/* Video grid */}
        <div className="flex-1 p-4">
          <div className="grid grid-cols-2 gap-3 h-full max-h-80">
            {participants.map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.08 }}
                className="relative rounded-2xl overflow-hidden flex items-center justify-center"
                style={{
                  background: "#0a0a0a",
                  border: p.isSelf ? "2px solid rgba(99,102,241,0.4)" : "1px solid rgba(255,255,255,0.06)",
                  boxShadow: p.isSelf ? "0 0 16px rgba(99,102,241,0.15)" : "none",
                }}
              >
                <div className="flex flex-col items-center gap-2">
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold"
                    style={{ background: "#1f2937", color: "#9ca3af" }}
                  >
                    {p.initials}
                  </div>
                  <span className="text-xs" style={{ color: "#6b7280" }}>{p.name}</span>
                </div>
                {p.isSelf && !cameraOn && (
                  <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }}>
                    <span className="text-xs" style={{ color: "#6b7280" }}>Camera off</span>
                  </div>
                )}
                <div className="absolute bottom-2 left-2 flex items-center gap-1">
                  {!micOn && p.isSelf && (
                    <div className="px-1.5 py-0.5 rounded text-xs" style={{ background: "rgba(239,68,68,0.2)", color: "#ef4444" }}>
                      🔇
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Control bar */}
        <div
          className="flex items-center justify-center gap-3 px-5 py-4 shrink-0"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          <ControlButton
            active={micOn}
            onClick={() => setMicOn((v) => !v)}
            activeIcon="🎤"
            inactiveIcon="🔇"
            label={micOn ? "Mute" : "Unmute"}
          />
          <ControlButton
            active={cameraOn}
            onClick={() => setCameraOn((v) => !v)}
            activeIcon="📷"
            inactiveIcon="📵"
            label={cameraOn ? "Stop Video" : "Start Video"}
          />
          <ControlButton
            active={screenSharing}
            onClick={() => setScreenSharing((v) => !v)}
            activeIcon="🖥️"
            inactiveIcon="🖥️"
            label="Share Screen"
            accent={screenSharing}
          />
          <button
            onClick={() => setInCall(false)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{ background: "#ef4444", color: "#fff" }}
          >
            📴 End Call
          </button>
        </div>
      </div>

      {/* Right panel — AI Transcription */}
      <AnimatePresence>
        {showTranscript && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="h-full flex flex-col shrink-0 overflow-hidden"
            style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>✨ Live AI Transcription</p>
              <p className="text-xs mt-0.5" style={{ color: "#4b5563" }}>Auto-saving to Docs after call</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {transcriptItems.map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 + 0.3 }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold" style={{ color: item.speaker === "You" ? "#818cf8" : "#9ca3af" }}>
                      {item.speaker}
                    </span>
                    <span className="text-xs" style={{ color: "#374151" }}>{item.time}</span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: "#6b7280" }}>{item.text}</p>
                </motion.div>
              ))}

              {/* Typing indicator */}
              <motion.div
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                className="flex items-center gap-1.5"
              >
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#6366f1" }} />
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#6366f1" }} />
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#6366f1" }} />
                <span className="text-xs ml-1" style={{ color: "#374151" }}>AI transcribing…</span>
              </motion.div>
            </div>

            {/* Action items */}
            <div
              className="p-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <p className="text-xs font-semibold mb-3" style={{ color: "#818cf8" }}>🎯 Action Items</p>
              <div className="flex flex-col gap-2">
                {actionItems.map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div
                      className="w-4 h-4 rounded flex items-center justify-center shrink-0 mt-0.5"
                      style={{
                        background: item.done ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)",
                        border: `1px solid ${item.done ? "#10b981" : "rgba(255,255,255,0.1)"}`,
                      }}
                    >
                      {item.done && <span className="text-xs">✓</span>}
                    </div>
                    <span
                      className="text-xs leading-relaxed"
                      style={{ color: item.done ? "#4b5563" : "#9ca3af", textDecoration: item.done ? "line-through" : "none" }}
                    >
                      {item.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ControlButton({
  active,
  onClick,
  activeIcon,
  inactiveIcon,
  label,
  accent = false,
}: {
  active: boolean;
  onClick: () => void;
  activeIcon: string;
  inactiveIcon: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all"
      style={{
        background: accent ? "rgba(99,102,241,0.15)" : active ? "rgba(255,255,255,0.06)" : "rgba(239,68,68,0.1)",
        color: accent ? "#818cf8" : active ? "#9ca3af" : "#ef4444",
      }}
    >
      <span className="text-lg">{active ? activeIcon : inactiveIcon}</span>
      <span className="text-xs">{label}</span>
    </button>
  );
}
