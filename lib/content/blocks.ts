import { z } from "zod";

/*
  THE BLOCK MODEL
  ===============
  A page body is an ordered list of typed blocks stored as JSON, not a markdown
  blob. That costs more admin UI, and buys three things a blob can't:

   1. The chatbot reads structure. A `video` block is "a demo video", not an
      iframe tag it has to guess at. Same for a repo, a code sample, a step list.
   2. Blocks render natively — real embeds, real syntax highlighting, real
      responsive images — rather than sanitised HTML.
   3. Retrieval chunks on block boundaries, so a code sample is never split in
      half by an arbitrary character count.

  Validated with zod rather than trusted as a TypeScript type, because the same
  shape arrives from three untrusted directions: the admin form, LLM-generated
  drafts, and jsonb read back from Postgres that may predate a schema change.
*/

const textBlock = z.object({
  type: z.literal("text"),
  /* Inline markdown only — bold, italic, links, inline code. Block-level
     structure is what the other block types are for. */
  markdown: z.string(),
});

const headingBlock = z.object({
  type: z.literal("heading"),
  /* h2 and h3 only. The page title is the h1, and anything below h3 signals
     the post should have been split in two. */
  level: z.union([z.literal(2), z.literal(3)]),
  text: z.string(),
});

const codeBlock = z.object({
  type: z.literal("code"),
  language: z.string().default("text"),
  code: z.string(),
  filename: z.string().optional(),
});

const imageBlock = z.object({
  type: z.literal("image"),
  url: z.string(),
  /* Required, not optional. An optional alt field is an empty alt field. */
  alt: z.string(),
  caption: z.string().optional(),
});

const videoBlock = z.object({
  type: z.literal("video"),
  url: z.string(),
  caption: z.string().optional(),
});

const githubBlock = z.object({
  type: z.literal("github"),
  /* "owner/name". Metadata is fetched at render time rather than stored, so a
     repo's description and language can't go stale in the database. */
  repo: z.string(),
  note: z.string().optional(),
});

const linkBlock = z.object({
  type: z.literal("link"),
  url: z.string(),
  title: z.string(),
  description: z.string().optional(),
});

const calloutBlock = z.object({
  type: z.literal("callout"),
  tone: z.enum(["note", "warning", "success"]).default("note"),
  text: z.string(),
});

const stepsBlock = z.object({
  type: z.literal("steps"),
  steps: z.array(z.object({ title: z.string(), body: z.string() })),
});

const embedBlock = z.object({
  type: z.literal("embed"),
  url: z.string(),
  height: z.number().optional(),
  /* Required: an iframe with no accessible name is unusable with a screen
     reader, and "demo" is a better default than nothing. */
  title: z.string(),
});

export const blockSchema = z.discriminatedUnion("type", [
  textBlock,
  headingBlock,
  codeBlock,
  imageBlock,
  videoBlock,
  githubBlock,
  linkBlock,
  calloutBlock,
  stepsBlock,
  embedBlock,
]);

export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block["type"];

/** Every type, in the order the admin's add-block menu offers them. */
export const BLOCK_TYPES: Array<{ type: BlockType; label: string; hint: string }> = [
  { type: "text", label: "Text", hint: "A paragraph. Inline markdown works." },
  { type: "heading", label: "Heading", hint: "Splits a long page into sections." },
  { type: "code", label: "Code", hint: "Syntax-highlighted, with an optional filename." },
  { type: "image", label: "Image", hint: "Upload or paste a URL." },
  { type: "video", label: "Video", hint: "YouTube, Vimeo or a direct MP4." },
  { type: "github", label: "GitHub repo", hint: "Live stars and description, fetched on render." },
  { type: "link", label: "Link card", hint: "A titled link out." },
  { type: "callout", label: "Callout", hint: "A note, warning or result worth pulling out." },
  { type: "steps", label: "Steps", hint: "A numbered usage guide." },
  { type: "embed", label: "Embed", hint: "An iframe — a live demo, a Space, a notebook." },
];

/**
 * Parses a stored body, DROPPING anything invalid rather than throwing.
 *
 * A body is jsonb written by an older version of this schema, by the AI, or by
 * hand in the SQL editor. One malformed block must degrade to one missing block
 * — not a 500 on a page that's otherwise fine.
 */
export function parseBlocks(input: unknown): Block[] {
  if (!Array.isArray(input)) return [];

  const blocks: Block[] = [];
  for (const candidate of input) {
    const result = blockSchema.safeParse(candidate);
    if (result.success) blocks.push(result.data);
    else if (process.env.NODE_ENV !== "production") {
      console.warn("[blocks] dropped an invalid block:", result.error.issues[0]?.message);
    }
  }
  return blocks;
}

/**
 * Flattens blocks to prose.
 *
 * Deliberately ONE implementation, because four things depend on it agreeing
 * with itself: reading time, SEO descriptions, the chatbot's context, and RAG
 * chunking. A missing case here would silently shorten all four at once, which
 * is why scripts/verify-blocks.ts asserts every block type contributes.
 */
export function blocksToPlainText(blocks: Block[]): string {
  const parts: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "text":
        // Strip inline markdown so the text reads as prose to an embedding model.
        parts.push(
          block.markdown
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .replace(/[*_`]/g, ""),
        );
        break;
      case "heading":
        parts.push(block.text);
        break;
      case "code":
        // The code itself is noise for retrieval; what it IS carries the signal.
        parts.push(`Code sample${block.filename ? ` (${block.filename})` : ""} in ${block.language}.`);
        break;
      case "image":
        if (block.caption) parts.push(block.caption);
        else if (block.alt) parts.push(block.alt);
        break;
      case "video":
        parts.push(block.caption ? `Video: ${block.caption}` : "Video demo.");
        break;
      case "github":
        parts.push(`GitHub repository ${block.repo}.${block.note ? ` ${block.note}` : ""}`);
        break;
      case "link":
        parts.push(`${block.title}.${block.description ? ` ${block.description}` : ""}`);
        break;
      case "callout":
        parts.push(block.text);
        break;
      case "steps":
        parts.push(block.steps.map((s, i) => `${i + 1}. ${s.title}. ${s.body}`).join(" "));
        break;
      case "embed":
        parts.push(`Embedded demo: ${block.title}.`);
        break;
    }
  }

  return parts.filter(Boolean).join("\n\n").trim();
}

/** ~200 words per minute, floored at 1 so nothing reads "0 min". */
export function readingMinutes(blocks: Block[]): number {
  const words = blocksToPlainText(blocks).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function hasBody(blocks: Block[]): boolean {
  return blocks.length > 0;
}

/**
 * Normalises a video URL to something embeddable.
 *
 * Returns a `direct` kind for MP4/WebM so the renderer can use a real <video>
 * element — which is keyboard accessible and respects reduced-motion — instead
 * of wrapping everything in an iframe.
 */
export function normalizeVideoUrl(
  url: string,
): { kind: "iframe"; src: string } | { kind: "direct"; src: string } | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const host = parsed.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1);
    return id ? { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${id}` } : null;
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const id = parsed.searchParams.get("v") ?? parsed.pathname.match(/\/(?:embed|shorts)\/([\w-]+)/)?.[1];
    // youtube-nocookie doesn't set tracking cookies before playback starts.
    return id ? { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${id}` } : null;
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = parsed.pathname.match(/(\d+)/)?.[1];
    return id ? { kind: "iframe", src: `https://player.vimeo.com/video/${id}` } : null;
  }

  if (/\.(mp4|webm|ogg)$/i.test(parsed.pathname)) {
    return { kind: "direct", src: trimmed };
  }

  return { kind: "iframe", src: trimmed };
}
