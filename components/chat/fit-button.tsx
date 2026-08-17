"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useChatDock } from "./chat-provider";

/*
  "Am I a fit?" — the strongest thing the assistant does, and until now the
  only way to reach it was to think of pasting a job description into a chat
  box unprompted. Almost nobody does.

  It takes the description in a dialog rather than the chat input for a
  practical reason: a JD is several hundred words, and a one-line composer that
  grows as you paste into it reads as the wrong place to put one. A textarea
  that is obviously sized for a wall of text says "yes, all of it".

  What comes back is a verdict with gaps, not a pitch. That honesty is the
  point — a recruiter checks the gaps in the interview, and an assistant that
  claimed a strong match for everything would be worth less than no assistant.
*/

const MIN_LENGTH = 80;

export function FitButton({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [jd, setJd] = useState("");
  const { send } = useChatDock();

  const tooShort = jd.trim().length < MIN_LENGTH;

  const submit = () => {
    if (tooShort) return;
    /*
      Sent as a visitor turn, like every other entry point. The transcript
      stays honest about who said what, and the assessment sits in the
      conversation where it can be asked about rather than in a modal that
      closes and takes the answer with it.
    */
    send(`Here's a job description — is he a fit?\n\n${jd.trim()}`);
    setOpen(false);
    setJd("");
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
            />

            <div
              role="dialog"
              aria-modal="true"
              aria-label="Check the fit against a job description"
              className="animate-rise relative w-full max-w-lg rounded-[var(--radius)] border border-hairline bg-surface p-5 shadow-2xl"
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
                Against a real role
              </p>
              <h2 className="mt-1 font-display text-lg text-text">Paste the job description</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                You&apos;ll get a verdict with the gaps included — the things he hasn&apos;t done
                are listed alongside the things he has. Nothing is stored.
              </p>

              <textarea
                autoFocus
                value={jd}
                onChange={(e) => setJd(e.target.value)}
                onKeyDown={(e) => {
                  // The dialog is a text field, so Enter has to insert a
                  // newline; the deliberate submit is the modifier.
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                  if (e.key === "Escape") setOpen(false);
                }}
                rows={9}
                placeholder="Responsibilities, requirements, the lot — paste all of it."
                className="mt-3 w-full resize-none rounded border border-hairline bg-bg p-3 text-sm leading-relaxed text-text outline-none placeholder:text-muted focus:border-accent/50"
              />

              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
                  {tooShort ? "Paste a bit more" : "⌘↵ to check"}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-muted transition-colors hover:text-text"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={tooShort}
                    className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    Check the fit
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
