/*
  COST + ABUSE GUARDS
  ===================
  Deliberately in-memory. On Vercel each serverless instance keeps its own
  counters, so this is a soft limit, not a hard one — a determined attacker
  spreading across cold starts could exceed it.

  That trade is intentional: a durable counter means a database round trip on
  every message, which costs more latency than the abuse costs money at
  portfolio traffic. The real backstop is the token ceiling in the route plus
  the fact that no tool can spend money or send mail.

  If this ever gets genuinely abused, swap RATE_STORE for a Supabase table or
  Upstash — the interface below is the only thing callers touch.
*/

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
const MAX_PER_DAY_GLOBAL = 1500;

interface Bucket {
  count: number;
  resetAt: number;
}

const RATE_STORE = new Map<string, Bucket>();
let globalDay = { day: "", count: 0 };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Opportunistic cleanup so the map can't grow unbounded across a long-lived instance. */
function sweep(now: number) {
  if (RATE_STORE.size < 500) return;
  for (const [key, bucket] of RATE_STORE) {
    if (bucket.resetAt < now) RATE_STORE.delete(key);
  }
}

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  sweep(now);

  const day = today();
  if (globalDay.day !== day) globalDay = { day, count: 0 };
  if (globalDay.count >= MAX_PER_DAY_GLOBAL) {
    return { allowed: false, retryAfterSec: 3600 };
  }

  const bucket = RATE_STORE.get(ip);
  if (!bucket || bucket.resetAt < now) {
    RATE_STORE.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    globalDay.count++;
    return { allowed: true, retryAfterSec: 0 };
  }

  if (bucket.count >= MAX_PER_WINDOW) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count++;
  globalDay.count++;
  return { allowed: true, retryAfterSec: 0 };
}

/** Best-effort client IP behind Vercel's proxy. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Keep the last N turns. Rough but sufficient: portfolio conversations are
 * short, and dropping the oldest turns costs less than the complexity of
 * summarising them.
 */
export function trimHistory<T>(messages: T[], keep = 8): T[] {
  return messages.length <= keep ? messages : messages.slice(-keep);
}


/*
  Web search gets its own, much tighter budget.

  A chat turn costs one model call; a turn that searches costs that plus up to
  three Tavily queries against a metered quota. The general limit is sized for
  conversation, so search needs its own or one visitor holding the button down
  drains the month's allowance for everyone.

  Keyed separately from the chat limit — the same namespacing the contact route
  uses — so hitting the search cap still leaves the visitor able to talk.
*/
const SEARCH_PER_WINDOW = 6;
const SEARCH_WINDOW_MS = 10 * 60 * 1000;
const SEARCH_PER_DAY_GLOBAL = 300;

const SEARCH_STORE = new Map<string, { count: number; resetAt: number }>();
let searchDay = { day: today(), count: 0 };

export function checkSearchBudget(ip: string): boolean {
  const now = Date.now();

  const day = today();
  if (searchDay.day !== day) searchDay = { day, count: 0 };
  if (searchDay.count >= SEARCH_PER_DAY_GLOBAL) return false;

  const bucket = SEARCH_STORE.get(ip);
  if (!bucket || bucket.resetAt < now) {
    SEARCH_STORE.set(ip, { count: 1, resetAt: now + SEARCH_WINDOW_MS });
    searchDay.count++;
    return true;
  }

  if (bucket.count >= SEARCH_PER_WINDOW) return false;

  bucket.count++;
  searchDay.count++;
  return true;
}
