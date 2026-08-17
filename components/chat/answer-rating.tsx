"use client";

import { useState } from "react";
import { submitRating } from "@/app/rate-answer";

/*
  Was that answer any good?

  Everything else the site knows about answer quality is inferred from the
  assistant's own wording — the classifier spots refusals, and nothing else. A
  reply that reads as confident and complete can be wrong about the work, and
  without asking, nobody ever finds out. This is the one signal that comes from
  the person who asked.

  Quiet by design, and quiet in both directions. A prominent rating widget under
  every answer turns a conversation into a survey; this sits at the end of the
  message in the muted grey, and the useful vote — the one saying an answer was
  wrong — is worth more than the volume of votes.

  It disappears once cast. Leaving it up invites a second opinion on the same
  answer, and re-voting is noise rather than data.
*/
export function AnswerRating({ question }: { question: string }) {
  const [rated, setRated] = useState<1 | -1 | null>(null);

  if (!question.trim()) return null;

  if (rated) {
    return (
      <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted">
        {rated === 1 ? "Glad that helped" : "Noted — that one's on the list to fix"}
      </p>
    );
  }

  const vote = (rating: 1 | -1) => {
    setRated(rating);
    // Fire-and-forget. A visitor who told you something was wrong should not
    // then be shown a spinner about it.
    void submitRating(question, rating);
  };

  return (
    <div className="mt-2 flex items-center gap-1">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
        Useful?
      </span>
      <button
        type="button"
        onClick={() => vote(1)}
        aria-label="That answer was useful"
        className="rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-success/10 hover:text-success"
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => vote(-1)}
        aria-label="That answer was not useful"
        className="rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-danger/10 hover:text-danger"
      >
        No
      </button>
    </div>
  );
}
