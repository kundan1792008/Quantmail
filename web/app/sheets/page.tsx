"use client";

import { motion } from "framer-motion";
import { useState } from "react";

const initialData = [
  ["Month", "Revenue ($)", "Users", "AI Actions", "NPS"],
  ["October", "12,400", "1,200", "8,500", "68"],
  ["November", "28,700", "2,100", "19,200", "71"],
  ["December", "51,300", "3,200", "45,000", "72"],
  ["January (proj)", "84,000", "5,000", "78,000", "75"],
  ["February (proj)", "130,000", "8,200", "120,000", "77"],
];

export default function SheetsPage() {
  const [data, setData] = useState(initialData);
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleCellClick = (r: number, c: number) => {
    setSelected([r, c]);
    setEditValue(data[r][c]);
  };

  const handleCellChange = (value: string) => {
    setEditValue(value);
    if (selected) {
      const newData = data.map((row, ri) =>
        row.map((cell, ci) => (ri === selected[0] && ci === selected[1] ? value : cell))
      );
      setData(newData);
    }
  };

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
        <h1 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>Revenue Tracker</h1>
        <div className="flex items-center gap-2">
          <button className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(99,102,241,0.1)", color: "#818cf8" }}>
            ✨ AI Formula
          </button>
          <button className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.05)", color: "#9ca3af" }}>
            Export
          </button>
        </div>
      </div>

      {/* Formula bar */}
      <div className="flex items-center gap-3 px-4 py-2 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <span
          className="text-xs px-2 py-1 rounded font-mono"
          style={{ background: "rgba(255,255,255,0.05)", color: "#6b7280", minWidth: "40px", textAlign: "center" }}
        >
          {selected ? `${String.fromCharCode(65 + selected[1])}${selected[0] + 1}` : ""}
        </span>
        <input
          value={editValue}
          onChange={(e) => handleCellChange(e.target.value)}
          placeholder="Select a cell…"
          className="flex-1 bg-transparent outline-none text-xs font-mono"
          style={{ color: "#9ca3af" }}
        />
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <tbody>
            {data.map((row, ri) => (
              <tr key={ri}>
                {/* Row number */}
                <td
                  className="px-2 py-2 text-center select-none"
                  style={{
                    background: "#0a0a0a",
                    borderRight: "1px solid rgba(255,255,255,0.06)",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    color: "#374151",
                    minWidth: "36px",
                    fontSize: "10px",
                  }}
                >
                  {ri + 1}
                </td>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    onClick={() => handleCellClick(ri, ci)}
                    className="px-3 py-2 cursor-cell transition-colors"
                    style={{
                      background:
                        selected && selected[0] === ri && selected[1] === ci
                          ? "rgba(99,102,241,0.12)"
                          : ri === 0
                          ? "#0a0a0a"
                          : "transparent",
                      borderRight: "1px solid rgba(255,255,255,0.04)",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      color: ri === 0 ? "#6b7280" : "#9ca3af",
                      fontWeight: ri === 0 ? "600" : "400",
                      outline:
                        selected && selected[0] === ri && selected[1] === ci
                          ? "2px solid #6366f1"
                          : "none",
                      outlineOffset: "-1px",
                      minWidth: "120px",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
