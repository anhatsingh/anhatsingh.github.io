import { itemId, SECTION_LABELS, type SectionId } from "@/lib/content/types";

/*
  What the visitor is actually looking at.

  The assistant knows everything about Anhat and nothing about where the person
  it's talking to happens to be — so "explain what's on my screen" had no answer,
  and neither did "what does this mean?" about a phrase someone just highlighted.
  Both are among the most natural things to ask a chat window that sits on top
  of a page.

  So a small description of the current view travels with each message. Kept
  small on purpose: the route already has the entire portfolio in CONTEXT, so
  the useful thing to send is not the content but the *pointer* — which page,
  which section, which entry — which the model can then look up properly rather
  than working from whatever text happened to be rendered.
*/

export interface PageContext {
  /** Current route, e.g. "/projects/course-compass". */
  path: string;
  /** Heading of the page, when there is one. */
  title?: string;
  /** Section of the homepage currently filling most of the viewport. */
  visibleSection?: SectionId;
  /** Text the visitor selected with the mouse, when they asked about it. */
  selection?: string;
}

/** Detail routes, mapped back to the id namespace the content index uses. */
const PATH_SECTIONS: Record<string, SectionId> = {
  experience: "experience",
  projects: "projects",
  skills: "skills",
  education: "education",
  certifications: "education",
  // Posts live at /blog because that's what people type; the id namespace
  // they're addressed by is "writing".
  blog: "writing",
};

/**
 * The addressable id of the entry a detail route is showing, if it is one.
 *
 * Giving the model an id rather than a page title is what lets it answer from
 * the record instead of from the heading — it can find the entry in CONTEXT and
 * talk about what's actually stored, including the parts not on screen.
 */
export function idForPath(path: string): string | null {
  const [, head, slug] = path.split("/");
  if (!head || !slug) return null;

  const section = PATH_SECTIONS[head];
  if (!section) return null;

  return itemId(section, decodeURIComponent(slug));
}

/**
 * The context block appended to the system prompt.
 *
 * Empty string when there is nothing worth saying, so the prompt doesn't gain a
 * section announcing that the visitor is on the homepage doing nothing.
 */
export function describeScreen(ctx: PageContext | undefined): string {
  if (!ctx?.path) return "";

  const lines: string[] = [];

  const id = idForPath(ctx.path);
  if (id) {
    lines.push(`They are reading the page for ${id}. Its full record is in CONTEXT above.`);
  } else if (ctx.path === "/") {
    lines.push(
      ctx.visibleSection
        ? `They are on the homepage, scrolled to ${SECTION_LABELS[ctx.visibleSection]}.`
        : "They are on the homepage.",
    );
  } else {
    lines.push(`They are on ${ctx.path}.`);
  }

  if (ctx.title) lines.push(`The heading on screen reads "${ctx.title}".`);

  if (ctx.selection?.trim()) {
    /*
      Fenced like every other piece of text this system didn't write. It came
      off the page rather than out of a visitor's keyboard, but the page can
      show admin-authored content and a selection is still just text arriving
      from outside the prompt.
    */
    lines.push(
      `They highlighted this text and want to know about it:\n<selected_text>\n${ctx.selection
        .replace(/<\/?selected_text>/gi, "")
        .slice(0, 600)}\n</selected_text>`,
    );
  }

  return lines.join("\n");
}

/** Strips anything oversized or absent before it reaches the prompt. */
export function sanitizePageContext(raw: unknown): PageContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;

  const path = typeof value.path === "string" ? value.path.slice(0, 200) : "";
  if (!path.startsWith("/")) return undefined;

  const section =
    typeof value.visibleSection === "string" && value.visibleSection in SECTION_LABELS
      ? (value.visibleSection as SectionId)
      : undefined;

  return {
    path,
    title: typeof value.title === "string" ? value.title.slice(0, 160) : undefined,
    visibleSection: section,
    selection: typeof value.selection === "string" ? value.selection.slice(0, 600) : undefined,
  };
}
