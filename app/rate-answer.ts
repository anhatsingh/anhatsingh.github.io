"use server";

import { rateAnswer } from "@/lib/chat/analytics";

/*
  A visitor telling you an answer was wrong.

  The classifier in analytics.ts infers whether the assistant answered from its
  own wording, which catches refusals and misses everything else: a reply that
  reads as confident and complete can still be wrong about the work, and
  nothing in the system would ever know. This is the only signal that comes
  from the person who asked.

  Same no-identifiers rule as the rest of that table — the vote attaches to the
  question, not to whoever cast it.
*/
export async function submitRating(question: string, rating: number): Promise<void> {
  if (rating !== 1 && rating !== -1) return;
  await rateAnswer(question, rating);
}
