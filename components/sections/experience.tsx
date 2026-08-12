"use client";

import Link from "next/link";
import { Highlightable, Section } from "./section";
import { LogoPlate } from "@/components/ui/logo-plate";
import { buildTimeline, type TimelineRole } from "@/lib/content/timeline";
import { entityPath, itemId, type Experience as ExperienceItem } from "@/lib/content/types";

/*
  A timeline, newest at the top, with one block per employer.

  Consecutive roles at the same company are one tenure with the roles nested
  beneath it. Two separate blocks read as two unrelated jobs, which undersells a
  promotion and makes the career look choppier than it was.

  Employment gaps are not drawn. An earlier version spaced entries in proportion
  to the time between them and labelled the gaps, which turned every pause into
  a feature of the page — the one thing on a CV nobody wants emphasised, and
  rarely the thing the reader came for.
*/

/** The body of one role: summary, highlights, tech. Shared by both layouts. */
function RoleBody({ e }: { e: ExperienceItem }) {
  return (
    <>
      {/* Falls back to the long summary so a role nobody has shortened yet
          still says something. */}
      {(e.shortSummary || e.summary) && (
        <p className="mt-2 max-w-2xl leading-relaxed text-muted">{e.shortSummary || e.summary}</p>
      )}

      {e.highlights.length > 0 && (
        <ul className="mt-2.5 max-w-2xl space-y-2">
          {e.highlights.map((h, i) => (
            <li key={i} className="flex gap-2 leading-relaxed text-muted">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              <span>{h}</span>
            </li>
          ))}
        </ul>
      )}

      {e.tech.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
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
    </>
  );
}

function RoleTitle({ e, size }: { e: ExperienceItem; size: "lg" | "sm" }) {
  return (
    <h4 className={size === "lg" ? "font-display text-2xl leading-tight" : "text-base font-medium"}>
      <Link href={entityPath("experience", e.slug)} className="transition-colors hover:text-accent">
        {e.role}
        <span className="ml-1.5 font-mono text-sm text-muted" aria-hidden="true">
          →
        </span>
      </Link>
    </h4>
  );
}

export function Experience({ experience }: { experience: ExperienceItem[] }) {
  if (!experience.length) return null;

  const groups = buildTimeline(experience);

  return (
    <Section id="experience" eyebrow="02 — Experience" title="Where I've worked">
      <div className="relative">
        {/* The rail. Stops short at both ends so the line doesn't appear to run
            off into nothing. */}
        <div
          className="absolute left-[7px] top-2 bottom-2 w-px bg-hairline md:left-[calc(9rem+7px)]"
          aria-hidden="true"
        />

        <ol className="space-y-10">
          {groups.map((group) => {
            const multi = group.roles.length > 1;

            return (
              <li key={`${group.company}-${group.roles[0].item.slug}`}>
                <article className="relative pl-7 md:grid md:grid-cols-[9rem_1fr] md:gap-0 md:pl-0">
                  {/* Dates: above the block on mobile, in their own column on
                      desktop where they read as the timeline's axis. */}
                  <div className="md:pr-7 md:text-right">
                    <p className="font-mono text-xs uppercase tracking-widest text-muted">
                      {group.range}
                    </p>
                    {group.duration && (
                      <p className="mt-0.5 font-mono text-[11px] text-muted/70">{group.duration}</p>
                    )}
                  </div>

                  {/* Filled for a current role, hollow otherwise — "present" is
                      the one distinction worth seeing at a glance. */}
                  <span
                    className={`absolute left-0 top-1.5 h-[15px] w-[15px] rounded-full border-2 border-accent md:left-[9rem] ${
                      group.current ? "bg-accent" : "bg-bg"
                    }`}
                    aria-hidden="true"
                  />

                  <div className="mt-2 md:mt-0 md:pl-7">
                    <div className="flex items-start gap-3">
                      <LogoPlate src={group.logoUrl} name={group.company} />

                      <div className="min-w-0">
                        {/*
                          With one role the heading is the role and the company
                          sits under it. With several, the company leads and the
                          roles are the list beneath — the tenure is the thing
                          being described, not any single title.
                        */}
                        {multi ? (
                          <>
                            <h3 className="font-display text-2xl leading-tight">
                              {group.companyUrl ? (
                                <a
                                  href={group.companyUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="transition-colors hover:text-accent"
                                >
                                  {group.company}
                                </a>
                              ) : (
                                group.company
                              )}
                            </h3>
                            <p className="mt-0.5 font-mono text-xs text-muted">
                              {group.roles.length} roles
                              {group.location && <span> · {group.location}</span>}
                            </p>
                          </>
                        ) : (
                          <>
                            <RoleTitle e={group.roles[0].item} size="lg" />
                            <p className="mt-0.5">
                              {group.companyUrl ? (
                                <a
                                  href={group.companyUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-accent hover:underline"
                                >
                                  {group.company}
                                </a>
                              ) : (
                                <span className="text-accent">{group.company}</span>
                              )}
                              {group.location && (
                                <span className="font-mono text-xs text-muted">
                                  {" "}
                                  · {group.location}
                                </span>
                              )}
                            </p>
                          </>
                        )}
                      </div>
                    </div>

                    {multi ? (
                      /*
                        A second, lighter rail inside the block. It reads as
                        "these belong to the company above" without competing
                        with the main timeline for attention.
                      */
                      <ol className="mt-4 space-y-5 border-l border-hairline pl-5">
                        {group.roles.map(({ item, range, duration }: TimelineRole) => (
                          <li key={item.slug} className="relative">
                            <span
                              className="absolute -left-[calc(1.25rem+3.5px)] top-2 h-[7px] w-[7px] rounded-full bg-hairline"
                              aria-hidden="true"
                            />
                            <Highlightable itemId={itemId("experience", item.slug)}>
                              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                                <RoleTitle e={item} size="sm" />
                                <span className="font-mono text-[11px] text-muted">
                                  {range}
                                  {duration && <span className="text-muted/70"> · {duration}</span>}
                                </span>
                              </div>
                              <RoleBody e={item} />
                            </Highlightable>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <Highlightable itemId={itemId("experience", group.roles[0].item.slug)}>
                        <RoleBody e={group.roles[0].item} />
                      </Highlightable>
                    )}
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      </div>
    </Section>
  );
}
