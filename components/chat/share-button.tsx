"use client";

import { useEffect, useState } from "react";
import type { UIMessage } from "ai";
import { shareConversation } from "@/app/chat-share";

/*
  Hands the conversation to somebody else.

  A recruiter who works out that someone is a fit usually has to convince a
  hiring manager next, and until now the evidence died with the tab — they'd
  have to retype the case themselves. This turns it into a link.

  Explicit by design. Nothing is stored until this is pressed, which is what
  keeps a feature that publishes text from needing a consent flow.
*/
export function ShareButton({ messages }: { messages: UIMessage[] }) {
  const [state, setState] = useState<"idle" | "working" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state !== "copied" && state !== "failed") return;
    const timer = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  async function share() {
    setState("working");
    const result = await shareConversation(messages);
    if (!result.ok) {
      setState("failed");
      return;
    }

    const url = `${window.location.origin}/c/${result.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      // Refused on insecure origins and in some embedded browsers. A prompt
      // holding the link beats a button that silently did nothing.
      window.prompt("Copy the link:", url);
      setState("idle");
    }
  }

  return (
    <button
      onClick={share}
      disabled={state === "working"}
      aria-live="polite"
      className="rounded px-2 py-1 font-mono text-[11px] uppercase tracking-widest text-muted transition-colors hover:text-accent disabled:opacity-50"
    >
      {state === "working" ? "…" : state === "copied" ? "copied" : state === "failed" ? "failed" : "share"}
    </button>
  );
}
