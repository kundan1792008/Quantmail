"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import SmartComposeUI from "../components/SmartComposeUI";

const mockEmails = [
  {
    id: 1,
    from: "Rahul Sharma",
    email: "rahul@acme.com",
    subject: "Q4 Revenue Report — Final Review",
    preview: "Please review the attached PDF before the board meeting tomorrow at 9AM…",
    time: "9:41 AM",
    unread: true,
    tag: "Important",
    tagColor: "#ef4444",
  },
  {
    id: 2,
    from: "Priya Singh",
    email: "priya@design.io",
    subject: "New design mockups for Quant v3",
    preview: "Hi, I've uploaded the Figma link. The new color palette looks stunning…",
    time: "8:12 AM",
    unread: true,
    tag: "Design",
    tagColor: "#8b5cf6",
  },
  {
    id: 3,
    from: "Alex Johnson",
    email: "alex@venture.vc",
    subject: "Re: Series A Term Sheet",
    preview: "We're excited about the progress. Here's our updated term sheet…",
    time: "Yesterday",
    unread: false,
    tag: "Finance",
    tagColor: "#10b981",
  },
  {
    id: 4,
    from: "GitHub",
    email: "noreply@github.com",
    subject: "[Quantmail] PR #47 merged — Phase 10 complete",
    preview: "Your pull request was successfully merged into main…",
    time: "Yesterday",
    unread: false,
    tag: "Dev",
    tagColor: "#6366f1",
  },
  {
    id: 5,
    from: "Neha Patel",
    email: "neha@marketing.co",
    subject: "Launch campaign assets ready",
    preview: "All assets are uploaded to Drive. Social media posts scheduled for Monday…",
    time: "Mon",
    unread: false,
    tag: "Marketing",
    tagColor: "#f59e0b",
  },
];

export default function MailPage() {
  const [selected, setSelected] = useState(mockEmails[0]);
  const [composing, setComposing] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");

  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="flex h-full"
      style={{ background: "#000" }}
    >
      {/* Email list */}
      <div
        className="w-80 h-full flex flex-col shrink-0"
        style={{ borderRight: "1px solid rgba(255,255,255,0.06)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <h1 className="text-base font-semibold" style={{ color: "#f0f0f0" }}>Inbox</h1>
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "#6366f1", color: "#fff" }}>
              2
            </span>
            <button
              onClick={() => setComposing(true)}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
              style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.05)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth={1.5} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <span className="text-xs" style={{ color: "#4b5563" }}>Search emails…</span>
          </div>
        </div>

        {/* Email list */}
        <div className="flex-1 overflow-y-auto">
          {mockEmails.map((email, i) => (
            <motion.button
              key={email.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => setSelected(email)}
              className="w-full text-left px-4 py-3 transition-colors"
              style={{
                background: selected.id === email.id ? "rgba(99,102,241,0.1)" : "transparent",
                borderLeft: selected.id === email.id ? "2px solid #6366f1" : "2px solid transparent",
              }}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span
                  className="text-sm font-medium truncate"
                  style={{ color: email.unread ? "#f0f0f0" : "#9ca3af" }}
                >
                  {email.from}
                </span>
                <span className="text-xs shrink-0" style={{ color: "#4b5563" }}>{email.time}</span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                {email.unread && (
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#6366f1" }} />
                )}
                <span className="text-xs font-medium truncate" style={{ color: email.unread ? "#e5e7eb" : "#6b7280" }}>
                  {email.subject}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs truncate" style={{ color: "#4b5563" }}>{email.preview}</span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded shrink-0 ml-2"
                  style={{ background: `${email.tagColor}20`, color: email.tagColor, fontSize: "10px" }}
                >
                  {email.tag}
                </span>
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Email detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {composing ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 flex flex-col p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold" style={{ color: "#f0f0f0" }}>New Message</h2>
              <button onClick={() => setComposing(false)} style={{ color: "#6b7280" }}>✕</button>
            </div>
            <div className="flex flex-col gap-3 flex-1 rounded-2xl p-4" style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)" }}>
              <input
                placeholder="To"
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
                className="bg-transparent outline-none text-sm py-2"
                style={{ color: "#f0f0f0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
              />
              <input
                placeholder="Subject"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                className="bg-transparent outline-none text-sm py-2"
                style={{ color: "#f0f0f0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
              />
              <SmartComposeUI
                subject={composeSubject}
                recipientEmail={composeTo}
                recipientName={composeTo.split("@")[0] ?? composeTo}
                userEmail="me@quantmail.app"
                placeholder="Write your message…"
                className="flex-1"
              />
              <div className="flex items-center justify-between pt-2">
                <button className="px-4 py-2 rounded-xl text-sm font-medium" style={{ background: "#6366f1", color: "#fff" }}>Send</button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key={selected.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="flex-1 flex flex-col overflow-y-auto p-6"
          >
            <div className="mb-6">
              <div className="flex items-start justify-between mb-2">
                <h2 className="text-xl font-semibold" style={{ color: "#f0f0f0" }}>{selected.subject}</h2>
                <button className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(99,102,241,0.1)", color: "#818cf8" }}>
                  ✨ AI Summarize
                </button>
              </div>
              <div className="flex items-center gap-3 text-sm" style={{ color: "#6b7280" }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "#374151" }}>
                  {selected.from[0]}
                </div>
                <div>
                  <span style={{ color: "#9ca3af" }}>{selected.from}</span>
                  <span className="ml-1" style={{ color: "#4b5563" }}>&lt;{selected.email}&gt;</span>
                </div>
                <span className="ml-auto">{selected.time}</span>
              </div>
            </div>
            <div className="flex-1 text-sm leading-relaxed" style={{ color: "#9ca3af" }}>
              <p className="mb-4">{selected.preview}</p>
              <p className="mb-4">
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.
              </p>
              <p>
                Best regards,<br />
                <span style={{ color: "#e5e7eb" }}>{selected.from}</span>
              </p>
            </div>
            <div className="flex items-center gap-3 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <button className="px-4 py-2 rounded-xl text-sm font-medium" style={{ background: "rgba(255,255,255,0.06)", color: "#f0f0f0" }}>
                ↩ Reply
              </button>
              <button className="px-4 py-2 rounded-xl text-sm font-medium" style={{ background: "rgba(255,255,255,0.06)", color: "#f0f0f0" }}>
                → Forward
              </button>
              <button className="ml-auto text-xs px-3 py-2 rounded-lg" style={{ background: "rgba(99,102,241,0.1)", color: "#818cf8" }}>
                ✨ AI Reply
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
