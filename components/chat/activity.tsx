"use client";

import { getToolName, isToolUIPart, type UIMessage } from "ai";

/*
  What the assistant is doing right now, in words.

  Three dots say "wait"; they don't say why. A turn here can spend several
  seconds searching the web or reading a write-up, and the difference between
  "it's thinking" and "it's searching for admissions requirements" is the
  difference between a pause that feels considered and one that feels stuck.

  Read from the tool parts already on the message rather than from anything the
  model says about itself. A model narrating its own plan is both slower and
  occasionally wrong; the parts are a record of what actually ran.
*/

const LABELS: Record<string, string> = {
  researchTopic: "Searching the web",
  focusSection: "Finding the right section",
  highlightItems: "Picking out the relevant bits",
  openPage: "Opening the write-up",
  assessFit: "Weighing him against the role",
  selectResume: "Fetching his CV",
  listResumes: "Gathering his CVs",
  suggestRoles: "Thinking",
  draftContactMessage: "Drafting a message",
  clearFocus: "Thinking",
};

/**
 * The label for a turn in flight, or null when there's nothing to say.
 *
 * A tool that has been called but hasn't returned is the most specific thing
 * available, so it wins. Otherwise the model is composing, which is "thinking".
 */
export function activityLabel(message: UIMessage | undefined, streaming: boolean): string | null {
  if (message) {
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      // Anything short of a result means it's still running.
      if (part.state === "output-available" || part.state === "output-error") continue;
      const name = getToolName(part);
      return LABELS[name] ?? "Working on it";
    }
  }

  return streaming ? "Thinking" : null;
}

export function Activity({ label }: { label: string }) {
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
      <span className="font-mono text-[11px] uppercase tracking-widest text-muted">{label}</span>
    </span>
  );
}
