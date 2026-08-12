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

/*
  The host, or a short stand-in.

  Returning the raw string on failure — which this used to do — turned one
  malformed result into an eighty-character line of encoded redirect token
  sitting where a domain should be. Nothing that arrives from a search engine
  is trusted to be a URL, so the fallback is bounded.
*/
function domainOf(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    // Punycode and very long subdomains both exist; neither belongs in a
    // narrow dock at full length.
    return host.length > 40 ? `${host.slice(0, 39)}…` : host;
  } catch {
    return "source";
  }
}

/** Only absolute http(s) links are rendered — a relative one resolves against
    this site and lands the visitor on a 404 of ours. */
function isLinkable(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function SourceList({
  topic,
  results,
}: {
  topic: string;
  results: Array<{ title: string; url: string }>;
}) {
  // Belt and braces: research.ts drops these at ingestion, but a stored or
  // replayed outcome from before that fix would still be in a transcript.
  const linkable = results.filter((r) => isLinkable(r.url));
  if (!linkable.length) return null;

  return (
    <div className="mt-2 rounded-[var(--radius)] border border-hairline bg-surface p-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">
        Looked up · {topic}
      </p>

      <ol className="mt-2 space-y-1">
        {linkable.map((r, i) => (
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
              {/* truncate, not wrap: a long headline that reflows to four
                  lines pushes the rest of the list off the panel. */}
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
