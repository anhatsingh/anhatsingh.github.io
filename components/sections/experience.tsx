"use client";

import Link from "next/link";
import { Highlightable, Section } from "./section";
import { LogoPlate } from "@/components/ui/logo-plate";
import { entityPath, itemId, type Experience as ExperienceItem } from "@/lib/content/types";

/** "2024-03" → "2024". Dates are stored loosely so admin entry stays painless. */
function year(value: string | null): string {
  if (!value) return "Present";
  return value.slice(0, 4);
}

export function Experience({ experience }: { experience: ExperienceItem[] }) {
  if (!experience.length) return null;

  return (
    <Section id="experience" eyebrow="02 — Experience" title="Where I've worked">
      <div className="space-y-12">
        {experience.map((e) => (
          <Highlightable key={e.slug} itemId={itemId("experience", e.slug)}>
            <article className="md:grid md:grid-cols-[7rem_1fr] md:gap-6">
              <p className="font-mono text-xs uppercase tracking-widest text-muted md:pt-1.5">
                {year(e.startDate)} — {year(e.endDate)}
              </p>

              <div className="mt-2 md:mt-0">
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
                        <span className="ml-1.5 font-mono text-sm text-muted" aria-hidden="true">
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

                <p className="mt-3 max-w-2xl leading-relaxed">{e.summary}</p>

                {e.highlights.length > 0 && (
                  <ul className="mt-3 max-w-2xl space-y-2">
                    {e.highlights.map((h, i) => (
                      <li key={i} className="flex gap-2 leading-relaxed text-muted">
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
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
        ))}
      </div>
    </Section>
  );
}
