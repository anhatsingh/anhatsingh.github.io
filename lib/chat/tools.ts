import { tool } from "ai";
import { z } from "zod";
import {
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
  | { ok: true; action: "resume"; url: string }
  | { ok: true; action: "draft"; name?: string; email?: string; message: string }
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
        const url = portfolio.profile.resumeUrl;
        if (!url) {
          return {
            ok: false,
            error: "No resume link is configured yet. Tell the visitor to use the contact form instead.",
          };
        }
        return { ok: true, action: "resume", url };
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
