"use client";

import { motion } from "framer-motion";

const files = [
  { name: "Q4 Revenue Report.pdf", type: "pdf", size: "2.4 MB", modified: "Today", color: "#ef4444" },
  { name: "Product Roadmap v3.fig", type: "figma", size: "8.1 MB", modified: "Yesterday", color: "#8b5cf6" },
  { name: "Investor Deck.pptx", type: "pptx", size: "12.3 MB", modified: "Mon", color: "#f97316" },
  { name: "Architecture.png", type: "image", size: "1.8 MB", modified: "Mon", color: "#10b981" },
  { name: "Data Export.csv", type: "csv", size: "540 KB", modified: "Last week", color: "#6366f1" },
  { name: "Team Photos.zip", type: "zip", size: "234 MB", modified: "2 weeks ago", color: "#6b7280" },
];

export default function DrivePage() {
  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col h-full p-6"
      style={{ background: "#000" }}
    >
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold" style={{ color: "#f0f0f0" }}>Drive</h1>
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth={1.5} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <span className="text-xs" style={{ color: "#4b5563" }}>Search files…</span>
          </div>
          <button className="text-xs px-3 py-1.5 rounded-xl" style={{ background: "#6366f1", color: "#fff" }}>
            ↑ Upload
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {files.map((file, i) => (
          <motion.div
            key={file.name}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="p-4 rounded-2xl cursor-pointer transition-all"
            style={{
              background: "#0a0a0a",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
            whileHover={{ scale: 1.02, borderColor: "rgba(99,102,241,0.3)" }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-lg mb-3"
              style={{ background: `${file.color}15` }}
            >
              {file.type === "pdf" ? "📄" : file.type === "figma" ? "🎨" : file.type === "pptx" ? "📊" : file.type === "image" ? "🖼️" : file.type === "csv" ? "📈" : "📦"}
            </div>
            <p className="text-sm font-medium truncate mb-1" style={{ color: "#e5e7eb" }}>{file.name}</p>
            <p className="text-xs" style={{ color: "#4b5563" }}>{file.size} · {file.modified}</p>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
