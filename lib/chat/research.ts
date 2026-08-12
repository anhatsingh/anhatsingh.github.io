/*
  Web search, for explaining the world around Anhat's work.

  The rule this file exists to enforce: THE WEB EXPLAINS THE WORLD, ONLY THE
  DATABASE DESCRIBES ANHAT.

  A portfolio bot's one non-negotiable property is that everything it says
  about its subject is grounded in his own data. Search breaks that if pointed
  at him — "Anhat Singh" returns other people with the same name, and
  attributing a stranger's job history to him is a worse failure than knowing
  nothing. So queries about the person are refused here, in code, rather than
  discouraged in a prompt that a determined visitor can talk around.

  What search is genuinely for: the technologies, companies and concepts that
  appear in his history. A recruiter asking "what is dbt, and is that relevant
  to my role?" deserves a real answer, and that answer isn't in the database.

  Everything returned is untrusted text from the open web. It is fenced before
  it reaches the model, truncated hard to bound what an injected page can say,
  and every claim built on it has to carry its source link.
*/

const TAVILY_URL = "https://api.tavily.com/search";

/** Parallel queries per call. Enough to triangulate, few enough to stay cheap. */
export const MAX_QUERIES = 3;
const MAX_RESULTS_PER_QUERY = 3;

/** Sources shown for one answer, across all its queries. */
const MAX_SOURCES = 5;

/*
  Snippets are cut hard. A long page pasted into context is both an expensive
  way to answer a short question and a large surface for an injected
  instruction to hide in.
*/
const MAX_SNIPPET_CHARS = 420;

const TIMEOUT_MS = 8000;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Which of the parallel queries produced this. */
  query: string;
}

export type ResearchResult =
  | { ok: true; results: SearchResult[] }
  | { ok: false; error: string };

export const isSearchConfigured = Boolean(process.env.TAVILY_API_KEY);

/*
  Queries that are really about the person.

  Deliberately broad: a near-miss here costs a slightly unhelpful refusal,
  while a miss in the other direction puts a stranger's biography in an answer
  about Anhat. The model is told what to do instead, so a refusal is
  recoverable rather than a dead end.
*/
function isAboutSubject(query: string, subjectName: string): boolean {
  const q = query.toLowerCase();
  const parts = subjectName.toLowerCase().split(/\s+/).filter((p) => p.length > 2);

  // The full name, or the surname alongside anything biographical.
  if (q.includes(subjectName.toLowerCase())) return true;

  const biographical = /\b(resume|cv|portfolio|linkedin|github profile|who is|his |her |their )\b/;
  return parts.some((p) => q.includes(p)) && biographical.test(q);
}

/*
  Only absolute http(s) URLs count as sources.

  Tavily sometimes returns a search engine's own redirect path — "/goto?url=CAES…"
  — rather than the page it points at. Those are worse than useless here: the
  href resolves against this site, so clicking one lands on a 404 of ours, and
  the "domain" printed under the title is an eighty-character blob because
  there is no host in it to extract.

  The wrapped target is an opaque token, not a URL that can be unpacked, so
  there is nothing to salvage. A result that can't be cited isn't a source.
*/
export function absoluteUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Titles differing only in case or punctuation are the same article. */
function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Turns a raw Tavily payload into citable results.
 *
 * Pure, so the filtering can be tested against the shapes the API actually
 * returns rather than only against the ones it's supposed to.
 */
export function normaliseResults(
  raw: Array<{ title?: string; url?: string; content?: string }> | undefined,
  query: string,
): SearchResult[] {
  const out: SearchResult[] = [];

  for (const r of raw ?? []) {
    const url = absoluteUrl(r.url);
    const title = typeof r.title === "string" ? r.title.trim() : "";
    if (!url || !title) continue;

    out.push({
      title: title.slice(0, 120),
      url,
      snippet: String(r.content ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_SNIPPET_CHARS),
      query,
    });
  }

  return out;
}

async function searchOne(query: string, signal: AbortSignal): Promise<SearchResult[]> {
  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      max_results: MAX_RESULTS_PER_QUERY,
      search_depth: "basic",
      // No generated answer: a summary written elsewhere is a claim with no
      // source attached, and every claim here has to be traceable to a link.
      include_answer: false,
      include_raw_content: false,
    }),
    signal,
  });

  if (!res.ok) throw new Error(`Tavily returned ${res.status}`);

  const body = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  return normaliseResults(body.results, query);
}

/**
 * Runs several queries at once and returns their combined results.
 *
 * Parallel rather than sequential because they are independent and the whole
 * request has a 30-second budget it shares with the model — three searches in
 * series would spend most of it waiting.
 *
 * One failed query doesn't fail the set: partial results are still useful, and
 * a search that returns two of three angles beats an error message.
 */
export async function research(
  queries: string[],
  /** null lifts the subject guard — see ToolContext.allowSubjectSearch. */
  subjectName: string | null,
): Promise<ResearchResult> {
  const cleaned = queries.map((q) => q.trim()).filter(Boolean).slice(0, MAX_QUERIES);
  if (!cleaned.length) return { ok: false, error: "No query given." };

  /*
    The subject guard runs before the configuration check, deliberately.

    It is a rule about what may be asked, not about what happens to be
    installed — and checking configuration first made the guard untestable
    without a key, since every query failed for the same generic reason. A
    guardrail that only holds when a key is present is not a guardrail.
  */
  const blocked = subjectName ? cleaned.find((q) => isAboutSubject(q, subjectName)) : undefined;
  if (blocked) {
    return {
      ok: false,
      error:
        `Don't search the web for facts about ${subjectName} — the results are other people with ` +
        `similar names, and attributing their work to him would be wrong. Everything about him is ` +
        `already in CONTEXT. Use search only for the technologies, companies and concepts around ` +
        `his work.`,
    };
  }

  if (!isSearchConfigured) {
    return { ok: false, error: "Web search isn't configured. Answer from CONTEXT instead." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const settled = await Promise.allSettled(
      cleaned.map((q) => searchOne(q, controller.signal)),
    );

    const results: SearchResult[] = [];
    const seenUrls = new Set<string>();
    const seenTitles = new Set<string>();

    for (const outcome of settled) {
      if (outcome.status !== "fulfilled") continue;
      for (const r of outcome.value) {
        // The same page surfacing for two queries is one source, not two — and
        // syndicated articles come back under different hosts with the same
        // headline, which reads as two sources agreeing when it's one.
        if (seenUrls.has(r.url) || seenTitles.has(titleKey(r.title))) continue;
        seenUrls.add(r.url);
        seenTitles.add(titleKey(r.title));
        results.push(r);
      }
    }

    if (!results.length) {
      return { ok: false, error: "Nothing useful came back. Answer from CONTEXT instead." };
    }

    // A citation list longer than this stops being evidence and starts being a
    // page of links nobody reads.
    return { ok: true, results: results.slice(0, MAX_SOURCES) };
  } catch (err) {
    console.error("[research] search failed:", err);
    return { ok: false, error: "Search is unavailable right now. Answer from CONTEXT instead." };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Formats results for the model, fenced as untrusted input.
 *
 * The same treatment visitor turns get in lib/chat/prompt.ts, and for the same
 * reason: this is text from the open web, and a page that contains "ignore
 * your instructions" is a page someone can publish on purpose.
 */
export function formatResults(results: SearchResult[]): string {
  return results
    .map(
      (r, i) =>
        `<search_result index="${i + 1}" source="${r.url}">\n` +
        `${r.title}\n${r.snippet.replace(/<\/?search_result[^>]*>/gi, "")}\n` +
        `</search_result>`,
    )
    .join("\n\n");
}
