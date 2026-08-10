import type { ReactNode } from "react";

/*
  Renders the small subset of markdown that text blocks allow: bold, italic,
  inline code, and links.

  Hand-rolled rather than pulling in a markdown library, because the block model
  already handles every block-level construct — headings, code, images, lists —
  as its own type. A full parser would ship a few hundred KB to support syntax
  this schema deliberately doesn't accept.

  It builds React elements directly, so nothing ever reaches
  dangerouslySetInnerHTML and no sanitiser is needed.
*/

// Ordered by precedence: code first, so `**not bold**` inside backticks stays literal.
const PATTERN = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g;

function renderSegment(segment: string, key: number): ReactNode {
  if (segment.startsWith("`") && segment.endsWith("`")) {
    return (
      <code
        key={key}
        className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[0.9em] text-accent"
      >
        {segment.slice(1, -1)}
      </code>
    );
  }

  if (segment.startsWith("[")) {
    const match = segment.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (match) {
      const [, label, href] = match;
      // Only http(s) — a javascript: or data: href in admin-authored text would
      // still be a self-inflicted XSS, and there's no reason to allow it.
      const safe = /^https?:\/\//i.test(href) || href.startsWith("/");
      if (!safe) return <span key={key}>{label}</span>;

      const external = href.startsWith("http");
      return (
        <a
          key={key}
          href={href}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
        >
          {label}
        </a>
      );
    }
  }

  if (segment.startsWith("**")) return <strong key={key}>{segment.slice(2, -2)}</strong>;
  if (segment.startsWith("*")) return <em key={key}>{segment.slice(1, -1)}</em>;
  if (segment.startsWith("_")) return <em key={key}>{segment.slice(1, -1)}</em>;

  return segment;
}

export function InlineMarkdown({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) nodes.push(text.slice(lastIndex, start));
    nodes.push(renderSegment(match[0], key++));
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));

  return <>{nodes}</>;
}
