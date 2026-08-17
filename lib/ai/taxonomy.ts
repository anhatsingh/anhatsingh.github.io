import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import type { Term } from "@/lib/content/vocabulary";
import type { Taxonomy } from "@/lib/admin/regroup";

/*
  Proposing the shape of the Skills section.

  The six headings on the site today came from a hardcoded array in
  scripts/tidy-skills.ts, applied once after the LinkedIn import. Everything
  added since has landed in "Other" at the bottom, and folding in thirty-six
  more terms by hand would mean editing that array again.

  So the model proposes and a human approves. Nothing here writes: the rule
  that requestShortSummary states — that nothing a model produces reaches the
  database without passing a person first — is why this returns a proposal
  rather than applying one.

  What it deliberately does NOT decide: whether a merge is safe, which slug a
  row keeps, what gets unpublished. Those are in lib/admin/regroup.ts, pure and
  tested, because they are the parts that fail silently.
*/

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

/*
  Nullable rather than optional, no defaults, every field described as an
  instruction — the convention lib/resume/schema.ts documents. OpenAI's
  structured output mode requires every property in `required`, and an optional
  field is rejected outright.
*/
const taxonomySchema = z.object({
  headings: z
    .array(
      z.object({
        name: z
          .string()
          .max(40)
          .describe("Two or three words. A recruiter should know what is under it without reading the badges."),
        rationale: z
          .string()
          .max(160)
          .describe("Why this heading exists and what belongs in it. Shown to the site's owner for approval, never published."),
      }),
    )
    .min(4)
    .max(6)
    .describe("In display order. The first one is what a recruiter reads first, so lead with what he is being hired for."),
  terms: z
    .array(
      z.object({
        term: z.string().describe("Exactly as it appears in the vocabulary you were given. Do not reword it."),
        canonical: z
          .string()
          .describe(
            "The name that should be displayed. Same as `term` normally. Set it to ANOTHER term's name only to fold a genuine alias — 'Apache Spark' into 'Spark' — never to group two different things.",
          ),
        heading: z.string().describe("Exactly one of the heading names above."),
      }),
    )
    .max(140)
    .describe("Every term you were given, exactly once."),
});

export type TaxonomyResult = { ok: true; taxonomy: Taxonomy } | { ok: false; error: string };

const PROMPT = `You are organising the Skills section of an engineer's portfolio. He is applying for machine-learning and backend roles, and this section is read by recruiters skimming for thirty seconds.

You get a vocabulary: every skill he lists, plus every technology named on his jobs and projects. Some of it is the same thing twice.

Group it into FOUR TO SIX headings, in the order a reader should meet them. Lead with what he is being hired for.

Fold genuine aliases together. "Apache Spark" and "Spark" are one thing; so are "Version Control (Git)" and "Git", "ETL Pipelines" and "ETL". Two things that merely sound similar are not — "Data Analysis" and "Data Science" stay apart, and so do "Java" and "JavaScript".

Some terms are not technologies: domains he has worked in, and things he has done. Pharmaceutical analytics, physician segmentation, call planning, teaching, leadership. Give them a heading of their own rather than scattering them through the technical ones or leaving them out — for a pharma or analytics role they are the differentiator, and "Leadership" filed under "Infrastructure" reads as though nobody looked.

Fold implementation detail into the capability it belongs to. "Push Notifications", "Local Storage", "App Store Publishing" and "Google Play Store Publishing" are things you do while building a mobile app, not skills anyone screens for — fold them into the capability that covers them. Same for "Shell" and "Shell Scripting", which are one thing written twice.

Aim for around fifty badges in total and no more than fourteen under any one heading. A section with eighty badges reads as "I ticked every box"; a curated one reads as somebody who knows what he is good at. Merging is how you get there — every term must still appear in your answer, so fold the weak ones into the strong one rather than dropping them.

Every term appears exactly once. Use the vocabulary's spelling verbatim; the number beside each term is how many of his jobs and projects name it, which is the best signal of what is a real skill and what was an implementation detail.`;

/** Renders the vocabulary compactly, with the evidence count that guides grouping. */
export function describeVocabulary(vocabulary: Term[]): string {
  return vocabulary
    .map((t) => {
      const marks = [t.isSkill ? "listed" : "from an entry", t.usedIn.length ? `used in ${t.usedIn.length}` : "unused"];
      return `- ${t.name} (${marks.join(", ")})`;
    })
    .join("\n");
}

export async function proposeTaxonomy(vocabulary: Term[]): Promise<TaxonomyResult> {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, error: "No OPENAI_API_KEY, so there's nothing to ask." };
  }
  if (vocabulary.length < 8) {
    // Below this there is nothing to group, and a model asked to invent six
    // headings for five skills will invent six headings.
    return { ok: false, error: "Not enough skills to be worth grouping yet." };
  }

  try {
    const { object } = await generateObject({
      model: openai(MODEL),
      schema: taxonomySchema,
      system: PROMPT,
      prompt: `The vocabulary, ${vocabulary.length} terms:\n\n${describeVocabulary(vocabulary)}`,
      maxRetries: 2,
    });

    return { ok: true, taxonomy: object };
  } catch (err) {
    console.error("[taxonomy] proposal failed:", err);
    return { ok: false, error: "Couldn't get a proposal back. Try again?" };
  }
}
