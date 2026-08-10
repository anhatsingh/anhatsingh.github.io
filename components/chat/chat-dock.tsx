"use client";

import { isToolUIPart, type UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { useChatDock } from "./chat-provider";
import { ContactCard } from "./contact-card";
import { useUIControl } from "@/components/ui-control";
import type { ToolOutcome } from "@/lib/chat/tools";

/*
  The docked chat panel.

  Mounted once, always present in the DOM, shown/hidden with CSS. Moving it
  between containers would remount it and wipe the transcript, so its position
  is purely a styling concern.

  Desktop: right rail. Below lg: bottom sheet. The layout shift on the content
  side is handled by the page shell reading `isSplit`.
*/

/** Renders what the bot DID, so its agency reads as deliberate rather than spooky. */
function ActionPill({ outcome }: { outcome: ToolOutcome }) {
  if (outcome.ok !== true) return null;

  let label: string | null = null;
  if (outcome.action === "focus") label = `focused ${outcome.label}`;
  else if (outcome.action === "highlight")
    label = `highlighted ${outcome.items.length} item${outcome.items.length > 1 ? "s" : ""}`;
  else if (outcome.action === "resume") label = "opened resume";
  else if (outcome.action === "clear") label = "cleared focus";

  if (!label) return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
      <span aria-hidden="true">↳</span>
      {label}
    </span>
  );
}

function MessageParts({ message }: { message: UIMessage }) {
  return (
    <>
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          if (!part.text.trim()) return null;
          return (
            <p key={i} className="whitespace-pre-wrap leading-relaxed">
              {part.text}
            </p>
          );
        }

        if (isToolUIPart(part) && part.state === "output-available") {
          const outcome = part.output as ToolOutcome;

          if (outcome?.ok === true && outcome.action === "draft") {
            return (
              <div key={i} className="my-2">
                <ContactCard
                  initialName={outcome.name}
                  initialEmail={outcome.email}
                  initialMessage={outcome.message}
                />
              </div>
            );
          }

          return (
            <div key={i} className="my-1">
              <ActionPill outcome={outcome} />
            </div>
          );
        }

        return null;
      })}
    </>
  );
}

const STARTERS = [
  "What has Anhat built with RAG?",
  "Walk me through his best project",
  "Is he a fit for an LLM infra role?",
  "I'd like to reach out",
];

export function ChatDock() {
  const { messages, status, error, isOpen, send, close, stop, retry } = useChatDock();
  const { isSplit } = useUIControl();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    // Keep the newest content in view as tokens arrive.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    send(draft);
    setDraft("");
  }

  return (
    <aside
      aria-label="Chat with Anhat's assistant"
      data-open={isOpen}
      className={[
        "fixed z-40 flex flex-col border-hairline bg-surface/95 backdrop-blur transition-all duration-500",
        "[transition-timing-function:var(--ease)]",
        // Bottom sheet on small screens
        "inset-x-0 bottom-0 max-h-[62vh] rounded-t-xl border-t",
        // Right rail from lg up
        "lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-[400px] lg:rounded-none lg:border-l lg:border-t-0",
        isOpen
          ? "pointer-events-auto translate-y-0 opacity-100 lg:translate-x-0"
          : "pointer-events-none translate-y-full opacity-0 lg:translate-x-full lg:translate-y-0",
      ].join(" ")}
    >
      <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${busy ? "bg-accent animate-pulse" : "bg-success"}`}
            aria-hidden="true"
          />
          <span className="font-mono text-[11px] uppercase tracking-widest text-muted">
            {busy ? "thinking" : "assistant · online"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {busy && (
            <button
              onClick={stop}
              className="rounded px-2 py-1 font-mono text-[11px] uppercase tracking-widest text-muted hover:text-text"
            >
              stop
            </button>
          )}
          <button
            onClick={close}
            aria-label="Close chat"
            className="rounded px-2 py-1 text-muted transition-colors hover:text-text"
          >
            ✕
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-muted">
              Ask me anything about Anhat. I&apos;ll pull up the relevant part of the page as I answer.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-hairline px-2.5 py-1 text-left text-xs text-muted transition-colors hover:border-accent hover:text-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] rounded-[var(--radius)] bg-accent px-3 py-2 text-accent-ink"
                  : "max-w-full space-y-1 text-text"
              }
            >
              <MessageParts message={m} />
            </div>
          </div>
        ))}

        {status === "submitted" && (
          <div className="flex gap-1" aria-label="Assistant is typing">
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-[var(--radius)] border border-danger/40 bg-danger/10 p-3">
            <p className="text-danger">{error.message || "That didn't work."}</p>
            <button
              onClick={retry}
              className="mt-2 font-mono text-[11px] uppercase tracking-widest text-accent hover:underline"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="border-t border-hairline p-3">
        <div className="flex items-center gap-2 rounded-[var(--radius)] border border-hairline bg-bg px-3 py-2 focus-within:border-accent">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask about his work…"
            aria-label="Message"
            className="min-w-0 flex-1 bg-transparent font-mono text-sm text-text outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="Send"
            className="font-mono text-xs uppercase tracking-widest text-accent disabled:opacity-40"
          >
            send
          </button>
        </div>
        {isSplit && (
          <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted">
            press esc to exit focus view
          </p>
        )}
      </form>
    </aside>
  );
}
