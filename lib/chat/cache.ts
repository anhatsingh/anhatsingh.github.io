import { createHash, randomUUID } from "node:crypto";
import { getServiceClient } from "@/lib/supabase/server";

/*
  Caching the one question everybody asks.

  "Show me around" is the most expensive reply the assistant produces — a
  seven-stop route, planned across the whole portfolio — and it is also the
  same reply every time, because the prompt fixes the route rather than leaving
  it to the model. Paying for that on every visit buys nothing.

  Deliberately narrow. Only questions whose answer does not depend on the
  conversation are cacheable, and there is exactly one of those today. A cache
  that guessed at "similar enough" questions would eventually serve someone an
  answer to a question they didn't ask, which is a worse failure than a bill.
*/

/** Anything matching this asks for the tour, whatever else is in the sentence. */
const TOUR = /\b(show me around|give me (a |the )?tour|walk me (a)?round|the short version|show me the highlights)\b/i;

export function isTourRequest(question: string): boolean {
  return TOUR.test(question);
}

/**
 * The build this reply belongs to.
 *
 * The prompt, the tool schema and the route all ship in the bundle, so a reply
 * generated against the previous one is not stale — it's answering a question
 * that no longer exists. Scoping by deploy makes a release invalidate the lot
 * without a job to run.
 */
export function deployId(): string {
  return (
    process.env.VERCEL_DEPLOYMENT_ID ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_BUILD_ID ??
    "dev"
  );
}

/** Case and punctuation shouldn't split the cache. */
export function cacheKey(question: string): string {
  const normalised = question.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalised).digest("hex");
}

const MAX_AGE_HOURS = 24;

/*
  Ids are rewritten on the way out.

  The stored payload carries the message id and tool call ids from the visitor
  who first asked. Replaying them verbatim would be fine across visitors — each
  has their own transcript — but not for somebody who asks twice in one
  session: React would see two messages with the same key and render one.

  Every distinct id is mapped to a fresh one, consistently within the payload,
  so the parts of a message still refer to each other.
*/
export function freshenIds(payload: string): string {
  const seen = new Map<string, string>();
  const fresh = (old: string) => {
    const existing = seen.get(old);
    if (existing) return existing;
    const next = randomUUID();
    seen.set(old, next);
    return next;
  };

  return payload
    // Anchored on the delimiter so this can't touch "itemId" or "toolCallId".
    .replace(/([{,])"id":"([^"]+)"/g, (_m, delim: string, id: string) => `${delim}"id":"${fresh(id)}"`)
    .replace(/"toolCallId":"([^"]+)"/g, (_m, id: string) => `"toolCallId":"${fresh(id)}"`);
}

/** The stored stream for a question, or null if there isn't a live one. */
export async function readCached(question: string): Promise<string | null> {
  const db = getServiceClient();
  if (!db) return null;

  const since = new Date(Date.now() - MAX_AGE_HOURS * 3600_000).toISOString();

  const { data, error } = await db
    .from("chat_cache")
    .select("id, payload, hit_count")
    .eq("question_hash", cacheKey(question))
    .eq("deploy_id", deployId())
    .gte("created_at", since)
    .maybeSingle();

  if (error || !data?.payload) return null;

  // Fire-and-forget: a counter is not worth delaying a reply for.
  void db
    .from("chat_cache")
    .update({ hit_count: (data.hit_count as number) + 1 })
    .eq("id", data.id as string);

  return freshenIds(data.payload as string);
}

/**
 * Stores a reply, replacing whatever this build had for the same question.
 *
 * Never throws. A cache that fails is a cache that misses, and the visitor
 * whose reply is being stored has already received it.
 */
export async function writeCached(question: string, payload: string): Promise<void> {
  const db = getServiceClient();
  if (!db || !payload) return;

  try {
    await db.from("chat_cache").upsert(
      {
        question_hash: cacheKey(question),
        question,
        deploy_id: deployId(),
        payload,
        hit_count: 0,
        created_at: new Date().toISOString(),
      },
      { onConflict: "question_hash,deploy_id" },
    );
  } catch (err) {
    console.error("[chat-cache] write failed:", err);
  }
}
