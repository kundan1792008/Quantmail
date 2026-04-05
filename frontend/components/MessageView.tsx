"use client";

import { Email } from "@/lib/mockData";
import SmartReply from "./SmartReply";

interface MessageViewProps {
  email: Email | null;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function MessageView({ email }: MessageViewProps) {
  if (!email) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="w-16 h-16 rounded-2xl bg-surface-card border border-surface-border flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v.906a2.25 2.25 0 0 1-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 0 0 1.183 1.981l6.478 3.488m8.839 2.51-4.66-2.51m0 0-1.023-.55a2.25 2.25 0 0 0-2.134 0l-1.022.55m0 0-4.661 2.51m16.5 1.615a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V8.844a2.25 2.25 0 0 1 1.183-1.981l7.5-4.039a2.25 2.25 0 0 1 2.134 0l7.5 4.039a2.25 2.25 0 0 1 1.183 1.98V19.5Z" />
          </svg>
        </div>
        <p className="text-gray-400 font-medium text-sm">Select an email to read</p>
        <p className="text-gray-600 text-xs mt-1">Choose a message from the list on the left</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Email header */}
      <div className="flex-none px-6 py-5 border-b border-surface-border">
        <h1 className="text-lg font-semibold text-gray-100 mb-3 leading-tight">
          {email.subject}
        </h1>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center text-xs font-bold text-white shadow shadow-accent/20">
              {getInitials(email.from)}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-200">{email.from}</p>
              <p className="text-xs text-gray-500">{email.fromEmail}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{email.date}</span>
            {email.starred && (
              <svg className="w-4 h-4 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z" clipRule="evenodd" />
              </svg>
            )}
          </div>
        </div>
        {email.labels.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {email.labels.map((label) => (
              <span
                key={label}
                className="text-[11px] px-2 py-0.5 rounded-full bg-surface-hover border border-surface-border text-gray-400 font-medium"
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Action toolbar */}
      <div className="flex-none flex items-center gap-1 px-5 py-2.5 border-b border-surface-border/50">
        {[
          {
            label: "Reply",
            icon: (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
              </svg>
            ),
          },
          {
            label: "Forward",
            icon: (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15 15 6-6m0 0-6-6m6 6H9a6 6 0 0 0 0 12h3" />
              </svg>
            ),
          },
          {
            label: "Archive",
            icon: (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
              </svg>
            ),
          },
          {
            label: "Delete",
            icon: (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            ),
          },
        ].map(({ label, icon }) => (
          <button
            key={label}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-surface-hover transition-colors"
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Email body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-2xl">
          <pre className="text-sm text-gray-300 leading-7 whitespace-pre-wrap font-sans">
            {email.body}
          </pre>
        </div>
      </div>

      {/* Smart Reply component at the bottom */}
      <SmartReply
        emailBody={email.body}
        emailFrom={email.from}
        emailSubject={email.subject}
      />
    </div>
  );
}
