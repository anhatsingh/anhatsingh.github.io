"use client";

import { useEffect, useState } from "react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";

/*
  What the assistant is doing, said in words and changing as it goes.

  Three dots say "wait"; they don't say why, and after four seconds they start
  to read as a hang. A single frozen "Thinking" is barely better — it looks the
  same at one second and at twenty, so a slow turn is indistinguishable from a
  dead one.

  So the message moves. It opens on connecting, settles into thinking, names
  whichever tool is actually running, and eventually admits that this is taking
  a while. The point isn't decoration: it's that somebody watching can tell the
  difference between progress and a stall without being told to wait.

  The phrases come from the tool parts on the message, never from the model
  narrating its own plan — that costs a round trip and is occasionally untrue.
*/

/*
  Each tool's phrases in the order they're shown, so a long call reads as
  moving through stages rather than repeating itself. A search really does go
  looking, then reading, then comparing.
*/
const TOOL_PHASES: Record<string, string[]> = {
  researchTopic: ["Searching the web", "Reading the results", "Comparing sources"],
  focusSection: ["Finding the right section"],
  highlightItems: ["Picking out the relevant bits"],
  openPage: ["Opening the write-up"],
  assessFit: ["Reading the role", "Weighing him against it", "Looking for the gaps"],
  selectResume: ["Finding the right CV"],
  listResumes: ["Gathering his CVs"],
  suggestRoles: ["Thinking"],
  draftContactMessage: ["Drafting a message"],
  skillTenure: ["Finding where he used it", "Adding up the dates", "Checking for overlap"],
  /*
    Three readers run at once, so these describe the work rather than a
    sequence — the last one holds, which is right for something whose finish is
    all three coming back together.
  */
  investigate: ["Reading the record", "Weighing the evidence", "Arguing the other side"],
  clearFocus: ["Tidying up"],
};

/** Before the first byte comes back. Short — it's usually over quickly. */
const CONNECTING = ["Connecting", "Waking up"];

const THINKING = [
  "Thinking",
  "Reading his work",
  "Joining the dots",
  "Working through it",
  "Checking the details",
  "Nearly there",
];

/** How long each phrase holds before the next one. */
const PHRASE_MS = 2200;
const CONNECTING_MS = 1400;

/*
  Past this, silence stops being reassuring. Saying so is more honest than
  cycling cheerful phrases at somebody who is now wondering if it broke.
*/
const SLOW_MS = 22000;

function runningTool(message: UIMessage | undefined): string | null {
  if (!message) return null;
  for (const part of message.parts) {
    if (!isToolUIPart(part)) continue;
    // Anything short of a result means it's still going.
    if (part.state === "output-available" || part.state === "output-error") continue;
    return getToolName(part);
  }
  return null;
}

/**
 * The line to show, given what's running and how long it's been.
 *
 * Pure, and driven by elapsed time rather than by a timer of its own, so the
 * whole sequence can be asserted without waiting for it in real time.
 */
export function statusMessage(
  message: UIMessage | undefined,
  streaming: boolean,
  elapsedMs: number,
): string | null {
  const tool = runningTool(message);

  if (tool) {
    const phases = TOOL_PHASES[tool] ?? ["Working on it"];
    // Advance through this tool's phases, then hold on the last rather than
    // looping — a search that cycles back to "Searching" looks like a retry.
    const step = Math.min(phases.length - 1, Math.floor(elapsedMs / PHRASE_MS));
    return phases[step];
  }

  if (!streaming && elapsedMs < CONNECTING_MS) {
    return CONNECTING[Math.floor(elapsedMs / (CONNECTING_MS / CONNECTING.length))] ?? CONNECTING[0];
  }

  if (elapsedMs > SLOW_MS) return "Taking longer than usual, still going";

  if (!streaming && elapsedMs === 0) return CONNECTING[0];

  const step = Math.floor(Math.max(0, elapsedMs - CONNECTING_MS) / PHRASE_MS);
  return THINKING[step % THINKING.length];
}

/** Whether anything should be shown at all. */
export function isBusy(status: string): boolean {
  return status === "submitted" || status === "streaming";
}

export function Activity({
  message,
  streaming,
}: {
  message: UIMessage | undefined;
  streaming: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);

  /*
    One interval for the whole indicator, reset whenever a turn begins. Ticking
    at the phrase rate rather than every second: nothing here needs finer
    resolution, and a re-render a second is a re-render a second.
  */
  useEffect(() => {
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 700);
    return () => clearInterval(timer);
    // Restarting on the running tool means each tool call gets its own
    // sequence, rather than inheriting the elapsed time of the one before it.
  }, [runningTool(message)]);

  const label = statusMessage(message, streaming, elapsed);
  if (!label) return null;

  return (
    <span className="flex items-center gap-2" aria-live="polite">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      {/*
        Keyed on the text so each phrase fades in rather than swapping
        abruptly — the change is the signal that something is still happening.
      */}
      <span
        key={label}
        className="animate-rise font-mono text-[11px] uppercase tracking-widest text-muted"
      >
        {label}
      </span>
    </span>
  );
}
