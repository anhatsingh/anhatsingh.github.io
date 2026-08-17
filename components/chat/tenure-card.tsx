"use client";

import { useUIControl } from "@/components/ui-control";
import { parseItemId } from "@/lib/content/types";

/*
  How long a skill has been in use, with the working.

  The total on its own is a claim. A recruiter checks a claim like this against
  the dates rendered in the Experience section a few inches up the page, so the
  spans that produced it travel with it — and each one is clickable, landing on
  the entry it came from, which makes checking one tap rather than a scroll and
  a squint.

  Overlaps are stated rather than left to be noticed. The spans visibly sum to
  more than the total whenever two things ran at once, and a reader who spots
  that without explanation concludes the arithmetic is wrong.
*/

export function TenureCard({
  skill,
  formatted,
  months,
  spans,
  undated,
}: {
  skill: string;
  formatted: string;
  months: number;
  spans: Array<{ id: string; label: string; from: string; to: string; months: number }>;
  undated: string[];
}) {
  const { focusSection, setHighlights } = useUIControl();

  /*
    Nothing dated uses it. The prose beside the card carries that answer, and a
    card showing an empty duration over an empty list would read as a failure
    rather than as a fact about the record.
  */
  if (!spans.length) return null;

  const sum = spans.reduce((n, s) => n + s.months, 0);

  return (
    <section
      aria-label={`${skill}: ${formatted}`}
      className="my-3 overflow-hidden rounded-[var(--radius)] border border-hairline bg-surface"
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-widest text-muted">{skill}</span>
        <span className="font-display text-xl tabular-nums text-text">{formatted}</span>
      </div>

      <ul className="divide-y divide-hairline">
        {spans.map((span) => (
          <li key={span.id}>
            <button
              type="button"
              onClick={() => {
                const parsed = parseItemId(span.id);
                if (parsed) focusSection(parsed.section);
                setHighlights([{ itemId: span.id, note: `${formatted} of ${skill} in total` }]);
              }}
              className="group flex w-full items-baseline justify-between gap-3 px-4 py-2 text-left transition-colors hover:bg-elevated"
            >
              <span className="min-w-0 truncate text-sm text-muted group-hover:text-text">
                {span.label}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                {span.from} – {span.to}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="border-t border-hairline px-4 py-2 text-xs text-muted">
        {/*
          Only when it actually happened. Saying "overlaps counted once" where
          nothing overlapped invites the reader to hunt for the overlap.
        */}
        {sum > months && <span>Months where two of these ran at once are counted once. </span>}
        {undated.length > 0 && (
          <span>
            {undated.length} further {undated.length === 1 ? "entry uses" : "entries use"} it without
            dates, so {undated.length === 1 ? "it isn't" : "they aren't"} counted.
          </span>
        )}
        {sum === months && undated.length === 0 && <span>Tap an entry to see it in context.</span>}
      </div>
    </section>
  );
}
