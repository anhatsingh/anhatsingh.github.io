"use client";

import { useEffect, useRef, useState } from "react";
import { AssistantAvatar } from "./assistant-avatar";
import { useChatDock } from "./chat-provider";

/*
  The hero's chat surface.

  An earlier version was a single bordered input with a `>` prefix, which read
  as a terminal prompt or a search bar — nobody understood it was a chatbot. So
  this is a real chat panel instead: status header, an assistant bubble that has
  already said hello, suggested replies, and a send button. It demos itself
  before anyone types.

  It still isn't the transcript. Typing here opens the dock, which owns the
  conversation — that separation is what lets the dock stay mounted for the life
  of the page instead of remounting when the layout splits.
*/

/*
  "Show me around" leads deliberately.

  The scroll-and-highlight machinery is the unusual thing about this site and
  almost nobody finds it, because asking a chat box to drive a page isn't a
  thing people think to try. Offering it as the first chip is the difference
  between a feature and a feature somebody uses.
*/
const STARTERS = [
  "Show me around",
  "Best project?",
  "Paste a job description",
  "How do I reach him?",
];

const HINTS = [
  "Ask about his work…",
  "What has Anhat built with RAG?",
  "Is he a fit for an LLM infra role?",
  "Walk me through his best project",
];

export function HeroChatPanel() {
  const { send, isOpen, open, messages, assistantAvatar, assistantName } = useChatDock();
  const [value, setValue] = useState("");
  const [hint, setHint] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Pause the rotation while the visitor is typing, so the placeholder
    // doesn't churn under an active cursor.
    if (value) return;
    const id = setInterval(() => setHint((h) => (h + 1) % HINTS.length), 3400);
    return () => clearInterval(id);
  }, [value]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    send(value);
    setValue("");
  }

  const conversationStarted = messages.length > 0;

  return (
    <div className="w-full max-w-lg">
      <div className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.15)]">
        {/* Header — the status pill is what makes it read as "live". */}
        <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            <span className="font-mono text-[11px] uppercase tracking-widest text-muted">
              assistant · online
            </span>
          </div>
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-accent">
            <span aria-hidden="true">⌁</span>
            drives the page
          </span>
        </div>

        {/* Greeting bubble */}
        <div className="px-4 pb-3 pt-4">
          <div className="flex gap-2.5">
            <AssistantAvatar src={assistantAvatar} name={assistantName} size={28} />
            <div className="max-w-[92%] rounded-2xl rounded-tl-sm bg-elevated px-3.5 py-2.5 text-sm leading-relaxed">
              Hi — ask me anything about {assistantName.split(" ")[0]}.{" "}
              <span className="text-muted">
                I&apos;ll pull up the relevant part of the page as I answer.
              </span>
            </div>
          </div>

          {conversationStarted ? (
            <button
              onClick={open}
              className="mt-3 font-mono text-xs uppercase tracking-widest text-accent hover:underline"
            >
              continue the conversation →
            </button>
          ) : (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-hairline px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Composer */}
        <form onSubmit={submit} className="border-t border-hairline p-2.5">
          <div className="flex items-center gap-2 rounded-full border border-hairline bg-bg py-1.5 pl-4 pr-1.5 transition-colors focus-within:border-accent">
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={HINTS[hint]}
              aria-label="Ask the assistant about Anhat"
              className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={!value.trim()}
              aria-label="Send message"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              <span aria-hidden="true" className="text-sm leading-none">
                ↑
              </span>
            </button>
          </div>
        </form>
      </div>

      {isOpen && (
        <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted">
          conversation open in the side panel
        </p>
      )}
    </div>
  );
}
