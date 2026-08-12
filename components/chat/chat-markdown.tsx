"use client";

import { InlineMarkdown } from "@/components/blocks/inline-markdown";

/*
  Block structure for chat replies.

  The model writes markdown — lists, bold, the occasional heading — and the dock
  was printing it raw, so answers arrived full of asterisks and hyphens. Telling
  the model to stop would have been the wrong fix: a list of three things really
  is clearer as a list, and that is what it reaches for.

  Inline spans are handled by InlineMarkdown, which already covers bold, italic,
  code and links and builds React elements directly, so nothing reaches
  dangerouslySetInnerHTML. This adds only what it deliberately leaves out:
  paragraphs, bullet lists, numbered lists and headings.

  It has to survive streaming. Text arrives a token at a time, so every render
  sees a half-finished document — an unclosed "**", a list marker with nothing
  after it yet. Nothing here throws on a partial line; the worst case is a
  fragment rendering as plain text for a few hundred milliseconds until the
  rest arrives.
*/

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "h"; text: string };

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

/** Groups lines into blocks. One pass, no lookahead beyond the current line. */
function parse(text: string): Block[] {
  const blocks: Block[] = [];

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const last = blocks[blocks.length - 1];

    if (!line.trim()) {
      // A blank line ends whatever was open; it doesn't start anything.
      if (last && last.kind === "p") blocks.push({ kind: "p", lines: [] });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "h", text: heading[1] });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      if (last?.kind === "ul") last.items.push(bullet[1]);
      else blocks.push({ kind: "ul", items: [bullet[1]] });
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered) {
      if (last?.kind === "ol") last.items.push(numbered[1]);
      else blocks.push({ kind: "ol", items: [numbered[1]] });
      continue;
    }

    // Consecutive plain lines are one paragraph — the model wraps mid-sentence
    // and rendering each line as its own block would double the spacing.
    if (last?.kind === "p") last.lines.push(line);
    else blocks.push({ kind: "p", lines: [line] });
  }

  return blocks.filter((b) => (b.kind === "p" ? b.lines.length > 0 : true));
}

export function ChatMarkdown({ text }: { text: string }) {
  const blocks = parse(text);

  return (
    <div className="space-y-2 leading-relaxed">
      {blocks.map((block, i) => {
        if (block.kind === "h") {
          return (
            <p key={i} className="font-medium text-text">
              <InlineMarkdown text={block.text} />
            </p>
          );
        }

        if (block.kind === "ul") {
          return (
            <ul key={i} className="space-y-1">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                  <span className="min-w-0">
                    <InlineMarkdown text={item} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }

        if (block.kind === "ol") {
          return (
            <ol key={i} className="space-y-1">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2">
                  <span className="shrink-0 font-mono text-xs text-accent tabular-nums">
                    {j + 1}.
                  </span>
                  <span className="min-w-0">
                    <InlineMarkdown text={item} />
                  </span>
                </li>
              ))}
            </ol>
          );
        }

        return (
          <p key={i}>
            <InlineMarkdown text={block.lines.join(" ")} />
          </p>
        );
      })}
    </div>
  );
}
