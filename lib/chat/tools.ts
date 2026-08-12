import { tool } from "ai";
import { z } from "zod";
import { resumeLinks } from "@/lib/resume";
import { matchResume } from "@/lib/resume/match";
import { listPublishedResumes } from "@/lib/resume/store";
import { formatResults, MAX_QUERIES, research } from "./research";
import { logQuestion } from "./analytics";
import {
  entityPath,
  entityTypeForId,
  NAVIGABLE_SECTIONS,
  SECTION_LABELS,
  addressableIds,
  type Portfolio,
  type SectionId,
} from "@/lib/content/types";

/*
  TOOL CONTRACT
  =============
  These are the only things the chatbot can do to the page.

  The critical property: tools are built PER REQUEST, closed over the real
  portfolio, so every id the model supplies is checked against content that
  actually exists. A hallucinated "experience:google" is rejected here and the
  model is told why — it never reaches the browser to produce a callout pinned
  to nothing.

  Note what is absent: there is no sendEmail tool. draftContactMessage only
  renders a card; a human has to click Send. That means no prompt injection can
  make the model mail anything.
*/

export const MAX_HIGHLIGHTS = 3;

/** Shape the client reads off tool parts to drive the UI. */
export type ToolOutcome =
  | { ok: true; action: "focus"; section: SectionId; label: string; reason?: string }
  | { ok: true; action: "highlight"; items: Array<{ itemId: string; note: string }> }
  | { ok: true; action: "clear" }
  | { ok: true; action: "navigate"; url: string; label: string; reason?: string }
  | { ok: true; action: "resume"; url: string; label?: string }
  | { ok: true; action: "resumeList"; resumes: Array<{ label: string; url: string }> }
  /*
    Carries no payload on purpose. It tells the client to render the role
    suggestions it already has from the server; the model never receives the
    variant names, so it still cannot list them in prose or be argued into
    revealing them. The options are controls beside the answer, not something
    the assistant said.
  */
  | { ok: true; action: "roleOptions" }
  /*
    A planned walk through the site, handed over whole.

    The steps arrive in one call rather than a step per reply on purpose. The
    visitor drives it — Next, Previous, or hand it the wheel — and a round trip
    to the model between stops would make every button press cost a wait, with
    the answer arriving somewhere below the fold. Planning is the model's job;
    pacing is the reader's.
  */
  | {
      ok: true;
      action: "tour";
      steps: Array<{
        section: SectionId;
        /** Section name, as it reads on the Next / Previous buttons. */
        label: string;
        /** What to say at this stop. */
        note: string;
        items: Array<{ itemId: string; note: string }>;
      }>;
    }
  /** Three questions that follow from the answer, offered as one-click prompts. */
  | { ok: true; action: "followUps"; questions: string[] }
  /*
    Sources behind an answer. Rendered as a citation list, because a claim
    drawn from the open web is only as good as the link under it.
  */
  | {
      ok: true;
      action: "sources";
      topic: string;
      /** Titles and links, for the citation card. */
      results: Array<{ title: string; url: string }>;
      /**
       * The snippets, fenced as untrusted web text. Read by the model, ignored
       * by the client — the visitor gets links, the model gets the content.
       */
      content: string;
    }
  | { ok: true; action: "draft"; name?: string; email?: string; message: string }
  | {
      ok: true;
      action: "fit";
      verdict: "strong" | "partial" | "weak";
      matches: Array<{ itemId: string; requirement: string }>;
      gaps: string[];
      summary: string;
    }
  | { ok: false; error: string };

export interface ToolContext {
  /**
   * Whether this visitor may run another web search.
   *
   * Passed in rather than checked here because the budget is per-IP and tools
   * are built without a request. The route owns the request; this owns the
   * behaviour.
   */
  canSearch?: () => boolean;
  /**
   * Lets search run against the subject's own name.
   *
   * Off for visitors, because results are other people with the same name and
   * a public answer cannot tell them apart. On for Anhat, who can — checking
   * his own online presence is a reasonable thing for him to want, and he is
   * the one reading it.
   */
  allowSubjectSearch?: boolean;
  /**
   * The entry whose page the visitor is currently reading, if any.
   *
   * Without it the assistant offers to open the page somebody is already on,
   * and a link card that goes nowhere reads as a broken answer.
   */
  currentItemId?: string | null;
}

export function buildTools(portfolio: Portfolio, ctx: ToolContext = {}) {
  const known = addressableIds(portfolio);

  return {
    focusSection: tool({
      description:
        "Scroll the page to a section and enter focus view. Use when your answer is about content that lives in a specific section, so the visitor can see it while you talk.",
      inputSchema: z.object({
        section: z
          .enum(NAVIGABLE_SECTIONS as [SectionId, ...SectionId[]])
          .describe("Which section to bring into view."),
        reason: z
          .string()
          .max(80)
          .optional()
          .describe("Short human-readable why, e.g. 'His RAG work is here'. Shown to screen readers."),
      }),
      execute: async ({ section, reason }): Promise<ToolOutcome> => ({
        ok: true,
        action: "focus",
        section,
        label: SECTION_LABELS[section],
        reason,
      }),
    }),

    highlightItems: tool({
      description:
        `Pin a short callout onto up to ${MAX_HIGHLIGHTS} specific items that answer the question. ` +
        "Only use ids from the CONTENT INDEX in your context. Each note should say why that item is relevant, in under 12 words.",
      inputSchema: z.object({
        items: z
          .array(
            z.object({
              itemId: z.string().describe("Exact id from the CONTENT INDEX, e.g. 'experience:ml-engineer-acme'."),
              note: z.string().max(90).describe("Why this item answers the question. Very short."),
            }),
          )
          .min(1)
          .max(MAX_HIGHLIGHTS),
      }),
      execute: async ({ items }): Promise<ToolOutcome> => {
        const accepted: Array<{ itemId: string; note: string }> = [];
        const rejected: string[] = [];

        for (const item of items) {
          if (known.has(item.itemId)) accepted.push(item);
          else rejected.push(item.itemId);
        }

        if (!accepted.length) {
          // Give the model the valid vocabulary so its retry can succeed rather
          // than failing the same way twice.
          return {
            ok: false,
            error:
              `None of those ids exist: ${rejected.join(", ")}. ` +
              `Valid ids are: ${[...known.keys()].join(", ")}`,
          };
        }

        return { ok: true, action: "highlight", items: accepted };
      },
    }),

    openPage: tool({
      description:
        "Open an item's own page, where the full write-up lives. Use ONLY for ids listed under HAS A FULL WRITE-UP — for anything else, highlight it on the current page instead. This navigates the visitor away, so don't do it for a question a highlight answers.",
      inputSchema: z.object({
        itemId: z.string().describe("Exact id from the CONTENT INDEX."),
        reason: z
          .string()
          .max(80)
          .optional()
          .describe("Why this page answers the question. Shown on the link."),
      }),
      execute: async ({ itemId: id, reason }): Promise<ToolOutcome> => {
        /*
          They're already reading it. Offering a link to the page somebody is
          standing on reads as a broken answer, and the navigation itself is a
          no-op that costs a step.
        */
        if (ctx.currentItemId && ctx.currentItemId === id) {
          return {
            ok: false,
            error:
              "They are already on that page. Answer from its record instead of offering to open it.",
          };
        }

        const entry = known.get(id);
        if (!entry) {
          return {
            ok: false,
            error: `No such id: ${id}. Valid ids are: ${[...known.keys()].join(", ")}`,
          };
        }

        const type = entityTypeForId(id);
        if (!type) {
          return {
            ok: false,
            error: `${id} has no page of its own. Use highlightItems to point at it instead.`,
          };
        }

        const slug = id.slice(id.indexOf(":") + 1);
        return { ok: true, action: "navigate", url: entityPath(type, slug), label: entry.label, reason };
      },
    }),

    clearFocus: tool({
      description:
        "Leave focus view and return the page to its normal full-width layout. Use when the conversation moves off site content.",
      inputSchema: z.object({}),
      execute: async (): Promise<ToolOutcome> => ({ ok: true, action: "clear" }),
    }),

    researchTopic: tool({
      description:
        "Search the web to explain a technology, company or concept that appears in CONTEXT — " +
        "what dbt is, what a company builds, how a technique works. Give up to 3 short, distinct " +
        "queries and they run at once. NEVER search for facts about the person this site is " +
        "about: search returns other people with similar names, and everything about him is " +
        "already in CONTEXT.",
      inputSchema: z.object({
        topic: z
          .string()
          .min(2)
          .max(80)
          .describe("What you're looking up, in a few words. Shown to the visitor."),
        queries: z
          .array(z.string().min(3).max(120))
          .min(1)
          .max(MAX_QUERIES)
          .describe("Distinct angles on the same question. They run in parallel."),
      }),
      execute: async ({ topic, queries }): Promise<ToolOutcome> => {
        if (ctx.canSearch && !ctx.canSearch()) {
          return {
            ok: false,
            error:
              "You've used this visitor's search allowance. Answer from CONTEXT, and say plainly " +
              "that you couldn't look it up rather than guessing.",
          };
        }

        const found = await research(
          queries,
          ctx.allowSubjectSearch ? null : portfolio.profile.name,
        );
        if (!found.ok) return { ok: false, error: found.error };

        /*
          The snippets go back to the model as fenced, untrusted text; the
          client gets titles and links only. Two audiences, two shapes — the
          visitor needs somewhere to click, the model needs the content and a
          reminder of where it came from.
        */
        return {
          ok: true,
          action: "sources",
          topic,
          results: found.results.map((r) => ({ title: r.title, url: r.url })),
          content: formatResults(found.results),
        };
      },
    }),

    suggestFollowUps: tool({
      description:
        "Offer three questions the visitor might naturally ask next. Call this once, AFTER you " +
        "have written your answer, on every substantive reply. Skip it for greetings, one-word " +
        "replies and goodbyes, where a menu of questions is clutter.",
      inputSchema: z.object({
        questions: z
          .array(z.string().min(8).max(90))
          .length(3)
          .describe(
            "Written in the visitor's voice, as they would type them. Specific to what was just " +
              "discussed — not generic prompts that would fit any answer. Each should open a " +
              "genuinely different direction rather than rephrasing the others.",
          ),
      }),
      execute: async ({ questions }): Promise<ToolOutcome> => {
        /*
          Deduplicated and trimmed here rather than trusted. Three near-identical
          questions look worse than none, and the model reaches for variations on
          a theme when the answer was narrow.
        */
        const unique = [...new Set(questions.map((q) => q.trim()).filter(Boolean))];
        if (unique.length < 2) {
          return { ok: false, error: "Give three genuinely different questions, or skip this." };
        }
        return { ok: true, action: "followUps", questions: unique };
      },
    }),

    suggestRoles: tool({
      description:
        "Show the visitor a few quick answers to pick from, right after you ask what role " +
        "they are hiring for. Call it in the same turn as the question. It returns nothing " +
        "for you to read — the options are rendered on screen, not spoken.",
      inputSchema: z.object({}),
      execute: async (): Promise<ToolOutcome> => ({ ok: true, action: "roleOptions" }),
    }),

    selectResume: tool({
      description:
        "Give the visitor Anhat's resume, tailored to the role they described. " +
        "Call this ONLY after they have said what kind of role or work they have in mind, " +
        "passing their answer verbatim as `interest`. If they decline to say, or just want " +
        "the file, call it with an empty interest and they get the general one.",
      inputSchema: z.object({
        interest: z
          .string()
          .max(400)
          .describe("What the visitor said they are hiring for, in their own words. Empty if they didn't say."),
      }),
      execute: async ({ interest }): Promise<ToolOutcome> => {
        /*
          Matching happens in here, not in the model. The model is never given
          the list of variants, so it cannot offer a menu, cannot hint that
          variants exist, and cannot be talked into naming them. That is a
          structural guarantee rather than a prompt instruction — and
          scripts/verify-tools.ts asserts the prompt stays free of them.
        */
        /*
          What people say they're hiring for is the most direct market signal
          this site collects, and until now it was read once to pick a variant
          and thrown away. Same table and same privacy rules as questions: the
          words, never who said them.
        */
        if (interest?.trim()) void logQuestion(interest, { kind: "role_interest" });

        const fallback = resumeLinks(portfolio.profile.resumeUrl)?.viewUrl ?? null;
        const match = await matchResume(interest ?? "", fallback);

        if (!match.url) {
          return {
            ok: false,
            error: "No resume is configured yet. Tell the visitor to use the contact form instead.",
          };
        }

        // Label omitted deliberately when nothing matched: naming the general
        // resume as a variant would reveal that variants exist at all.
        return match.how === "matched"
          ? { ok: true, action: "resume", url: match.url, label: match.label ?? undefined }
          : { ok: true, action: "resume", url: match.url };
      },
    }),

    listResumes: tool({
      description:
        "List every resume Anhat has published, with a link to each. Use ONLY when the visitor " +
        "explicitly asks to see all of them, or asks what versions exist.",
      inputSchema: z.object({}),
      execute: async (): Promise<ToolOutcome> => {
        const resumes = await listPublishedResumes();

        if (!resumes.length) {
          const fallback = resumeLinks(portfolio.profile.resumeUrl)?.viewUrl;
          if (!fallback) {
            return { ok: false, error: "No resume is configured yet." };
          }
          return { ok: true, action: "resume", url: fallback };
        }

        // Labels and links only. Keywords describe how matching works and the
        // postings behind them are private; neither belongs on a public page.
        return {
          ok: true,
          action: "resumeList",
          resumes: resumes.map((r) => ({ label: r.label, url: r.pdfUrl })),
        };
      },
    }),

    assessFit: tool({
      description:
        "Analyse a pasted job description against Anhat's actual experience. Use this whenever the visitor pastes or describes a role. Be honest — a verdict of 'weak' with real gaps is more useful to a recruiter than false enthusiasm, and overclaiming is what gets a candidate rejected at interview.",
      inputSchema: z.object({
        verdict: z
          .enum(["strong", "partial", "weak"])
          .describe("Overall fit. Judge against evidence in CONTEXT, not optimism."),
        matches: z
          .array(
            z.object({
              itemId: z
                .string()
                .describe("Exact id from the CONTENT INDEX that evidences this requirement."),
              requirement: z
                .string()
                .max(90)
                .describe("The requirement from the JD this item satisfies. Quote it briefly."),
            }),
          )
          .max(6)
          .describe("Requirements you can evidence. Omit anything you cannot point at."),
        gaps: z
          .array(z.string().max(110))
          .max(5)
          .describe("Requirements with no evidence in CONTEXT. State them plainly, without excuses."),
        summary: z
          .string()
          .max(400)
          .describe("Two or three sentences a hiring manager could paste into a decision."),
      }),
      execute: async ({ verdict, matches, gaps, summary }): Promise<ToolOutcome> => {
        // Same id discipline as highlightItems: a fabricated reference in a fit
        // report is worse than a missing one, because it reads as evidence.
        const accepted = matches.filter((m) => known.has(m.itemId));

        return {
          ok: true,
          action: "fit",
          verdict,
          matches: accepted,
          gaps,
          summary,
        };
      },
    }),

    runTour: tool({
      description:
        "Plan a guided walk through the site and hand it to the visitor as a stepper they control. " +
        "Call this ONCE, with every stop, when someone asks to be shown around, for the highlights, " +
        "or for the short version — do NOT call focusSection or highlightItems for a tour, this does both " +
        "at each stop. Order the stops so the case builds: what he does now, the work that backs it up, " +
        "the shape of the whole thing, then how to reach him. Skip a stop rather than including an empty section.",
      inputSchema: z.object({
        steps: z
          .array(
            z.object({
              section: z
                .enum(NAVIGABLE_SECTIONS as [SectionId, ...SectionId[]])
                .describe("Which section this stop is about."),
              note: z
                .string()
                .max(220)
                .describe(
                  "What to say at this stop, in one or two sentences. This is the narration — the visitor reads it at their own pace, so make it worth the stop.",
                ),
              items: z
                .array(
                  z.object({
                    itemId: z.string().describe("Exact id from the CONTENT INDEX."),
                    note: z.string().max(90).describe("Why this one. Very short."),
                  }),
                )
                .max(MAX_HIGHLIGHTS)
                .describe("What to pin at this stop. Empty is fine for a section that speaks for itself."),
            }),
          )
          .min(2)
          .max(6)
          .describe("The stops, in the order they should be walked."),
      }),
      execute: async ({ steps }): Promise<ToolOutcome> => {
        /*
          An unknown id drops out rather than failing the tour. A walk through
          the site is worth more than the one callout the model got wrong, and
          the stop still lands on the right section.
        */
        const planned = steps.map((step) => ({
          section: step.section,
          label: SECTION_LABELS[step.section],
          note: step.note,
          items: step.items.filter((item) => known.has(item.itemId)),
        }));

        return { ok: true, action: "tour", steps: planned };
      },
    }),

    draftContactMessage: tool({
      description:
        "Compose a message to Anhat and show the visitor a confirmation card. This does NOT send anything — the visitor must review and click Send themselves. Collect name, email and message conversationally first; call this only once you have at least the message body.",
      inputSchema: z.object({
        name: z.string().max(80).optional().describe("Visitor's name, if given."),
        email: z.string().max(160).optional().describe("Visitor's email, if given."),
        message: z.string().min(10).max(1500).describe("The message body, written in the visitor's voice."),
      }),
      execute: async ({ name, email, message }): Promise<ToolOutcome> => ({
        ok: true,
        action: "draft",
        name,
        email,
        message,
      }),
    }),
  };
}

export type PortfolioTools = ReturnType<typeof buildTools>;
