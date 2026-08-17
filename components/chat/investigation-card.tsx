"use client";

import { useUIControl } from "@/components/ui-control";
import { parseItemId } from "@/lib/content/types";

/*
  The working behind a judgement, folded away.

  This first rendered nothing: three internal readings printed above the answer
  would make somebody read the same thing twice. That was right about the
  default and wrong about the choice — the reasoning is the most interesting
  thing this site does, and hiding it entirely asks a visitor to take a verdict
  on trust. A recruiter reading "his backend depth is unproven" reasonably
  wants to know what produced that.

  So it is here and closed. Open, it shows what each reader actually found,
  including the one briefed to argue against him — which is the part worth
  seeing, since it is the evidence the assistant is not simply advocating.

  A native <details>: it opens without JavaScript, it is keyboard-operable for
  free, and the browser handles the disclosure semantics that a div-and-useState
  version would have to reimplement and would get subtly wrong.
*/

export function InvestigationCard({
  findings,
}: {
  findings: Array<{ label: string; finding: string; itemIds: string[] }>;
}) {
  const { focusSection, setHighlights } = useUIControl();

  if (!findings.length) return null;

  return (
    <details className="my-2 overflow-hidden rounded-[var(--radius)] border border-hairline bg-surface">
      <summary className="cursor-pointer list-none px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted transition-colors hover:text-accent">
        {/*
          The marker is drawn here rather than left to the browser, whose
          default triangle sits at a different size and colour in every engine
          and would be the one element on this card that ignores the theme.
        */}
        <span aria-hidden="true" className="mr-1.5 inline-block transition-transform">
          ▸
        </span>
        Read it {findings.length} ways before answering
      </summary>

      <div className="space-y-3 border-t border-hairline px-3 py-3">
        {findings.map((f, i) => (
          <div key={i}>
            <p className="font-mono text-[10px] uppercase tracking-widest text-accent">{f.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{f.finding}</p>

            {f.itemIds.length > 0 && (
              /*
                What each reading actually looked at, and one tap from it. The
                same move FitReport makes: a claim beside its evidence beats a
                claim that has to be believed.
              */
              <ul className="mt-1.5 flex flex-wrap gap-1">
                {f.itemIds.map((id) => {
                  const parsed = parseItemId(id);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (parsed) focusSection(parsed.section);
                          setHighlights([{ itemId: id, note: f.label }]);
                        }}
                        className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-accent hover:text-accent"
                      >
                        {parsed?.slug ?? id}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
