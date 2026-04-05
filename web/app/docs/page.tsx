"use client";

import { motion } from "framer-motion";
import { useState } from "react";

export default function DocsPage() {
  const [content, setContent] = useState(
    `# Quant Workspace — Product Brief

## Vision

Build the world's first **AI-native workspace** that makes every user 10x more productive. We replace Gmail, Notion, Slack, Zoom, and Linear — all with one coherent, beautiful interface.

## The Problem

Knowledge workers waste **3-4 hours/day** switching between tools. Each tool has its own login, data silo, and UX paradigm.

## Our Solution

A single, biometric-authenticated workspace where AI understands context across all your apps — email, calendar, docs, sheets, chat, tasks, notes, and meetings.

## Key Differentiators

1. **Biometric SSO** — One liveness check, access to everything
2. **AI Orchestrator** — Cross-app intelligence (e.g., "Summarize emails from last week and add to my Q4 doc")
3. **Viral Growth Loops** — Built-in referral mechanics

## Metrics (Beta)

| Metric | Value |
|--------|-------|
| Beta Users | 3,200 |
| Weekly Active | 87% |
| AI Actions/Month | 45,000 |
| NPS Score | 72 |
`
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col h-full"
      style={{ background: "#000" }}
    >
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-6 py-3 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>Product Brief</h1>
          <span className="text-xs" style={{ color: "#374151" }}>Auto-saved</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(99,102,241,0.1)", color: "#818cf8" }}>
            ✨ AI Ghostwrite
          </button>
          <button className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "#6366f1", color: "#fff" }}>
            Share
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto px-12 py-8 max-w-3xl w-full mx-auto">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full min-h-full bg-transparent outline-none text-sm leading-relaxed resize-none font-mono"
          style={{ color: "#9ca3af", caretColor: "#6366f1" }}
          spellCheck={false}
        />
      </div>
    </motion.div>
  );
}
