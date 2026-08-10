"use client";

import Link from "next/link";
import { Highlightable, Section } from "./section";
import { LogoPlate } from "@/components/ui/logo-plate";
import { buildTimeline, QUARTER_GAP_PX } from "@/lib/content/timeline";
import { entityPath, itemId, type Experience as ExperienceItem } from "@/lib/content/types";

/*
  A real timeline: newest at the top, a continuous rail down the left, and
  vertical space between two roles that reflects the actual time between them,
  quantised to three-month steps.

  The card carries `shortSummary` rather than `summary`. The long version is
  still there — it's what the detail page and the chatbot read — but a CV
  paragraph per role turned this section into a wall of text.
*/

export function Experience({ experience }: { experience: ExperienceItem[] }) {
  if (!experience.length) return null;

  const entries = buildTimeline(experience);

  return (
    <Section id="experience" eyebrow="02 — Experience" title="Where I've worked">
      <div className="relative">
        {/* The rail. Sits behind the nodes and stops short at both ends so the
            line doesn't appear to run off into nothing. */}
        <div
          className="absolute left-[7px] top-2 bottom-2 w-px bg-hairline md:left-[calc(9rem+7px)]"
          aria-hidden="true"
        />

        <ol className="space-y-0">
          {entries.map(({ item: e, duration, range, gapQuarters, gapLabel }) => (
            <li key={e.slug}>
              <Highlightable itemId={itemId("experience", e.slug)}>
                <article className="relative pl-7 md:grid md:grid-cols-[9rem_1fr] md:gap-0 md:pl-0">
                  {/* Dates: above the card on mobile, in their own column on
                      desktop where they read as the timeline's axis labels. */}
                  <div className="md:pr-7 md:text-right">
                    <p className="font-mono text-xs uppercase tracking-widest text-muted">
                      {range}
                    </p>
                    {duration && (
                      <p className="mt-0.5 font-mono text-[11px] text-muted/70">{duration}</p>
                    )}
                  </div>

                  {/* The node. Filled for a current role, hollow otherwise —
                      "present" is the one distinction worth seeing at a glance. */}
                  <span
                    className={`absolute left-0 top-1.5 h-[15px] w-[15px] rounded-full border-2 border-accent md:left-[9rem] ${
                      e.endDate ? "bg-bg" : "bg-accent"
                    }`}
                    aria-hidden="true"
                  />

                  <div className="mt-2 pb-8 md:mt-0 md:pl-7">
                    <div className="flex items-start gap-3">
                      <LogoPlate src={e.logoUrl} name={e.company} />

                      <div className="min-w-0">
                        {/* The role links; the company link inside it stays
                            separate, so nesting two anchors never happens. */}
                        <h3 className="font-display text-2xl leading-tight">
                          <Link
                            href={entityPath("experience", e.slug)}
                            className="transition-colors hover:text-accent"
                          >
                            {e.role}
                            <span
                              className="ml-1.5 font-mono text-sm text-muted"
                              aria-hidden="true"
                            >
                              →
                            </span>
                          </Link>
                        </h3>
                        <p className="mt-0.5">
                          {e.companyUrl ? (
                            <a
                              href={e.companyUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent hover:underline"
                            >
                              {e.company}
                            </a>
                          ) : (
                            <span className="text-accent">{e.company}</span>
                          )}
                          {e.location && (
                            <span className="font-mono text-xs text-muted"> · {e.location}</span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Falls back to the long summary so a role that hasn't had
                        a short one written yet still says something. */}
                    {(e.shortSummary || e.summary) && (
                      <p className="mt-3 max-w-2xl leading-relaxed text-muted">
                        {e.shortSummary || e.summary}
                      </p>
                    )}

                    {e.highlights.length > 0 && (
                      <ul className="mt-3 max-w-2xl space-y-2">
                        {e.highlights.map((h, i) => (
                          <li key={i} className="flex gap-2 leading-relaxed text-muted">
                            <span
                              className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent"
                              aria-hidden="true"
                            />
                            <span>{h}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {e.tech.length > 0 && (
                      <ul className="mt-4 flex flex-wrap gap-1.5">
                        {e.tech.map((t) => (
                          <li
                            key={t}
                            className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[11px] text-muted"
                          >
                            {t}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              </Highlightable>

              {/* Time nobody was employed is part of the story the timeline
                  tells, so it gets drawn rather than silently closed up. */}
              {gapQuarters > 0 && (
                <div
                  className="relative"
                  style={{ height: `${gapQuarters * QUARTER_GAP_PX}px` }}
                >
                  <span
                    className="absolute left-[7px] top-0 bottom-0 w-px border-l border-dashed border-hairline md:left-[calc(9rem+7px)]"
                    aria-hidden="true"
                  />
                  {gapLabel && (
                    <span className="absolute left-7 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase tracking-widest text-muted/60 md:left-[calc(9rem+1.75rem)]">
                      {gapLabel}
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
