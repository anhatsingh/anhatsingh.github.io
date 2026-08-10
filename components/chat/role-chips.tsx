"use client";

import { useChatDock } from "./chat-provider";

/*
  Quick answers to "what sort of role are you hiring for?".

  The labels come from the server through ChatProvider, never through the
  model. That distinction is the whole design: the assistant still cannot name
  the variants in prose, cannot be talked into listing them, and cannot offer a
  menu of its own — it asks an open question and emits a marker. The options
  appear as controls rendered beside its answer.

  So a visitor who types their own answer gives an unprompted one, which is the
  better signal, while a visitor who would rather just click has something to
  click. Typing is still the primary path; these sit under the question rather
  than replacing it.

  Nothing renders when there are no saved variants, so a site with one resume
  never shows a chip row of one.
*/

export function RoleChips() {
  const { resumeOptions, send, status } = useChatDock();

  // One option is not a choice — it is a hint that there is only one thing
  // here, which is worse than saying nothing.
  if (resumeOptions.length < 2) return null;

  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="mt-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">
        Or pick the closest
      </p>

      <ul className="mt-2 flex flex-wrap gap-2">
        {resumeOptions.map((option) => (
          <li key={option}>
            <button
              type="button"
              disabled={busy}
              onClick={() => send(option)}
              className="group relative overflow-hidden rounded-full border border-hairline px-3 py-1.5 text-left text-xs text-muted transition-colors hover:border-accent/50 hover:text-text disabled:opacity-50"
            >
              {/* A wash rather than a fill: these are suggestions, not the
                  primary action, and a row of solid accent pills would
                  outshout the assistant's own question. */}
              <span
                className="absolute inset-0 bg-accent/0 transition-colors group-hover:bg-accent/10"
                aria-hidden="true"
              />
              <span className="relative">{option}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
