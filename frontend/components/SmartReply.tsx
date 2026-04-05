"use client";

import { useState, useCallback } from "react";

interface SmartReplyProps {
  emailBody: string;
  emailFrom: string;
  emailSubject: string;
}

type ReplyState = "idle" | "loading" | "ready" | "error";

export default function SmartReply({ emailBody, emailFrom, emailSubject }: SmartReplyProps) {
  const [state, setState] = useState<ReplyState>("idle");
  const [replyText, setReplyText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const generateReply = useCallback(async () => {
    setState("loading");
    setErrorMsg("");
    setReplyText("");

    try {
      const res = await fetch("/api/generate-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: emailSubject,
          from: emailFrom,
          body: emailBody,
        }),
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = (await res.json()) as { reply: string };
      setReplyText(data.reply);
      setState("ready");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }, [emailBody, emailFrom, emailSubject]);

  const handleCopy = async () => {
    if (!replyText) return;
    await navigator.clipboard.writeText(replyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setState("idle");
    setReplyText("");
    setErrorMsg("");
  };

  return (
    <div className="border-t border-surface-border bg-surface-card">
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-border/60">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-accent/20 flex items-center justify-center">
            <svg className="w-3 h-3 text-accent-light" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 1 0 1.09 1.03L9.25 4.636v8.614Z" />
              <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
            </svg>
          </div>
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
            AI Smart Reply
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent-light font-medium">
            Beta
          </span>
        </div>
        {state !== "idle" && (
          <button
            onClick={handleReset}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      <div className="px-5 py-4">
        {/* Idle state — Generate button */}
        {state === "idle" && (
          <button
            onClick={generateReply}
            className="flex items-center gap-2 rounded-xl bg-accent hover:bg-accent-light transition-all duration-200 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/25 hover:shadow-accent/40 active:scale-95"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
            </svg>
            Generate Smart Reply
          </button>
        )}

        {/* Loading state */}
        {state === "loading" && (
          <div className="flex items-center gap-3 py-2">
            <div className="flex gap-1">
              <span className="w-2 h-2 rounded-full bg-accent animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 rounded-full bg-accent animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 rounded-full bg-accent animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
            <span className="text-sm text-gray-400">Analysing email and generating reply…</span>
          </div>
        )}

        {/* Error state */}
        {state === "error" && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-900/20 border border-red-800/40">
            <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <div className="flex-1">
              <p className="text-xs font-medium text-red-400">Failed to generate reply</p>
              <p className="text-xs text-red-500/80 mt-0.5">{errorMsg}</p>
              <button
                onClick={generateReply}
                className="mt-2 text-xs text-red-400 hover:text-red-300 underline transition-colors"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* Ready state — editable textarea */}
        {state === "ready" && (
          <div className="space-y-3">
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={5}
              className="w-full bg-surface-hover border border-surface-border rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50 resize-none transition-all leading-relaxed"
              placeholder="Generated reply will appear here…"
            />
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-1.5 rounded-lg bg-accent hover:bg-accent-light transition-colors px-4 py-2 text-sm font-semibold text-white shadow shadow-accent/20">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                </svg>
                Send Reply
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-lg bg-surface-hover hover:bg-surface-border transition-colors px-3 py-2 text-sm font-medium text-gray-300"
              >
                {copied ? (
                  <>
                    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                    </svg>
                    Copy
                  </>
                )}
              </button>
              <button
                onClick={generateReply}
                className="flex items-center gap-1.5 rounded-lg bg-surface-hover hover:bg-surface-border transition-colors px-3 py-2 text-sm font-medium text-gray-300"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
                Regenerate
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
