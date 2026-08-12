"use client";

import { useHighlight } from "@/components/ui-control";

/*
  Makes a detail page highlightable in its own right.

  Before this, cards only existed on the homepage, so asking about the page you
  were reading sent you somewhere else: the assistant would highlight the entry,
  find nothing registered under that id, and navigate to the homepage section
  containing it. The visitor asked about what was in front of them and got
  moved away from it.

  Registering the page under the same id its card uses fixes that in the place
  the problem actually is. A highlight for this entry now lands here, and one
  for a different entry still navigates home — which is right, because that
  entry genuinely isn't on this page.

  It renders the note above the content rather than wrapping it in a ring: on a
  card the ring says "this one of several", and on a page where there is only
  one thing the ring says nothing.
*/
export function DetailHighlight({ itemId }: { itemId: string }) {
  const { isHighlighted, note, ref } = useHighlight(itemId);

  return (
    <div ref={ref} className="scroll-mt-24">
      {isHighlighted && note && (
        <div
          role="note"
          className="animate-rise mb-6 inline-flex items-start gap-2 rounded-[var(--radius)] border border-callout-border bg-callout-bg px-3 py-2"
        >
          <span className="font-mono text-xs text-accent" aria-hidden="true">
            ⌁
          </span>
          <span className="text-sm text-text">{note}</span>
        </div>
      )}
    </div>
  );
}
