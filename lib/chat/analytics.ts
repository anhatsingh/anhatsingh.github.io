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

export async function logQuestion(raw: string): Promise<void> {
  const question = raw.trim().slice(0, MAX_LENGTH);
  if (!question) return;

  try {
    const db = getServiceClient();
    if (!db) return;
    await db.from("chat_questions").insert({ question });
  } catch (err) {
    console.error("[analytics] failed to log question:", err);
  }
}
