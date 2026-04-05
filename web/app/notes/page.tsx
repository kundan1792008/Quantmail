"use client";

import { motion } from "framer-motion";
import { useState } from "react";

interface Note {
  id: number;
  title: string;
  preview: string;
  content: string;
  time: string;
  tag: string;
  tagColor: string;
  pinned?: boolean;
}

const mockNotes: Note[] = [
  {
    id: 1,
    title: "Product Roadmap Q4 2025",
    preview: "Key milestones: Launch Chat feature, integrate AI Orchestrator…",
    content: `# Product Roadmap Q4 2025

## Key Milestones

- **October:** Launch Chat (Slack killer) with AI Thread Summary
- **November:** Deploy Tasks Kanban + AI Sprint Planning
- **December:** Full production launch with 9-app workspace

## Success Metrics

- 10,000 DAUs by December 31
- $50k MRR from Premium tier
- NPS score > 70

## AI Features Priority

1. Command Palette (Cmd+K) — shipped ✅
2. Email AI Summarize — shipped ✅
3. Meeting transcription — in progress
4. Autonomous co-pilot replies — Q1 2026`,
    time: "Today 9:41 AM",
    tag: "Product",
    tagColor: "#6366f1",
    pinned: true,
  },
  {
    id: 2,
    title: "Investor Pitch Notes",
    preview: "Series A — target: $5M at $25M valuation. Key metrics to highlight…",
    content: `# Investor Pitch Notes

## Series A Target
- Raise: $5M
- Valuation: $25M pre-money
- Use of funds: Hire 5 engineers + marketing

## Key Metrics to Highlight
- 3,200 beta users (0 churn)
- 87% weekly active usage
- AI actions: 45,000/month

## Competitive Moat
We're not just a productivity tool — we're the **first biometric AI workspace** that adapts to your identity.`,
    time: "Yesterday",
    tag: "Business",
    tagColor: "#10b981",
  },
  {
    id: 3,
    title: "Architecture decisions log",
    preview: "Chose Fastify over Express for 3x throughput. Prisma SQLite for dev…",
    content: `# Architecture Decisions Log

## Backend
- **Framework:** Fastify (3x throughput vs Express)
- **Database:** Prisma + SQLite (dev) → Postgres (prod)
- **Auth:** JWT + Biometric liveness hash

## Frontend
- **Framework:** Next.js 16 App Router
- **Styling:** Tailwind CSS v4
- **Animations:** Framer Motion

## Infra
- Docker + deploy.sh script
- Redis for rate limiting (optional)
- BullMQ for email queues`,
    time: "Mon",
    tag: "Engineering",
    tagColor: "#8b5cf6",
  },
  {
    id: 4,
    title: "Meeting notes — Team sync",
    preview: "Action items: Rahul → finish AI router, Priya → new onboarding…",
    content: `# Team Sync — April 5

## Attendees
Rahul, Priya, Alex, Neha

## Updates
- AI Orchestrator: 90% done
- Design system: tokens finalized
- Push notifications: live in staging

## Action Items
- [ ] Rahul: finish AI router integration
- [ ] Priya: new onboarding flow mockups
- [ ] Alex: investor deck v3
- [ ] Neha: schedule launch campaign`,
    time: "Mon",
    tag: "Meeting",
    tagColor: "#f59e0b",
  },
];

export default function NotesPage() {
  const [selected, setSelected] = useState(mockNotes[0]);
  const [isPolishing, setIsPolishing] = useState(false);
  const [editContent, setEditContent] = useState(selected.content);
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = mockNotes.filter(
    (n) =>
      n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.preview.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelect = (note: Note) => {
    setSelected(note);
    setEditContent(note.content);
  };

  const handleAIPolish = async () => {
    setIsPolishing(true);
    await new Promise((r) => setTimeout(r, 1500));
    setEditContent((prev) => prev + "\n\n---\n*✨ AI has polished this note — grammar corrected, structure improved, key points highlighted.*");
    setIsPolishing(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="flex h-full"
      style={{ background: "#000" }}
    >
      {/* Note list pane */}
      <div
        className="w-72 h-full flex flex-col shrink-0"
        style={{ borderRight: "1px solid rgba(255,255,255,0.06)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <h1 className="text-base font-semibold" style={{ color: "#f0f0f0" }}>Notes</h1>
          <button
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth={1.5} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes…"
              className="flex-1 bg-transparent outline-none text-xs"
              style={{ color: "#9ca3af" }}
            />
          </div>
        </div>

        {/* Note list */}
        <div className="flex-1 overflow-y-auto py-1">
          {filtered.map((note, i) => (
            <motion.button
              key={note.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => handleSelect(note)}
              className="w-full text-left px-4 py-3 transition-colors"
              style={{
                background: selected.id === note.id ? "rgba(99,102,241,0.1)" : "transparent",
                borderLeft: selected.id === note.id ? "2px solid #6366f1" : "2px solid transparent",
              }}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-sm font-medium truncate" style={{ color: selected.id === note.id ? "#e5e7eb" : "#9ca3af" }}>
                  {note.pinned && <span className="mr-1">📌</span>}
                  {note.title}
                </span>
              </div>
              <p className="text-xs truncate mb-1.5" style={{ color: "#4b5563" }}>{note.preview}</p>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "#374151" }}>{note.time}</span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{ background: `${note.tagColor}18`, color: note.tagColor, fontSize: "10px" }}
                >
                  {note.tag}
                </span>
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Editor pane */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Editor header */}
        <div
          className="flex items-center justify-between px-6 py-3 shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="flex items-center gap-3">
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{ background: `${selected.tagColor}18`, color: selected.tagColor }}
            >
              {selected.tag}
            </span>
            <span className="text-xs" style={{ color: "#374151" }}>{selected.time}</span>
          </div>
          <button
            onClick={handleAIPolish}
            disabled={isPolishing}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
            style={{
              background: "rgba(99,102,241,0.1)",
              color: "#818cf8",
              border: "1px solid rgba(99,102,241,0.2)",
              opacity: isPolishing ? 0.7 : 1,
            }}
          >
            {isPolishing ? (
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                  className="w-3 h-3 rounded-full"
                  style={{ border: "1.5px solid rgba(99,102,241,0.3)", borderTop: "1.5px solid #818cf8" }}
                />
                Polishing…
              </>
            ) : (
              <>✨ AI Polish</>
            )}
          </button>
        </div>

        {/* Content */}
        <motion.div
          key={selected.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="flex-1 overflow-y-auto px-8 py-6"
        >
          <h2
            className="text-2xl font-semibold mb-6"
            style={{ color: "#f0f0f0" }}
          >
            {selected.title}
          </h2>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full min-h-96 bg-transparent outline-none text-sm leading-relaxed resize-none font-mono"
            style={{ color: "#9ca3af", caretColor: "#6366f1" }}
            spellCheck={false}
          />
        </motion.div>
      </div>
    </motion.div>
  );
}
