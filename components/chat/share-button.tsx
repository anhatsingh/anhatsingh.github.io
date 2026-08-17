"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { UIMessage } from "ai";
import { shareConversation } from "@/app/chat-share";
import { useVisitLog } from "@/components/visit-tracker";

/*
  Hands the conversation to somebody else.

  A recruiter who works out that someone is a fit usually has to convince a
  hiring manager next, and until now the evidence died with the tab — they'd
  have to retype the case themselves. This turns it into a link.

  The link is shown, not silently copied. Writing to somebody's clipboard
  without showing them what landed there asks them to trust a toast; putting
  the URL on screen means they can read it, check where it points, and copy it
  when they've decided to. It also survives the clipboard being refused, which
  browsers do on insecure origins and inside embedded webviews.

  Explicit by design: nothing is stored until this is pressed, which is what
  keeps a feature that publishes text from needing a consent flow.
*/
export function ShareButton({ messages }: { messages: UIMessage[] }) {
  const [state, setState] = useState<"idle" | "working" | "ready" | "failed">("idle");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const logVisit = useVisitLog();

  async function share() {
    setState("working");
    const result = await shareConversation(messages);
    if (!result.ok) {
      setError(result.error);
      setState("failed");
      return;
    }
    // Someone forwarding the conversation is the closest thing this site has
    // to a referral, and worth knowing which channel produced it.
    logVisit("share");
    setUrl(`${window.location.origin}/c/${result.id}`);
    setCopied(false);
    setState("ready");
  }

  const dismiss = () => {
    setState("idle");
    setError("");
  };

  useEffect(() => {
    if (state !== "ready") return;
    // Selected, not copied: the link is ready to take with one keystroke, and
    // seeing it highlighted says where it went.
    inputRef.current?.select();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      dismiss();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [state]);

  useEffect(() => {
    if (state !== "failed") return;
    const timer = setTimeout(dismiss, 4000);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Refused. The link is already on screen and selected, so there is
      // something to do about it rather than a dead end.
      inputRef.current?.select();
      setCopied(false);
    }
  };

  return (
    <>
      <button
        onClick={share}
        disabled={state === "working"}
        className="rounded px-2 py-1 font-mono text-[11px] uppercase tracking-widest text-muted transition-colors hover:text-accent disabled:opacity-50"
      >
        {state === "working" ? "…" : state === "failed" ? "failed" : "share"}
      </button>

      {state === "failed" && (
        <span role="status" className="sr-only">
          {error}
        </span>
      )}

      {/*
        Portalled to the body on purpose. This button lives in the dock, and the
        dock carries a transform and a backdrop-filter — either one makes it the
        containing block for fixed-position descendants, so an overlay rendered
        in place would be trapped inside the rail instead of covering the page.
      */}
      {state === "ready" && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
          <button
            type="button"
            aria-label="Close"
            onClick={dismiss}
            className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Share this conversation"
            className="animate-rise relative w-full max-w-md rounded-[var(--radius)] border border-hairline bg-surface p-5 shadow-2xl"
          >
            <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
              Link ready
            </p>
            <h2 className="mt-1 font-display text-lg text-text">Share this conversation</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Anyone with this link can read the transcript. It isn&apos;t listed anywhere and
              search engines are asked to skip it.
            </p>

            <div className="mt-4 flex gap-2">
              <input
                ref={inputRef}
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Link to this conversation"
                className="min-w-0 flex-1 rounded border border-hairline bg-bg px-2 py-1.5 font-mono text-xs text-text outline-none focus:border-accent/50"
              />
              <button
                type="button"
                onClick={copy}
                className="shrink-0 rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={dismiss}
                className="font-mono text-[10px] uppercase tracking-widest text-muted transition-colors hover:text-text"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
