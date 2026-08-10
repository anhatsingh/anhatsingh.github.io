"use client";

import { useEffect, useState } from "react";
import { useChatDock } from "./chat-provider";

/*
  The hero's entry point into the chat.

  Deliberately NOT the transcript — typing here opens the dock, which owns the
  conversation. Keeping them separate is what lets the dock stay mounted for the
  life of the page.

  Discoverability lives here too: visitors have no reason to expect a chat that
  drives the page, so the rotating placeholder and the badge below the input
  both advertise it before anyone types a word.
*/

const HINTS = [
  "What has Anhat built with RAG?",
  "Is he a fit for an LLM infra role?",
  "Walk me through his best project",
  "How do I get in touch?",
];

export function HeroChatInput() {
  const { send } = useChatDock();
  const [value, setValue] = useState("");
  const [hint, setHint] = useState(0);

  useEffect(() => {
    // Pauses while the visitor is typing so the placeholder doesn't churn
    // under an active cursor.
    if (value) return;
    const id = setInterval(() => setHint((h) => (h + 1) % HINTS.length), 3200);
    return () => clearInterval(id);
  }, [value]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    send(value);
    setValue("");
  }

  return (
    <div className="w-full max-w-xl">
      <form onSubmit={submit}>
        <div className="group flex items-center gap-3 rounded-[var(--radius)] border border-hairline bg-surface px-4 py-3.5 transition-colors focus-within:border-accent hover:border-accent/50">
          <span className="font-mono text-sm text-accent" aria-hidden="true">
            &gt;
          </span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={HINTS[hint]}
            aria-label="Ask the assistant about Anhat"
            className="min-w-0 flex-1 bg-transparent font-mono text-sm text-text outline-none placeholder:text-muted"
          />
          {!value && <span className="animate-caret font-mono text-accent" aria-hidden="true">▮</span>}
          <button
            type="submit"
            disabled={!value.trim()}
            className="shrink-0 font-mono text-xs uppercase tracking-widest text-accent transition-opacity disabled:opacity-0"
          >
            ask →
          </button>
        </div>
      </form>

      <p className="mt-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted">
        <span className="text-accent" aria-hidden="true">
          ⌁
        </span>
        this chat navigates the page for you
      </p>
    </div>
  );
}
