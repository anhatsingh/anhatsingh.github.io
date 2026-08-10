"use client";

import { useEffect, useState } from "react";
import { CheckIcon, DocumentIcon, ExternalIcon, LinkIcon } from "@/components/ui/icons";

/*
  The card left behind after a resume is handed over.

  Opening a tab is a one-shot event: the visitor switches away, comes back, and
  the only trace is a pill reading "opened resume". If they closed that tab, or
  want to forward the link to a colleague, there was nothing to act on. So the
  transcript keeps a card — what it was, a way to open it again, and a way to
  copy the link.

  Copy matters more than it looks. The likeliest thing a recruiter does next is
  paste this into an ATS or an email to a hiring manager, and asking them to
  re-open a tab just to grab the URL from the address bar is a poor way to
  treat the one moment they wanted something from the page.
*/

export function ResumeCard({ url, label }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  // Revert the confirmation, but only while the component is still mounted —
  // the dock can be closed mid-timeout.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /*
        Clipboard access is refused on insecure origins and in some embedded
        browsers. Selecting the link is the fallback: the visitor can still
        copy it by hand, which is strictly better than a dead button that
        claims to have worked.
      */
      window.prompt("Copy the link:", url);
    }
  }

  return (
    <div className="mt-2 overflow-hidden rounded-[var(--radius)] border border-accent/30 bg-surface">
      <div className="flex items-start gap-3 p-4">
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] bg-accent/10 text-accent"
          aria-hidden="true"
        >
          <DocumentIcon className="h-4.5 w-4.5" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Resume · PDF</p>
          {/* Falls back to something neutral: when nothing matched well enough
              the variant has no name worth showing. */}
          <p className="mt-0.5 truncate text-sm font-medium">{label || "Anhat Singh — CV"}</p>
        </div>
      </div>

      <div className="flex border-t border-hairline">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-1 items-center justify-center gap-2 border-r border-hairline px-3 py-2.5 font-mono text-[11px] uppercase tracking-widest text-accent transition-colors hover:bg-accent/10"
        >
          <ExternalIcon className="h-3.5 w-3.5" />
          Open
        </a>

        <button
          type="button"
          onClick={copy}
          // Announces the state change without needing a visible live region.
          aria-live="polite"
          className="flex flex-1 items-center justify-center gap-2 px-3 py-2.5 font-mono text-[11px] uppercase tracking-widest text-muted transition-colors hover:bg-elevated hover:text-text"
        >
          {copied ? (
            <>
              <CheckIcon className="h-3.5 w-3.5 text-success" />
              <span className="text-success">Copied</span>
            </>
          ) : (
            <>
              <LinkIcon className="h-3.5 w-3.5" />
              Copy link
            </>
          )}
        </button>
      </div>
    </div>
  );
}
