"use client";

import { Email } from "@/lib/mockData";

interface MessageListProps {
  emails: Email[];
  selectedId: string | null;
  onSelect: (email: Email) => void;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const labelColors: Record<string, string> = {
  Work: "bg-blue-900/60 text-blue-300",
  "Action Required": "bg-red-900/50 text-red-300",
  Design: "bg-purple-900/50 text-purple-300",
  GitHub: "bg-gray-700 text-gray-300",
  Investors: "bg-yellow-900/50 text-yellow-300",
  DevOps: "bg-green-900/50 text-green-300",
  Feedback: "bg-teal-900/50 text-teal-300",
};

export default function MessageList({ emails, selectedId, onSelect }: MessageListProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-surface-border">
        <h2 className="text-sm font-semibold text-gray-200">Inbox</h2>
        <span className="text-xs text-gray-500">{emails.filter((e) => !e.read).length} unread</span>
      </div>

      {/* Search bar */}
      <div className="px-3 py-2.5 border-b border-surface-border">
        <div className="flex items-center gap-2 bg-surface-hover rounded-lg px-3 py-2">
          <svg className="w-4 h-4 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            placeholder="Search emails..."
            className="flex-1 bg-transparent text-sm text-gray-300 placeholder-gray-600 outline-none"
          />
        </div>
      </div>

      {/* Email list */}
      <ul className="flex-1 overflow-y-auto divide-y divide-surface-border/50">
        {emails.map((email) => {
          const isSelected = selectedId === email.id;
          return (
            <li key={email.id}>
              <button
                onClick={() => onSelect(email)}
                className={`
                  w-full text-left px-4 py-3.5 transition-colors flex gap-3 items-start
                  ${isSelected
                    ? "bg-accent/10 border-l-2 border-accent"
                    : "hover:bg-surface-hover border-l-2 border-transparent"
                  }
                `}
              >
                {/* Avatar */}
                <div className={`
                  shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold
                  ${isSelected ? "bg-accent text-white" : "bg-surface-border text-gray-300"}
                `}>
                  {getInitials(email.from)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className={`text-sm truncate ${email.read ? "text-gray-400 font-normal" : "text-gray-100 font-semibold"}`}>
                      {email.from}
                    </span>
                    <span className="text-xs text-gray-600 shrink-0">{email.date}</span>
                  </div>
                  <p className={`text-xs truncate mb-1 ${email.read ? "text-gray-500" : "text-gray-300"}`}>
                    {email.subject}
                  </p>
                  <p className="text-xs text-gray-600 truncate leading-relaxed">
                    {email.preview}
                  </p>
                  {email.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {email.labels.map((label) => (
                        <span
                          key={label}
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${labelColors[label] ?? "bg-surface-border text-gray-400"}`}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Unread dot */}
                {!email.read && (
                  <div className="shrink-0 mt-1.5 w-2 h-2 rounded-full bg-accent" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
