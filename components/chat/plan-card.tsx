"use client";

import { ThinkingBlock } from "./thinking-block";

/*
  What it understood, and what it is about to do — written before it does any
  of it.

  The assistant used to go straight from question to answer, with a spinner in
  between and no sign of what it had made of the question. On anything that
  takes a few seconds that is the worst possible moment to show nothing: the
  visitor cannot tell whether it understood them, so they cannot tell whether
  waiting is worth it.

  This streams because the plan IS the tool's input, and the SDK sends tool
  input as the model generates it. So the reading appears a few words at a
  time and the steps arrive one by one, live, at no extra model call — nothing
  here computes anything, and that is the point. Anything this tool did with
  the plan would delay the only thing worth having.

  It wears the shared thinking shell rather than styling itself. The first
  version was a left-ruled paragraph in muted text, which read as something the
  assistant had said rather than something it was doing — and it sat above the
  real answer, so the first thing anyone read was scaffolding they had no
  reason to recognise as scaffolding.
*/

export function PlanCard({
  reading,
  steps = [],
  working,
}: {
  reading?: string;
  steps?: string[];
  /** Still being written. Drives the caret and the live dot. */
  working: boolean;
}) {
  if (!reading && !steps.length) return null;

  return (
    <ThinkingBlock label={working ? "Working out what's being asked" : "Thought it through"} working={working}>
      {reading && (
        <p className="text-xs leading-relaxed text-muted">
          {reading}
          {/*
            A caret while the sentence is still arriving. Without it a reading
            cut off mid-clause looks like the model lost its thread rather than
            like it is still typing.
          */}
          {working && !steps.length && (
            <span aria-hidden="true" className="ml-0.5 animate-pulse text-accent">
              ▍
            </span>
          )}
        </p>
      )}

      {steps.length > 0 && (
        <ul className={`space-y-1 ${reading ? "mt-2 border-t border-dashed border-hairline pt-2" : ""}`}>
          {steps.map((step, i) => (
            <li key={i} className="flex gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted">
              <span aria-hidden="true" className="text-accent">
                ↳
              </span>
              <span className="min-w-0">{step}</span>
            </li>
          ))}
        </ul>
      )}
    </ThinkingBlock>
  );
}
