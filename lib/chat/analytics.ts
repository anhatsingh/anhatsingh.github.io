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

/*
  Declining because the question wasn't about Anhat at all.

  A different thing entirely from a gap, and it has to be tested first, because
  a scope decline often carries gap-ish wording ("I don't have anything on
  that") while being the assistant working correctly. Filed under the same
  heading it would turn the to-do list into a list of things nobody should
  write: someone asked how to handle Barack Obama, and no amount of content
  fixes that.
*/
const OFF_TOPIC = [
  /\bi (can )?only (help|talk|discuss|answer)/i,
  /\bonly (here to )?(help|talk|answer) (with|about)/i,
  /\b(that'?s|this is) (a bit )?outside (what|my)/i,
  /\bnot (really )?(what|something) i'?m here (for|to)/i,
  /\bstick to\b.{0,30}\b(portfolio|work|questions)/i,
  /\b(afraid|sorry),? (that'?s|i'?m) (not|off)\b.{0,20}\btopic\b/i,
];

export function looksOffTopic(reply: string): boolean {
  return OFF_TOPIC.some((p) => p.test(reply));
}

export function looksUnanswered(reply: string): boolean {
  return REFUSALS.some((p) => p.test(reply));
}

export type QuestionKind = "question" | "role_interest" | "off_topic";

/**
 * What to file a turn as, from the assistant's own reply.
 *
 * One place, so the three lists in the admin can't disagree about what a reply
 * meant. Order matters: off-topic is checked first, since a scope decline
 * frequently borrows the wording of a content gap.
 */
export function classifyReply(reply: string): { answered: boolean; kind: QuestionKind } {
  if (looksOffTopic(reply)) return { answered: false, kind: "off_topic" };
  return { answered: !looksUnanswered(reply), kind: "question" };
}

export async function logQuestion(
  raw: string,
  options: { answered?: boolean; kind?: QuestionKind } = {},
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

/**
 * Records what the visitor thought of an answer.
 *
 * Matched to the question rather than to a message id, because the question is
 * the only thing both sides already have — the client doesn't know the row it
 * created, and giving it one would mean handing out an identifier for a table
 * visitors cannot read.
 *
 * Most recent match wins. The same question asked twice in a session is rare
 * enough that the alternative — an identifier round-trip on every turn — costs
 * more than it fixes.
 */
export async function rateAnswer(raw: string, rating: 1 | -1): Promise<void> {
  const question = raw.trim().slice(0, MAX_LENGTH);
  if (!question) return;

  try {
    const db = getServiceClient();
    if (!db) return;

    const { data } = await db
      .from("chat_questions")
      .select("id")
      .eq("question", question)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return;
    await db.from("chat_questions").update({ rating }).eq("id", data.id as string);
  } catch (err) {
    console.error("[analytics] failed to rate answer:", err);
  }
}
