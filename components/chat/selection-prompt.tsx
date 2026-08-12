"use client";

import { useCallback, useEffect, useState } from "react";
import { useChatDock } from "./chat-provider";

/*
  Highlight something on the page and get offered an explanation of it.

  Selecting text is what people already do when they hit a term they don't
  know — it's the gesture that precedes a search. Meeting it with an offer
  turns a moment of friction into a question, without asking anyone to
  translate what they're confused about into a sentence first.

  Two things keep it from being an irritant: it never appears for selections
  inside the chat itself, which would be circular, and it can be dismissed —
  once dismissed it stays gone until the visitor selects something else, rather
  than reappearing on the next mouse-up over the same words.
*/

/* Below this it's a click that grazed a word, not a selection. */
const MIN_CHARS = 12;
const MAX_CHARS = 600;

interface Anchor {
  text: string;
  x: number;
  y: number;
}

export function SelectionPrompt() {
  const { send } = useChatDock();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [dismissed, setDismissed] = useState("");

  const read = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";

    if (!selection || selection.isCollapsed || text.length < MIN_CHARS) {
      setAnchor(null);
      return;
    }

    /*
      Ignore selections inside the dock. Offering to explain the assistant's own
      answer back to it is a loop, and copying a line out of a reply is a
      perfectly normal thing to do.
    */
    const node = selection.anchorNode;
    const el = node instanceof Element ? node : node?.parentElement;
    if (el?.closest("[data-chat-dock]")) {
      setAnchor(null);
      return;
    }

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) {
      setAnchor(null);
      return;
    }

    setAnchor({
      text: text.slice(0, MAX_CHARS),
      // Above the selection, centred on it, in viewport coordinates — the
      // element is fixed, so no scroll offset belongs here.
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, []);

  useEffect(() => {
    /*
      mouseup and keyup rather than selectionchange: the latter fires on every
      character as a drag grows, so the button would jitter along with the
      pointer. These fire once, when the gesture is finished.
    */
    document.addEventListener("mouseup", read);
    document.addEventListener("keyup", read);
    // A scroll moves the selection out from under a fixed button.
    window.addEventListener("scroll", () => setAnchor(null), { passive: true });

    return () => {
      document.removeEventListener("mouseup", read);
      document.removeEventListener("keyup", read);
    };
  }, [read]);

  if (!anchor || anchor.text === dismissed) return null;

  const ask = () => {
    const excerpt = anchor.text.length > 90 ? `${anchor.text.slice(0, 90)}…` : anchor.text;
    /*
      The question carries a short excerpt so the transcript reads naturally,
      while the full selection travels separately as context — a wall of quoted
      text in the visitor's own message would bury what they asked.
    */
    send(`What does this mean: "${excerpt}"`, anchor.text);
    window.getSelection()?.removeAllRanges();
    setAnchor(null);
  };

  return (
    <div
      className="animate-rise fixed z-50 -translate-x-1/2 -translate-y-full pb-2"
      style={{ left: anchor.x, top: anchor.y }}
    >
      <div className="flex items-center gap-1 rounded-full border border-accent/40 bg-elevated px-1 py-1 shadow-lg">
        <button
          type="button"
          onClick={ask}
          className="rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-accent transition-colors hover:bg-accent/15"
        >
          Ask about this
        </button>
        <button
          type="button"
          onClick={() => setDismissed(anchor.text)}
          aria-label="Dismiss"
          className="flex h-5 w-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-text"
        >
          <span aria-hidden="true" className="text-xs leading-none">
            ×
          </span>
        </button>
      </div>
    </div>
  );
}
