import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { blockSchema, type Block } from "@/lib/content/blocks";
import type { EntityType, Skill } from "@/lib/content/types";

/*
  Turns a paragraph of "here's what I did" into structured content.

  generateObject rather than streamText: this needs one validated payload, not a
  conversation. The zod schema is enforced by the SDK, so a malformed response
  is retried by the model rather than reaching the review panel half-formed.

  Nothing here writes anything. It returns a proposal; applyDraft in
  app/admin/actions.ts writes only what the human ticked. That split is the
  whole safety model — see DEFAULT_AUTHOR_PROMPT on why.
*/

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

/*
  The instruction the model gets unless Anhat overrides it in the UI.

  The rule that matters most is the invention rule. A portfolio that overstates
  gets its owner rejected at interview rather than screened out at CV stage,
  which is strictly worse — you burn the interview and the relationship. So the
  model is told, repeatedly and specifically, that a thinner true page beats a
  richer invented one.
*/
export const DEFAULT_AUTHOR_PROMPT = `Rewrite this into a portfolio page for an AI/ML engineer.

Rules:
- Use ONLY facts present in the source text. Never invent metrics, dates, team sizes, company names or outcomes. If the source says "improved performance", do not turn it into "improved performance by 40%".
- Where the source gives a concrete number, keep it exactly.
- Lead with what was built and what changed as a result, not with responsibilities.
- Plain, direct sentences. No corporate filler — no "leveraged", "spearheaded", "passionate about", "cutting-edge".
- Keep his voice: dry, specific, a little understated.
- If the source is thin, produce a short page. Do not pad.`;

const skillSuggestion = z.object({
  name: z.string().describe("The skill as it should appear, e.g. 'PyTorch' not 'pytorch'."),
  evidence: z.string().max(120).describe("The phrase in the source text that supports it."),
});

const draftSchema = z.object({
  summary: z
    .string()
    .max(400)
    .describe("One or two sentences for the card and the page lead. Concrete, no filler."),
  highlights: z
    .array(z.string().max(200))
    .max(5)
    .describe("Bullet points of what was actually achieved. Only facts present in the source."),
  blocks: z
    .array(blockSchema)
    .max(12)
    .describe(
      "The page body. Prefer text and heading blocks; add code, callout or steps only if the source clearly warrants one. Never invent a repo, video or link URL.",
    ),
  skills: z
    .array(skillSuggestion)
    .max(15)
    .describe("Technologies and techniques the source text actually mentions or clearly implies."),
  keywords: z
    .array(z.string().max(40))
    .max(10)
    .describe("Search terms a recruiter might use to find this work."),
});

export interface SkillProposal {
  name: string;
  slug: string;
  evidence: string;
  /** True when no existing skill matches — flagged so a typo can't fork the taxonomy. */
  isNew: boolean;
}

export interface Draft {
  summary: string;
  highlights: string[];
  blocks: Block[];
  skills: SkillProposal[];
  keywords: string[];
}

export type DraftResult =
  | { ok: true; draft: Draft }
  | { ok: false; error: string };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

export async function draftFromParagraph({
  entityType,
  title,
  paragraph,
  prompt,
  existingSkills,
}: {
  entityType: EntityType;
  title: string;
  paragraph: string;
  prompt?: string;
  existingSkills: Skill[];
}): Promise<DraftResult> {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, error: "OPENAI_API_KEY isn't set, so drafting is unavailable." };
  }
  if (paragraph.trim().length < 40) {
    return { ok: false, error: "Give it a bit more to work with — a sentence or two at minimum." };
  }

  /*
    The existing skill list goes into the prompt so the model reuses established
    names. Without it you get "Pytorch", "PyTorch " and "torch" as three
    separate skills over three sessions.
  */
  const vocabulary = existingSkills.map((s) => s.name).join(", ");

  try {
    const { object } = await generateObject({
      model: openai(MODEL),
      schema: draftSchema,
      maxRetries: 2,
      system: `${prompt?.trim() || DEFAULT_AUTHOR_PROMPT}

This is for a ${entityType} entry titled "${title}".

Existing skill names on this site — reuse these exact spellings wherever they apply, and only propose a new name when nothing here fits:
${vocabulary || "(none yet)"}`,
      prompt: `Source text:\n\n${paragraph.trim()}`,
    });

    // Match proposals against what already exists, case-insensitively on both
    // name and slug, so "REST APIs" doesn't become a second "rest-apis".
    const bySlug = new Map(existingSkills.map((s) => [s.slug.toLowerCase(), s]));
    const byName = new Map(existingSkills.map((s) => [s.name.toLowerCase(), s]));

    const skills: SkillProposal[] = object.skills.map((s) => {
      const slug = slugify(s.name);
      const existing = byName.get(s.name.toLowerCase()) ?? bySlug.get(slug);
      return {
        name: existing?.name ?? s.name,
        slug: existing?.slug ?? slug,
        evidence: s.evidence,
        isNew: !existing,
      };
    });

    // Deduplicate — the model occasionally proposes the same skill twice under
    // slightly different names that both resolve to one existing row.
    const seen = new Set<string>();
    const deduped = skills.filter((s) => {
      if (seen.has(s.slug)) return false;
      seen.add(s.slug);
      return true;
    });

    return {
      ok: true,
      draft: {
        summary: object.summary,
        highlights: object.highlights,
        blocks: object.blocks,
        skills: deduped,
        keywords: object.keywords,
      },
    };
  } catch (err) {
    console.error("[author] draft failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? `Drafting failed: ${err.message}` : "Drafting failed.",
    };
  }
}

/*
  Condenses a role into a single line for the homepage timeline.

  Separate from draftFromParagraph because the job is different: that one
  expands a paragraph into a page and proposes skills, this one throws
  material away. Sharing a prompt between "write more" and "write less" would
  make both worse.

  Same invention rule applies, and it matters more here — compression is where
  a model is most tempted to smooth a specific claim into a grander vague one.
*/
const SHORT_SUMMARY_PROMPT = `Write ONE sentence describing this role for a CV timeline.

Rules:
- Use ONLY facts present in the source. Never invent metrics, scale, team sizes or outcomes.
- Aim for 15-25 words. Never exceed 200 characters.
- Lead with what he actually built or owned, not with responsibilities or values.
- Plain and direct. No corporate filler — no "leveraged", "spearheaded", "passionate about".
- No trailing period is fine. Do not start with the person's name or the job title.
- If the source is too thin to say anything specific, say the plain version rather than padding it.`;

export interface ShortSummarySource {
  role?: string;
  company?: string;
  summary?: string;
  highlights?: string;
}

export type ShortSummaryResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export async function generateShortSummary(
  source: ShortSummarySource,
): Promise<ShortSummaryResult> {
  const material = [
    source.role && `Role: ${source.role}`,
    source.company && `Company: ${source.company}`,
    source.summary && `Summary:\n${source.summary}`,
    source.highlights && `Highlights:\n${source.highlights}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Without source text the model would have nothing to compress and would
  // invent a plausible-sounding line, which is the one outcome to avoid.
  if (material.replace(/Role:|Company:/g, "").trim().length < 40) {
    return {
      ok: false,
      error: "Not enough to work from — write the full summary or some highlights first.",
    };
  }

  try {
    const { object } = await generateObject({
      model: openai(MODEL),
      schema: z.object({ text: z.string().min(1).max(200) }),
      system: SHORT_SUMMARY_PROMPT,
      prompt: material,
    });
    return { ok: true, text: object.text.trim() };
  } catch {
    return { ok: false, error: "Couldn't generate that. Try again in a moment." };
  }
}
