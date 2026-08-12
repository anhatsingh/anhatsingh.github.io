"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUIControl } from "@/components/ui-control";
import { useChatDock } from "./chat-provider";
import type { SectionId } from "@/lib/content/types";

export interface TourStep {
  section: SectionId;
  label: string;
  note: string;
  /** Something inside the section to land on instead of its top. */
  anchor: string | null;
  items: Array<{ itemId: string; note: string }>;
}

/*
  A guided walk the visitor drives.

  The first version ran the whole tour inside one reply: four sections scrolled
  past in a couple of seconds, each highlight replaced by the next before
  anyone could read it. The page moved, the narration arrived all at once, and
  the effect was of being shown around by someone already leaving.

  So the model still plans the route, but the reader sets the pace. One stop is
  on screen at a time, and it stays there until they say otherwise. Previous
  and Next name where they go rather than saying "next" — knowing the stop is
  Projects is what makes the choice a choice.

  Auto-play is opt-in and stoppable, because handing control to a timer is
  exactly what went wrong before. When it is on, the bar shows the time left,
  so the countdown is visible rather than a surprise.
*/

/*
  How long a stop holds while auto-playing.

  Derived from the narration rather than fixed, since the reader has to take in
  the sentence AND look at what the page scrolled to.

  The first pass was tuned against the failure it replaced — a tour that moved
  before anything could be read — and overshot: a two-sentence stop sat for
  twenty seconds, which is waiting, not reading. This is nearer a real reading
  pace with a little room to look up from the text. Auto-play is a convenience
  anyway; anyone who wants longer has a stop button and a Previous.
*/
export function dwellFor(note: string): number {
  const words = note.trim().split(/\s+/).length;
  return Math.min(13_000, 4_000 + words * 280);
}

const TICK = 100;

export function TourCard({ steps }: { steps: TourStep[] }) {
  const { focusSection, setHighlights } = useUIControl();
  // His actual first name, so the promise names who it reaches.
  const { assistantName } = useChatDock();
  const first = assistantName.split(" ")[0];
  const [index, setIndex] = useState(0);
  /*
    Playing from the start.

    Someone who asked to be shown around asked to be shown, not handed a
    stepper to operate — starting paused made the tour wait for a second
    decision it had already been given. Every control still overrides it: any
    button press stops the timer, and the countdown says how long is left.
  */
  const [playing, setPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(0);

  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  /* Drives the page to a stop. Scroll first, pin second — a highlight applied
     before the section arrives lands off screen. */
  const applyStep = useCallback(
    (i: number) => {
      const target = steps[i];
      if (!target) return;
      focusSection(target.section, undefined, { landmark: target.anchor ?? undefined });

      /*
        Skipped when there's nothing to pin. Every call takes a turn of the
        navigation queue, and a queued no-op costs a full cooldown before the
        next stop can do anything.

        A stop with an anchor has already chosen where to land, so its pins
        don't scroll. Without that the graph stop went to the About section,
        then to whichever card it had pinned, then to the graph — three scrolls
        in under a second, which reads as the page having a seizure.
      */
      if (target.items.length) setHighlights(target.items, { scroll: !target.anchor });
    },
    [steps, focusSection, setHighlights],
  );

  /*
    The first stop lands on its own, once.

    Guarded by a ref rather than an empty dependency list because an older tour
    card stays mounted as the conversation grows; without this, anything that
    remounted the list would yank the page back to a walk finished ten messages
    ago.
  */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    applyStep(0);
  }, [applyStep]);

  const go = (i: number, byHand = false) => {
    const next = Math.max(0, Math.min(steps.length - 1, i));
    setIndex(next);
    setElapsed(0);
    applyStep(next);
    // Reaching for a button means wanting the wheel, and the end of the tour is
    // the end of the tour.
    if (byHand || next === steps.length - 1) setPlaying(false);
  };

  useEffect(() => {
    if (!playing) return;

    const dwell = dwellFor(step.note);
    const timer = setInterval(() => {
      setElapsed((ms) => {
        if (ms + TICK < dwell) return ms + TICK;
        // Advancing inside the updater would fight React; defer by a tick.
        queueMicrotask(() => go(index + 1));
        return 0;
      });
    }, TICK);

    return () => clearInterval(timer);
    // `go` is recreated every render; depending on it would restart the timer
    // constantly. The stop and whether we're playing are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, index, step.note]);

  if (!step) return null;

  const dwell = dwellFor(step.note);
  const progress = playing ? elapsed / dwell : 0;
  // Rounded up, so it never shows 0 while the stop is still on screen.
  const remaining = Math.ceil((dwell - elapsed) / 1000);

  return (
    <section
      aria-label="Guided tour"
      className="my-3 overflow-hidden rounded-[var(--radius)] border border-accent/30 bg-accent/[0.04]"
    >
      {/* The countdown, as a hairline. Present only while playing, so a manual
          tour carries no ticking clock. */}
      <div className="h-0.5 bg-transparent">
        <div
          className="h-full bg-accent/60 transition-[width] duration-100 ease-linear"
          style={{ width: `${progress * 100}%` }}
          aria-hidden="true"
        />
      </div>

      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
            Stop {index + 1} of {steps.length} · {step.label}
          </p>

          {/* Dots, not a number: the shape of what's left reads faster than a
              fraction, and each is a way back to a stop already seen. */}
          <ol className="flex items-center gap-1">
            {steps.map((s, i) => (
              <li key={`${s.section}-${i}`}>
                <button
                  type="button"
                  onClick={() => go(i, true)}
                  aria-label={`Go to ${s.label}`}
                  aria-current={i === index ? "step" : undefined}
                  className={`block size-1.5 rounded-full transition-colors ${
                    i === index ? "bg-accent" : i < index ? "bg-accent/40" : "bg-hairline"
                  }`}
                />
              </li>
            ))}
          </ol>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-text">{step.note}</p>

        {/*
          The one thing the tour should not leave to phrasing.

          Someone who has just been walked through the whole case is as close to
          getting in touch as they will be, and at that exact moment the contact
          section is a form below the fold while the chat is right here. Saying
          so is the difference between a tour that ends and one that converts,
          so the card states it rather than trusting the model to.
        */}
        {step.section === "contact" && (
          <p className="mt-2 rounded-[var(--radius)] border border-accent/25 bg-accent/[0.06] px-3 py-2 text-sm leading-relaxed text-text">
            You don&apos;t have to leave this chat — type your name, email and message
            here and I&apos;ll send it straight to {first}.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => go(index - 1, true)}
            disabled={isFirst}
            className="rounded-full border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent/50 hover:text-text disabled:pointer-events-none disabled:opacity-30"
          >
            ← {isFirst ? "Back" : steps[index - 1].label}
          </button>

          <button
            type="button"
            onClick={() => go(index + 1, true)}
            disabled={isLast}
            className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-30"
          >
            {isLast ? "That's the tour" : steps[index + 1].label} →
          </button>

          {/* Last, and quiet. Auto-play is the thing that went wrong before, so
              it is offered rather than assumed — and it stops on any manual
              move, because someone who reached for a button wants the wheel. */}
          {!isLast && (
            <button
              type="button"
              onClick={() => {
                setElapsed(0);
                setPlaying((v) => !v);
              }}
              className={`ml-auto rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                playing
                  ? "border-accent/50 text-accent"
                  : "border-hairline text-muted hover:border-accent/50 hover:text-text"
              }`}
            >
              {/*
                The number, not just the bar. Someone reading a stop wants to
                know how long they have before it moves — a filling hairline
                answers "roughly" and a count answers it exactly, which is what
                decides whether to read on or hit stop.

                Tabular figures so the label holds its width as it counts down;
                without them the button twitches every second.
              */}
              {playing ? (
                <>
                  ◼ stop <span className="tabular-nums">{remaining}s</span>
                </>
              ) : (
                <>▶ auto</>
              )}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
