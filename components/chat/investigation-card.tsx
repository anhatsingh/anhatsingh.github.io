"use client";

import { useEffect, useRef, useState } from "react";
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
  pending = [],
}: {
  findings: Array<{ label: string; finding: string; itemIds: string[] }>;
  /** Readers still working. Empty once it has finished. */
  pending?: string[];
}) {
  const { focusSection, setHighlights } = useUIControl();

  /*
    Open while it is working, closed once it is done — unless somebody has
    touched it, after which their choice stands.

    The point of streaming this is that watching it read is the interesting
    part, and a closed box streaming into itself shows nothing. Once the
    answer arrives the answer is what matters, so it folds away and leaves the
    working one click behind.
  */
  const [touched, setTouched] = useState(false);
  const [manual, setManual] = useState(false);
  const working = pending.length > 0;

  // Kept in a ref so the toggle handler doesn't have to be re-bound as
  // findings stream in.
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (touched || !ref.current) return;
    ref.current.open = working;
  }, [working, touched]);

  if (!findings.length && !working) return null;

  return (
    <details
      ref={ref}
      onToggle={(e) => {
        setTouched(true);
        setManual((e.currentTarget as HTMLDetailsElement).open);
      }}
      // Suppresses the "manual is set but unused" reading: it records the
      // visitor's choice so a re-render never overrides it.
      data-open={manual ? "manual" : undefined}
      /*
        The same dashed, tinted panel the plan wears. Both are the assistant
        working rather than talking, and giving them two visual languages was
        most of why neither read as what it was.
      */
      data-screen-only=""
      className="my-2 overflow-hidden rounded-[var(--radius)] border border-dashed border-hairline bg-elevated/40"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 transition-colors hover:text-accent">
        {working ? (
          <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
        ) : (
          <span aria-hidden="true" className="shrink-0 font-mono text-[10px] text-muted">
            ⌁
          </span>
        )}

        <span
          className={`min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-widest ${
            working ? "text-accent" : "text-muted"
          }`}
        >
          {working
            ? `Reading it ${findings.length + pending.length} ways · ${findings.length} in`
            : `Read it ${findings.length} ways before answering`}
        </span>

        {/*
          The marker is drawn here rather than left to the browser, whose
          default triangle sits at a different size and colour in every engine
          and would be the one element on this card that ignores the theme.
        */}
        <span
          aria-hidden="true"
          data-caret=""
          className="shrink-0 font-mono text-[10px] text-muted transition-transform"
        >
          ▸
        </span>
      </summary>

      <div className="space-y-3 border-t border-dashed border-hairline px-3 py-3">
        {/*
          The readers still out, named. A box that grows without saying what
          else is coming reads as finished three times over.
        */}
        {pending.map((label) => (
          <p key={label} className="font-mono text-[10px] uppercase tracking-widest text-muted opacity-60">
            <span className="animate-pulse">…</span> {label}
          </p>
        ))}

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
