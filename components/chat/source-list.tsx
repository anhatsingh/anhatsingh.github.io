"use client";

import { ExternalIcon } from "@/components/ui/icons";

/*
  Where an answer's outside information came from.

  Anything the assistant says about Anhat is grounded in his own database and
  needs no citation. Anything it says about the wider world came off the open
  web, and the difference matters to a reader deciding what to trust — so those
  claims get their sources listed under the answer, every time, without the
  assistant having to remember to do it.

  Domains rather than full URLs. "postgis.net" tells you what you need at a
  glance; a 90-character URL with tracking parameters does not, and wrapping
  onto three lines in a narrow dock helps nobody.
*/

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function SourceList({
  topic,
  results,
}: {
  topic: string;
  results: Array<{ title: string; url: string }>;
}) {
  if (!results.length) return null;

  return (
    <div className="mt-2 rounded-[var(--radius)] border border-hairline bg-surface p-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">
        Looked up · {topic}
      </p>

      <ol className="mt-2 space-y-1">
        {results.map((r, i) => (
          <li key={r.url} className="flex gap-2">
            {/* Numbered so the assistant's prose can point at one if it needs
                to, without pasting a URL into the sentence. */}
            <span
              className="mt-0.5 shrink-0 font-mono text-[10px] tabular-nums text-muted"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="group min-w-0 flex-1"
            >
              <span className="block truncate text-sm text-text group-hover:text-accent">
                {r.title}
              </span>
              <span className="flex items-center gap-1 font-mono text-[10px] text-muted">
                {domainOf(r.url)}
                <ExternalIcon className="h-2.5 w-2.5" />
              </span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
