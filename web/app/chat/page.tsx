"use client";

import { motion } from "framer-motion";
import { useState } from "react";

const channels = [
  { id: "general", name: "general", unread: 3 },
  { id: "engineering", name: "engineering", unread: 0 },
  { id: "design", name: "design", unread: 7 },
  { id: "product", name: "product", unread: 1 },
  { id: "random", name: "random", unread: 0 },
];

const dms = [
  { id: "rahul", name: "Rahul Sharma", status: "online", unread: 2 },
  { id: "priya", name: "Priya Singh", status: "online", unread: 0 },
  { id: "alex", name: "Alex Johnson", status: "away", unread: 0 },
  { id: "neha", name: "Neha Patel", status: "offline", unread: 1 },
];

const statusColor: Record<string, string> = {
  online: "#10b981",
  away: "#f59e0b",
  offline: "#374151",
};

const mockMessages = [
  { id: 1, author: "Rahul Sharma", time: "9:41 AM", text: "Just pushed the final build! The performance improvements are insane 🚀", avatar: "R" },
  { id: 2, author: "Priya Singh", time: "9:43 AM", text: "The new UI looks absolutely stunning. Sent the Figma link to everyone.", avatar: "P" },
  { id: 3, author: "Alex Johnson", time: "9:45 AM", text: "VCs are super impressed. Can we do a demo call tomorrow at 10AM?", avatar: "A" },
  { id: 4, author: "Neha Patel", time: "9:47 AM", text: "Marketing assets are all ready. Social posts go live on Monday 🎯", avatar: "N" },
  { id: 5, author: "Rahul Sharma", time: "9:50 AM", text: "Let's ship it. We've built something the world has never seen before.", avatar: "R" },
];

export default function ChatPage() {
  const [activeChannel, setActiveChannel] = useState("general");
  const [activeDM, setActiveDM] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [showAISummary, setShowAISummary] = useState(false);

  const currentTitle = activeDM
    ? dms.find((d) => d.id === activeDM)?.name
    : `#${activeChannel}`;

  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="flex h-full"
      style={{ background: "#000" }}
    >
      {/* Left sidebar */}
      <div
        className="w-56 h-full flex flex-col shrink-0 py-4"
        style={{ borderRight: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="px-4 mb-4">
          <h1 className="text-base font-semibold" style={{ color: "#f0f0f0" }}>Quant Chat</h1>
          <p className="text-xs mt-0.5" style={{ color: "#4b5563" }}>workspace</p>
        </div>

        {/* Channels */}
        <div className="mb-4">
          <p className="px-4 text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: "#374151" }}>
            Channels
          </p>
          {channels.map((ch) => (
            <button
              key={ch.id}
              onClick={() => { setActiveChannel(ch.id); setActiveDM(null); }}
              className="w-full flex items-center justify-between px-4 py-1.5 text-sm transition-colors"
              style={{
                background: activeChannel === ch.id && !activeDM ? "rgba(99,102,241,0.1)" : "transparent",
                color: activeChannel === ch.id && !activeDM ? "#818cf8" : "#6b7280",
              }}
            >
              <span># {ch.name}</span>
              {ch.unread > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "#6366f1", color: "#fff", fontSize: "10px" }}>
                  {ch.unread}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* DMs */}
        <div>
          <p className="px-4 text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: "#374151" }}>
            Direct Messages
          </p>
          {dms.map((dm) => (
            <button
              key={dm.id}
              onClick={() => { setActiveDM(dm.id); }}
              className="w-full flex items-center gap-2.5 px-4 py-1.5 text-sm transition-colors"
              style={{
                background: activeDM === dm.id ? "rgba(99,102,241,0.1)" : "transparent",
                color: activeDM === dm.id ? "#818cf8" : "#6b7280",
              }}
            >
              <div className="relative">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "#1f2937" }}>
                  {dm.name[0]}
                </div>
                <div
                  className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
                  style={{ background: statusColor[dm.status], border: "1.5px solid #000" }}
                />
              </div>
              <span className="flex-1 truncate text-left">{dm.name}</span>
              {dm.unread > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "#6366f1", color: "#fff", fontSize: "10px" }}>
                  {dm.unread}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Chat header */}
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>{currentTitle}</h2>
            <p className="text-xs" style={{ color: "#4b5563" }}>
              {activeDM ? "Direct message" : `${mockMessages.length} members`}
            </p>
          </div>
          <button
            onClick={() => setShowAISummary((v) => !v)}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
            style={{
              background: showAISummary ? "rgba(99,102,241,0.2)" : "rgba(99,102,241,0.1)",
              color: "#818cf8",
              border: "1px solid rgba(99,102,241,0.3)",
            }}
          >
            ✨ AI Thread Summary
          </button>
        </div>

        {/* AI Summary panel */}
        {showAISummary && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-5 py-3"
            style={{ background: "rgba(99,102,241,0.06)", borderBottom: "1px solid rgba(99,102,241,0.15)" }}
          >
            <p className="text-xs font-semibold mb-1" style={{ color: "#818cf8" }}>✨ AI Thread Summary</p>
            <p className="text-xs leading-relaxed" style={{ color: "#9ca3af" }}>
              The team finalized the build with major performance improvements. Design assets and Figma files were shared. Investor interest confirmed — demo call scheduled for tomorrow at 10AM. Marketing launch assets ready for Monday.
            </p>
          </motion.div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {mockMessages.map((msg, i) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="flex items-start gap-3 group"
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0" style={{ background: "#1f2937", color: "#9ca3af" }}>
                {msg.avatar}
              </div>
              <div className="flex-1">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-sm font-semibold" style={{ color: "#e5e7eb" }}>{msg.author}</span>
                  <span className="text-xs" style={{ color: "#374151" }}>{msg.time}</span>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: "#9ca3af" }}>{msg.text}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Message input */}
        <div className="px-5 py-4 shrink-0">
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{ background: "#111", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Message ${currentTitle}`}
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: "#f0f0f0" }}
              onKeyDown={(e) => { if (e.key === "Enter") setMessage(""); }}
            />
            <button className="text-xs px-2 py-1 rounded-lg" style={{ background: "rgba(99,102,241,0.1)", color: "#818cf8" }}>
              ✨
            </button>
            <button className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#6366f1" }}>
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-white">
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
