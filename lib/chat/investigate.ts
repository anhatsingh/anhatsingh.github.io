import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { skillTenure } from "@/lib/content/skill-tenure";
import { collectVocabulary, termKey } from "@/lib/content/vocabulary";
import type { Portfolio } from "@/lib/content/types";

/*
  Looking before answering.

  The assistant answers from whatever is already in front of it, which is fine
  for "what's his email" and thin for "is he more a data person or a backend
  one?". A question like that deserves a pass over the record before a sentence
  gets written, and one model reading one context in one go does not make that
  pass — it writes the first plausible shape and defends it.

  So three readers, in parallel, each with a narrow brief and the same record.
  Narrow is the point: a lens asked only "what do the dates say" answers that
  properly, where the same model asked everything at once answers the easiest
  part well and the rest approximately.

  They run at once, so three angles cost about the wall-clock of one — the same
  argument researchTopic already makes for its three queries. That matters:
  the whole request has thirty seconds, most of a turn's step budget is already
  spoken for, and this has to fit inside one tool call.
*/

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

/*
  Room to think, not room to ramble.

  This was 400, on the reasoning that a lens returning three paragraphs just
  moves the synthesis problem. Every lens then failed: the model reasons in
  output tokens, so 400 was consumed before a single character of JSON existed
  and generateObject got nothing to parse. Exactly the failure the reply cap in
  app/api/chat/route.ts had, one level down.

  Brevity is the schema's job — `finding` is capped at 600 characters and the
  brief asks for two or three sentences. This is the ceiling that says
  something went wrong, not the instruction to be short, so it sits well clear
  of what a lens actually spends: the three run in parallel and come back in
  about six seconds together, and a harder question should be able to think
  longer without hitting a wall it cannot report.
*/
const MAX_LENS_TOKENS = 5000;

export interface Lens {
  key: "timeline" | "evidence" | "weakness";
  label: string;
  brief: string;
}

export const LENSES: Lens[] = [
  {
    key: "timeline",
    label: "what the dates say",
    brief:
      "Read the dated record only. When did this happen, in what order, and for how long? Where a DURATIONS block is given below, those figures are already computed — quote them, never recompute them, and never add up dates yourself. If the record does not date something, say so.",
  },
  {
    key: "evidence",
    label: "what the record backs",
    brief:
      "Find the specific entries that support an answer, and name each by its CONTENT INDEX id. Quote the concrete detail — the system, the scale, the outcome — rather than restating a job title. An entry you cannot point at does not exist.",
  },
  {
    key: "weakness",
    /*
      The one that earns its keep. Two readers gathering supporting evidence
      produce advertising; the trust this assistant runs on comes from naming
      the gap before a recruiter finds it in an interview.
    */
    label: "where it is thin",
    brief:
      "Argue the other side. What would a sceptical recruiter probe here, and what does the record genuinely NOT support? Name the thinnest part of the case plainly. Do not soften it, and do not invent a strength to balance it.",
  },
];

export interface Finding {
  lens: Lens["key"];
  label: string;
  finding: string;
  itemIds: string[];
}

export type InvestigationResult =
  | { ok: true; question: string; findings: Finding[]; durations: string }
  | { ok: false; error: string };

const findingSchema = z.object({
  finding: z
    .string()
    .max(600)
    .describe("What you found, in two or three sentences. Concrete and specific. No preamble, no hedging."),
  itemIds: z
    .array(z.string())
    .max(5)
    .describe("Exact CONTENT INDEX ids you relied on, e.g. 'experience:data-scientist-axtria'. Empty if none apply."),
});

/*
  Any skill the question names, with its duration precomputed.

  The lenses are told to quote these rather than derive them, which is the same
  split the career-tenure figure already uses: arithmetic in code, meaning in
  the model. Without it the TIMELINE lens does exactly what the main model was
  forbidden from doing, one level down and unsupervised.
*/
export function durationsFor(portfolio: Portfolio, question: string): string {
  const asked = termKey(question);
  const named = collectVocabulary(portfolio)
    .filter((term) => term.key.length > 2 && asked.includes(term.key))
    // Longest first: a question naming "machine learning" should not be
    // reported as being about "learning".
    .sort((a, b) => b.key.length - a.key.length)
    .slice(0, 4);

  if (!named.length) return "";

  const lines = named
    .map((term) => skillTenure(portfolio, term.name).summary)
    .filter(Boolean);

  return lines.length ? `## DURATIONS (already computed — quote these, do not recalculate)\n${lines.join("\n")}` : "";
}

/** One reader. Extracted so both the streaming and batch forms share it. */
async function readWith(lens: Lens, question: string, durations: string, context: string): Promise<Finding> {
  const { object } = await generateObject({
    model: openai(MODEL),
    schema: findingSchema,
    system:
      `You are one of three readers examining an engineer's record to answer a question. ` +
      `Your brief is narrow and you must stay inside it — another reader is covering the rest.\n\n` +
      `YOUR BRIEF: ${lens.brief}\n\n` +
      `Answer only from the RECORD below. If it does not support something, say so rather than reaching. ` +
      `You are not writing the final answer, you are handing findings to whoever does — so be terse and concrete.`,
    /*
      The question is fenced as data for the same reason a visitor turn is in
      the main prompt: it is a stranger's text arriving in the same window as
      the instructions.
    */
    prompt: `<question>${question}</question>\n\n${durations ? `${durations}\n\n` : ""}## RECORD\n${context}`,
    maxOutputTokens: MAX_LENS_TOKENS,
    maxRetries: 1,
  });

  return { lens: lens.key, label: lens.label, finding: object.finding, itemIds: object.itemIds };
}

/*
  The readings, yielded as each one lands rather than all at the end.

  They finish several seconds apart, and holding the first until the slowest
  returns means a visitor watches a spinner through work that is already done.
  Streaming turns the wait into the interesting part — you see it read the
  dates, then the evidence, then argue the other side.

  Racing the same promise objects rather than re-wrapping them each pass: a
  fresh .then() per iteration would build a new promise every loop and leak one
  per lens per turn.
*/
export async function* investigateStream(
  question: string,
  context: string,
  portfolio: Portfolio,
): AsyncGenerator<Finding> {
  const durations = durationsFor(portfolio, question);

  const tasks = LENSES.map((lens, i) =>
    readWith(lens, question, durations, context).then(
      (finding) => ({ i, finding }),
      (err) => {
        // One lens failing costs that angle, not the investigation.
        console.error(`[investigate] ${lens.key} failed:`, err);
        return { i, finding: null as Finding | null };
      },
    ),
  );

  const remaining = new Map(tasks.map((task, i) => [i, task]));
  while (remaining.size) {
    const done = await Promise.race(remaining.values());
    remaining.delete(done.i);
    if (done.finding) yield done.finding;
  }
}

/** The durations block for a question, so a caller can show it alongside. */
export function durationsBlock(portfolio: Portfolio, question: string): string {
  return durationsFor(portfolio, question);
}

/**
 * Three readings of the same record, at once.
 *
 * Never throws. A lens that fails drops out and the rest still answer — a
 * partial investigation beats losing the turn, and the caller can see which
 * angles came back.
 */
export async function investigate(
  question: string,
  context: string,
  portfolio: Portfolio,
): Promise<InvestigationResult> {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, error: "Not configured for this." };
  }

  const durations = durationsFor(portfolio, question);

  const results = await Promise.allSettled(
    LENSES.map((lens) => readWith(lens, question, durations, context)),
  );

  const findings = results
    .filter((r): r is PromiseFulfilledResult<Finding> => r.status === "fulfilled")
    .map((r) => r.value);

  if (!findings.length) {
    console.error("[investigate] every lens failed");
    return { ok: false, error: "Couldn't get through the record just now." };
  }

  return { ok: true, question, findings, durations };
}

/** The findings as one block for the model that writes the answer. */
export function formatFindings(result: Extract<InvestigationResult, { ok: true }>): string {
  const parts = result.findings.map(
    (f) => `### ${f.label.toUpperCase()}\n${f.finding}${f.itemIds.length ? `\nIds: ${f.itemIds.join(", ")}` : ""}`,
  );

  return (
    `<investigation>\n${result.durations ? `${result.durations}\n\n` : ""}${parts.join("\n\n")}\n</investigation>\n\n` +
    `Write the answer from these. Lead with what the record supports, and include what the third reading found thin — ` +
    `a recruiter checks that in the interview, and saying it first is what makes the rest credible.`
  );
}
