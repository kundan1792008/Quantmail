"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import MessageList from "@/components/MessageList";
import MessageView from "@/components/MessageView";
import { mockEmails, type Email } from "@/lib/mockData";

export default function InboxPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeNav, setActiveNav] = useState("inbox");
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(mockEmails[0] ?? null);
  const [showMessageView, setShowMessageView] = useState(false);

  const handleSelectEmail = (email: Email) => {
    setSelectedEmail(email);
    // On mobile, switch to message view when an email is selected
    setShowMessageView(true);
  };

  const handleBackToList = () => {
    setShowMessageView(false);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      {/* Sidebar */}
      <Sidebar
        activeNav={activeNav}
        onNavChange={setActiveNav}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Message list pane */}
        <div
          className={`
            flex-none w-full md:w-80 lg:w-96 border-r border-surface-border bg-surface flex flex-col overflow-hidden
            ${showMessageView ? "hidden md:flex" : "flex"}
          `}
        >
          {/* Mobile top bar */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-border md:hidden">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-surface-hover transition-colors"
              aria-label="Open menu"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            <span className="text-sm font-semibold text-gray-200">Quantmail</span>
          </div>

          {/* Desktop top bar with hamburger */}
          <div className="hidden md:flex items-center gap-2 px-4 py-3 border-b border-surface-border/50">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-surface-hover transition-colors md:hidden lg:flex"
              aria-label="Toggle sidebar"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-hidden">
            <MessageList
              emails={mockEmails}
              selectedId={selectedEmail?.id ?? null}
              onSelect={handleSelectEmail}
            />
          </div>
        </div>

        {/* Active message view pane */}
        <div
          className={`
            flex-1 flex flex-col overflow-hidden bg-surface
            ${showMessageView ? "flex" : "hidden md:flex"}
          `}
        >
          {/* Mobile back button */}
          {showMessageView && (
            <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-border md:hidden">
              <button
                onClick={handleBackToList}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-surface-hover transition-colors"
                aria-label="Back to inbox"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                </svg>
              </button>
              <span className="text-sm font-medium text-gray-300">Back to Inbox</span>
            </div>
          )}

          <MessageView email={selectedEmail} />
        </div>
      </div>
    </div>
  );
}
