"use client";

import { motion } from "framer-motion";
import { useState } from "react";

type Priority = "urgent" | "high" | "medium" | "low";

interface Task {
  id: number;
  title: string;
  description: string;
  priority: Priority;
  assignee: string;
  label: string;
  labelColor: string;
}

interface Column {
  id: string;
  title: string;
  tasks: Task[];
  accent: string;
}

const priorityConfig: Record<Priority, { label: string; color: string; bg: string }> = {
  urgent: { label: "Urgent", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  high: { label: "High", color: "#f97316", bg: "rgba(249,115,22,0.12)" },
  medium: { label: "Medium", color: "#eab308", bg: "rgba(234,179,8,0.12)" },
  low: { label: "Low", color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
};

const initialColumns: Column[] = [
  {
    id: "backlog",
    title: "Backlog",
    accent: "#374151",
    tasks: [
      { id: 1, title: "Implement biometric login flow", description: "Integrate Incode SDK for liveness detection", priority: "high", assignee: "R", label: "Backend", labelColor: "#6366f1" },
      { id: 2, title: "Design new onboarding screens", description: "3-step flow with animated transitions", priority: "medium", assignee: "P", label: "Design", labelColor: "#8b5cf6" },
    ],
  },
  {
    id: "todo",
    title: "To Do",
    accent: "#6366f1",
    tasks: [
      { id: 3, title: "AI command palette integration", description: "Connect to orchestrator API", priority: "urgent", assignee: "R", label: "Feature", labelColor: "#10b981" },
      { id: 4, title: "Push notification service", description: "FCM + APNs setup with rate limiting", priority: "high", assignee: "A", label: "Backend", labelColor: "#6366f1" },
    ],
  },
  {
    id: "in-progress",
    title: "In Progress",
    accent: "#f59e0b",
    tasks: [
      { id: 5, title: "Kanban board drag-and-drop", description: "Using react-dnd with smooth animations", priority: "high", assignee: "N", label: "Frontend", labelColor: "#ec4899" },
      { id: 6, title: "Real-time chat with WebSockets", description: "Channel + DM support, presence indicators", priority: "urgent", assignee: "R", label: "Feature", labelColor: "#10b981" },
    ],
  },
  {
    id: "done",
    title: "Done",
    accent: "#10b981",
    tasks: [
      { id: 7, title: "Database schema v3", description: "Prisma models for all 9 apps", priority: "medium", assignee: "R", label: "Backend", labelColor: "#6366f1" },
      { id: 8, title: "Premium landing page", description: "Dark mode, Framer Motion hero section", priority: "low", assignee: "P", label: "Design", labelColor: "#8b5cf6" },
    ],
  },
];

export default function TasksPage() {
  const [columns] = useState<Column[]>(initialColumns);

  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="flex flex-col h-full"
      style={{ background: "#000" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div>
          <h1 className="text-base font-semibold" style={{ color: "#f0f0f0" }}>Tasks</h1>
          <p className="text-xs mt-0.5" style={{ color: "#4b5563" }}>Quant Workspace Sprint 3</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(99,102,241,0.1)", color: "#818cf8" }}>
            ✨ AI Sprint Plan
          </button>
          <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg" style={{ background: "#6366f1", color: "#fff" }}>
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M12 3.75a.75.75 0 01.75.75v6.75h6.75a.75.75 0 010 1.5h-6.75v6.75a.75.75 0 01-1.5 0v-6.75H4.5a.75.75 0 010-1.5h6.75V4.5a.75.75 0 01.75-.75z" clipRule="evenodd" />
            </svg>
            New Task
          </button>
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-4 p-6 h-full min-w-max">
          {columns.map((col, colIdx) => (
            <motion.div
              key={col.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: colIdx * 0.08 }}
              className="flex flex-col w-72 shrink-0 rounded-2xl overflow-hidden"
              style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              {/* Column header */}
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: col.accent }} />
                  <span className="text-sm font-semibold" style={{ color: "#e5e7eb" }}>{col.title}</span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "#6b7280" }}>
                  {col.tasks.length}
                </span>
              </div>

              {/* Tasks */}
              <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">
                {col.tasks.map((task, taskIdx) => {
                  const p = priorityConfig[task.priority];
                  return (
                    <motion.div
                      key={task.id}
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: colIdx * 0.08 + taskIdx * 0.04 }}
                      className="kanban-card p-3 rounded-xl cursor-pointer"
                      style={{
                        background: "#111",
                        border: "1px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      {/* Priority + label row */}
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className="text-xs px-1.5 py-0.5 rounded font-medium"
                          style={{ background: p.bg, color: p.color }}
                        >
                          {p.label}
                        </span>
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{ background: `${task.labelColor}18`, color: task.labelColor }}
                        >
                          {task.label}
                        </span>
                      </div>

                      {/* Title */}
                      <p className="text-sm font-medium mb-1 leading-snug" style={{ color: "#f0f0f0" }}>
                        {task.title}
                      </p>
                      <p className="text-xs mb-3 leading-relaxed" style={{ color: "#4b5563" }}>
                        {task.description}
                      </p>

                      {/* Assignee + drag hint */}
                      <div className="flex items-center justify-between">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "#1f2937", color: "#9ca3af" }}>
                          {task.assignee}
                        </div>
                        <div className="flex gap-1">
                          <div className="w-1 h-1 rounded-full" style={{ background: "#374151" }} />
                          <div className="w-1 h-1 rounded-full" style={{ background: "#374151" }} />
                          <div className="w-1 h-1 rounded-full" style={{ background: "#374151" }} />
                        </div>
                      </div>
                    </motion.div>
                  );
                })}

                {/* Add task button */}
                <button
                  className="w-full py-2 rounded-xl text-xs text-center transition-colors"
                  style={{
                    background: "transparent",
                    border: "1px dashed rgba(255,255,255,0.06)",
                    color: "#374151",
                  }}
                >
                  + Add task
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
