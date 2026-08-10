import { openai } from "@ai-sdk/openai";
import { embed } from "ai";
import { listPublishedResumes, type StoredResume } from "./store";

/*
  Picks the resume variant that fits what a visitor says they're hiring for.

  This runs on the server, and that placement is the feature rather than an
  implementation detail. The chatbot asks an open question and never receives
  the list of variants, so it cannot offer a menu, cannot hint that variants
  exist, and cannot be talked into revealing them. A prompt instruction saying
  "don't list the options" would be one clever visitor away from failing; not
  having the options is not.

  scripts/verify-tools.ts asserts the system prompt contains no variant label,
  which is what keeps that guarantee honest as the code changes.
*/

const EMBEDDING_MODEL = "text-embedding-3-small";

/*
  Below this, a match is a guess.

  Cosine similarity between an off-hand phrase and a keyword list runs high in
  general — unrelated technical text still lands around 0.3-0.5 — so the floor
  sits above that band. Under it the default is served, which is a better
  outcome than confidently handing a backend CV to someone hiring designers.
*/
const CONFIDENCE_FLOOR = 0.62;

/** An exact keyword hit is strong evidence; this nudges it over the line. */
const KEYWORD_BOOST = 0.08;

export interface MatchResult {
  url: string;
  label: string | null;
  /** How the choice was made — surfaced in logs, never to the visitor. */
  how: "matched" | "default" | "fallback" | "none";
  score?: number;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Counts keywords that appear literally in what the visitor said.
 *
 * Word-boundary matched, so "go" doesn't fire on "algorithm" and "R" doesn't
 * fire on every capital R in the sentence.
 */
function keywordHits(interest: string, keywords: string[]): number {
  const haystack = interest.toLowerCase();
  return keywords.filter((k) => {
    const needle = k.toLowerCase().trim();
    if (!needle) return false;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
  }).length;
}

export function scoreResume(
  interest: string,
  interestEmbedding: number[] | null,
  resume: StoredResume,
): number {
  const semantic =
    interestEmbedding && resume.embedding ? cosine(interestEmbedding, resume.embedding) : 0;
  const hits = keywordHits(interest, resume.keywords);
  // One hit is worth a nudge; three aren't worth three nudges, or a variant
  // that lists twenty keywords would win on volume alone.
  const boost = hits > 0 ? KEYWORD_BOOST * Math.min(hits, 2) : 0;
  return semantic + boost;
}

/**
 * The variant to serve, given what the visitor said.
 *
 * Falls back in order: best match above the floor, then the marked default,
 * then the static resume link on the profile — so this behaves exactly as the
 * site did before any variants existed.
 */
export async function matchResume(
  interest: string,
  fallbackUrl: string | null,
): Promise<MatchResult> {
  const resumes = await listPublishedResumes();

  if (!resumes.length) {
    return fallbackUrl
      ? { url: fallbackUrl, label: null, how: "fallback" }
      : { url: "", label: null, how: "none" };
  }

  const fallback = (): MatchResult => {
    const def = resumes.find((r) => r.isDefault) ?? resumes[0];
    if (def) return { url: def.pdfUrl, label: def.label, how: "default" };
    return fallbackUrl
      ? { url: fallbackUrl, label: null, how: "fallback" }
      : { url: "", label: null, how: "none" };
  };

  if (interest.trim().length < 3) return fallback();

  let interestEmbedding: number[] | null = null;
  if (process.env.OPENAI_API_KEY) {
    try {
      const { embedding } = await embed({
        model: openai.textEmbeddingModel(EMBEDDING_MODEL),
        value: interest,
      });
      interestEmbedding = embedding;
    } catch (err) {
      // Degrade to keyword-only matching rather than failing the request.
      console.error("[resume] couldn't embed the interest:", err);
    }
  }

  let best: StoredResume | null = null;
  let bestScore = 0;
  for (const resume of resumes) {
    const score = scoreResume(interest, interestEmbedding, resume);
    if (score > bestScore) {
      bestScore = score;
      best = resume;
    }
  }

  if (!best || bestScore < CONFIDENCE_FLOOR) return fallback();
  return { url: best.pdfUrl, label: best.label, how: "matched", score: bestScore };
}

export { CONFIDENCE_FLOOR };
