"use client";

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
*/

export function PlanCard({
  reading,
  steps = [],
  working,
}: {
  reading?: string;
  steps?: string[];
  /** Still being written. Drives the caret, not the content. */
  working: boolean;
}) {
  if (!reading && !steps.length) return null;

  return (
    <div className="my-2 border-l-2 border-accent/30 pl-3">
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
        <ul className="mt-1.5 space-y-0.5">
          {steps.map((step, i) => (
            <li key={i} className="font-mono text-[10px] uppercase tracking-widest text-muted">
              <span aria-hidden="true" className="mr-1.5 text-accent">
                ↳
              </span>
              {step}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
