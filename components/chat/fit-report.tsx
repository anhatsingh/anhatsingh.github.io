"use client";

import { useUIControl } from "@/components/ui-control";
import { parseItemId, SECTION_LABELS } from "@/lib/content/types";

/*
  The fit report a recruiter gets after pasting a job description.

  Gaps are rendered as prominently as matches, deliberately. A report that only
  lists strengths is an advert, and recruiters discount adverts — the honesty is
  what makes the matches believable. It's also self-protecting: overclaiming
  here is what gets someone rejected at interview instead of at screening.

  Clicking a match highlights it on the page, so a claim is one tap from its
  evidence rather than something you have to take on trust.
*/

interface Props {
  verdict: "strong" | "partial" | "weak";
  matches: Array<{ itemId: string; requirement: string }>;
  gaps: string[];
  summary: string;
}

const VERDICT: Record<Props["verdict"], { label: string; className: string }> = {
  strong: { label: "Strong fit", className: "border-success/40 bg-success/10 text-success" },
  partial: { label: "Partial fit", className: "border-[var(--warn)]/40 bg-[var(--warn)]/10 text-[var(--warn)]" },
  weak: { label: "Weak fit", className: "border-danger/40 bg-danger/10 text-danger" },
};

export function FitReport({ verdict, matches, gaps, summary }: Props) {
  const { focusSection, setHighlights } = useUIControl();
  const style = VERDICT[verdict];

  function reveal(itemId: string, requirement: string) {
    const parsed = parseItemId(itemId);
    if (!parsed) return;
    focusSection(parsed.section, `Evidence for: ${requirement}`);
    setHighlights([{ itemId, note: requirement }]);
  }

  return (
    <div className="my-2 overflow-hidden rounded-[var(--radius)] border border-hairline bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-3.5 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-widest text-muted">
          Fit assessment
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${style.className}`}
        >
          {style.label}
        </span>
      </div>

      <div className="space-y-4 p-3.5">
        <p className="leading-relaxed">{summary}</p>

        {matches.length > 0 && (
          <div>
            <h4 className="font-mono text-[11px] uppercase tracking-widest text-success">
              Evidence ({matches.length})
            </h4>
            <ul className="mt-2 space-y-1.5">
              {matches.map((m) => {
                const parsed = parseItemId(m.itemId);
                return (
                  <li key={m.itemId + m.requirement}>
                    <button
                      onClick={() => reveal(m.itemId, m.requirement)}
                      className="group flex w-full gap-2 text-left text-sm hover:text-accent"
                    >
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-success" aria-hidden="true" />
                      <span>
                        {m.requirement}
                        {parsed && (
                          <span className="ml-1.5 font-mono text-[11px] text-muted group-hover:text-accent">
                            → {SECTION_LABELS[parsed.section]}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {gaps.length > 0 && (
          <div>
            <h4 className="font-mono text-[11px] uppercase tracking-widest text-[var(--warn)]">
              Not evidenced ({gaps.length})
            </h4>
            <ul className="mt-2 space-y-1.5">
              {gaps.map((g) => (
                <li key={g} className="flex gap-2 text-sm text-muted">
                  <span
                    className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--warn)]"
                    aria-hidden="true"
                  />
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
