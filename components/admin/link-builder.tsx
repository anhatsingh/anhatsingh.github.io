"use client";

import { useMemo, useState } from "react";
import { taggedUrl } from "@/lib/analytics/source";
import { SITE_URL } from "@/lib/seo";

/*
  Makes the tagged links, because attribution fails for one boring reason:
  links get shared untagged, and then every visit files as "direct".

  The presets are the channels this site is actually promoted through. Typing
  utm_source by hand once per application is how you end up with "linkedin",
  "LinkedIn" and "linked-in" as three separate rows.
*/

const PRESETS: Array<{ label: string; source: string; medium: string }> = [
  { label: "Job application", source: "application", medium: "email" },
  { label: "Cold email", source: "outreach", medium: "email" },
  { label: "LinkedIn profile", source: "linkedin", medium: "profile" },
  { label: "LinkedIn post", source: "linkedin", medium: "post" },
  { label: "Hacker News", source: "hacker-news", medium: "post" },
  { label: "GitHub readme", source: "github", medium: "profile" },
  { label: "Résumé PDF", source: "resume", medium: "pdf" },
  { label: "MS application", source: "grad-application", medium: "form" },
];

export function LinkBuilder() {
  const [preset, setPreset] = useState(PRESETS[0]);
  const [campaign, setCampaign] = useState("");
  const [path, setPath] = useState("/");
  const [copied, setCopied] = useState(false);

  const url = useMemo(
    () =>
      taggedUrl(`${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`, {
        source: preset.source,
        medium: preset.medium,
        campaign: campaign || undefined,
      }),
    [preset, campaign, path],
  );

  return (
    <section>
      <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Tagged links</h2>
      <p className="mt-2 text-sm text-muted">
        Paste these instead of the bare address. The campaign is free text — a company name on an
        application, a post title on a launch — and it&apos;s what tells two links from the same
        channel apart.
      </p>

      <div className="mt-4 space-y-3 rounded-[var(--radius)] border border-hairline bg-surface p-4">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setPreset(p)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                preset.label === p.label
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-hairline text-muted hover:border-accent/50 hover:text-text"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
              Campaign
            </span>
            <input
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              placeholder="razorpay, cmu-ms, hn-launch"
              className="mt-1 w-full rounded border border-hairline bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent/50"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
              Landing page
            </span>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/"
              className="mt-1 w-full rounded border border-hairline bg-bg px-2 py-1.5 font-mono text-sm outline-none focus:border-accent/50"
            />
          </label>
        </div>

        <div className="flex gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded border border-hairline bg-bg px-2 py-1.5 font-mono text-xs outline-none"
          />
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                /* The field is right there and selectable. */
              }
            }}
            className="shrink-0 rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </section>
  );
}
