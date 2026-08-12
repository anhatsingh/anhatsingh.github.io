import { getServiceClient } from "@/lib/supabase/server";

/*
  Logs what visitors ask the chatbot.

  Stores the question and nothing else — no IP, no session id, no fingerprint.
  The useful signal is which questions recur, so that recurring gaps in the
  content can be filled; identifying who asked adds nothing and would drag a
  personal site into territory that needs a privacy policy.

  Never awaited by the caller and never throws: a logging failure must not cost
  a visitor their answer.
*/

const MAX_LENGTH = 500;

/*
  The phrasings the prompt tells the assistant to use when CONTEXT doesn't
  cover something. Matching the reply is cruder than asking the model to
  self-report, and much cheaper — a tool call per turn to grade an answer would
  cost more than the signal is worth, and the prompt prescribes the wording.

  A false positive here costs a question appearing on a list it didn't belong
  on. A false negative costs a gap going unnoticed, which is the failure worth
  avoiding, so the patterns lean generous.
*/
const REFUSALS = [
  /not something i have/i,
  /don'?t have (that|anything|any details|information)/i,
  /isn'?t (in|something in) (his|the) (record|portfolio|profile)/i,
  /\bno(t)? (record|mention|details?|info(rmation)?) (of|about)/i,
  /couldn'?t find (anything|any)/i,
  /nothing on file/i,
  /i don'?t know/i,
];

export function looksUnanswered(reply: string): boolean {
  return REFUSALS.some((p) => p.test(reply));
}

export async function logQuestion(
  raw: string,
  options: { answered?: boolean; kind?: "question" | "role_interest" } = {},
): Promise<void> {
  const question = raw.trim().slice(0, MAX_LENGTH);
  if (!question) return;

  try {
    const db = getServiceClient();
    if (!db) return;
    await db.from("chat_questions").insert({
      question,
      answered: options.answered ?? true,
      kind: options.kind ?? "question",
    });
  } catch (err) {
    console.error("[analytics] failed to log question:", err);
  }
}
