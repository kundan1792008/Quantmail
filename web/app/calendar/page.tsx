"use client";

import { motion } from "framer-motion";
import { useState } from "react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const events = [
  { day: 5, title: "Team Standup", time: "9:00 AM", duration: "30m", color: "#6366f1" },
  { day: 7, title: "Series A Investor Demo", time: "2:00 PM", duration: "1h", color: "#10b981" },
  { day: 10, title: "Product Review", time: "11:00 AM", duration: "1h", color: "#f59e0b" },
  { day: 14, title: "Launch Planning", time: "3:00 PM", duration: "2h", color: "#ef4444" },
  { day: 21, title: "Board Meeting", time: "10:00 AM", duration: "2h", color: "#8b5cf6" },
];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

export default function CalendarPage() {
  const today = new Date();
  const [year] = useState(today.getFullYear());
  const [month] = useState(today.getMonth());
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = getDaysInMonth(year, month);

  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col h-full p-6"
      style={{ background: "#000" }}
    >
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold" style={{ color: "#f0f0f0" }}>
          {MONTHS[month]} {year}
        </h1>
        <div className="flex items-center gap-3">
          <button className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(99,102,241,0.1)", color: "#818cf8" }}>
            ✨ AI Schedule
          </button>
          <button className="text-xs px-3 py-1.5 rounded-xl" style={{ background: "#6366f1", color: "#fff" }}>
            + New Event
          </button>
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden flex-1" style={{ border: "1px solid rgba(255,255,255,0.06)", background: "#0a0a0a" }}>
        {/* Day headers */}
        <div className="grid grid-cols-7 text-center py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {DAYS.map((d) => (
            <div key={d} className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#4b5563" }}>{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 flex-1">
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`empty-${i}`} className="h-20 p-2" style={{ borderRight: "1px solid rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.04)" }} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dayEvents = events.filter((e) => e.day === day);
            const isToday = day === today.getDate() && month === today.getMonth();
            return (
              <div
                key={day}
                className="h-20 p-2 transition-colors cursor-pointer"
                style={{
                  borderRight: "1px solid rgba(255,255,255,0.04)",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  background: isToday ? "rgba(99,102,241,0.05)" : "transparent",
                }}
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs mb-1 font-medium"
                  style={{
                    background: isToday ? "#6366f1" : "transparent",
                    color: isToday ? "#fff" : "#6b7280",
                  }}
                >
                  {day}
                </div>
                {dayEvents.map((ev) => (
                  <div
                    key={ev.title}
                    className="text-xs px-1.5 py-0.5 rounded truncate"
                    style={{ background: `${ev.color}20`, color: ev.color }}
                  >
                    {ev.title}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
