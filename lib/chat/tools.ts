import { tool } from "ai";
import { z } from "zod";
import { resumeLinks } from "@/lib/resume";
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
  | { ok: true; action: "resume"; url: string }
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

export function buildTools(portfolio: Portfolio) {
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

    openResume: tool({
      description:
        "Offer Anhat's resume. Use when the visitor asks for a CV, resume, or a document to download.",
      inputSchema: z.object({}),
      execute: async (): Promise<ToolOutcome> => {
        const resume = resumeLinks(portfolio.profile.resumeUrl);
        if (!resume) {
          return {
            ok: false,
            error: "No resume link is configured yet. Tell the visitor to use the contact form instead.",
          };
        }
        // The viewer, deliberately — the explicit buttons download, but a chat
        // reply that silently drops a file into Downloads is hostile. The
        // visitor can download from the preview if they want it.
        return { ok: true, action: "resume", url: resume.viewUrl };
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
