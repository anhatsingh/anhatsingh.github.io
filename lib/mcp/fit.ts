import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { getPortfolio } from "@/lib/content";
import { serializePortfolio } from "@/lib/chat/context";
import { addressableIds } from "@/lib/content/types";

/*
  A fit assessment for an agent that asked for one.

  The site's own assessFit is a tool the model fills in — the judgement is the
  model's and the tool only checks the ids. There is no server-side function
  that turns a job description into a verdict, so this is that function.

  It is the one thing here that is not a wrapper over an existing reader, and
  the one that makes the server useful to a recruiter's tooling rather than a
  data dump. It also costs a model call, which is the argument for the endpoint
  being behind a token rather than open.
*/

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

/*
  Nullable never optional, every field described as an instruction — the
  convention lib/resume/schema.ts documents. OpenAI's structured outputs reject
  an optional property outright.
*/
const fitSchema = z.object({
  verdict: z
    .enum(["strong", "partial", "weak"])
    .describe("Judge against evidence in the RECORD, not optimism. Most honest answers are partial."),
  matches: z
    .array(
      z.object({
        requirement: z.string().max(120).describe("The requirement from the posting, quoted briefly."),
        evidence: z.string().max(220).describe("What in the record satisfies it. Concrete — the system, the scale, the outcome."),
        itemId: z.string().describe("The exact id from the RECORD that evidences it."),
      }),
    )
    .max(8)
    .describe("Only requirements you can point at. If you cannot cite an id, it belongs in gaps."),
  gaps: z
    .array(z.string().max(160))
    .max(8)
    .describe("Requirements the record does not support. State them plainly, with no excuses and no 'but he learns fast'."),
  summary: z
    .string()
    .max(600)
    .describe("Two or three sentences a hiring manager could paste into a decision."),
});

export type FitAssessment =
  | (z.infer<typeof fitSchema> & { ok: true })
  | { ok: false; error: string };

export async function assessFitAgainst(jobDescription: string): Promise<FitAssessment> {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, error: "Fit assessment isn't configured on this server." };
  }

  const portfolio = await getPortfolio();
  const known = addressableIds(portfolio);

  try {
    const { object } = await generateObject({
      model: openai(MODEL),
      schema: fitSchema,
      system:
        "You are assessing whether one engineer fits one role, for a reader deciding whether to interview him. " +
        "Judge only from the RECORD below — never from what is typical for someone with his background. " +
        "A partial verdict with real gaps is worth more than false enthusiasm: overclaiming gets him rejected at " +
        "interview rather than screened in, which is worse for everyone. Name the gaps first and without softening.",
      /*
        Fenced as data. A job description is a stranger's text arriving in the
        same window as the instructions — the same treatment a visitor message
        and a search result already get.
      */
      prompt: `<job_description>\n${jobDescription}\n</job_description>\n\n## RECORD\n${serializePortfolio(portfolio)}`,
      maxOutputTokens: 3000,
      maxRetries: 2,
    });

    /*
      Ids checked against the real index, as highlightItems does. A cited id
      that does not exist is a claim pointing at nothing, and an agent has no
      way to tell.
    */
    return {
      ok: true,
      ...object,
      matches: object.matches.filter((m) => known.has(m.itemId)),
    };
  } catch (err) {
    console.error("[mcp] fit assessment failed:", err);
    return { ok: false, error: "Couldn't complete the assessment." };
  }
}
