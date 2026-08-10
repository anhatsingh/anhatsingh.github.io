"use client";

import Link from "next/link";
import { Highlightable, Section } from "./section";
import { entityPath, itemId, type Project } from "@/lib/content/types";

/*
  A card grid rather than a vertical stack.

  With a dozen projects, printing name + one-liner + full description down a
  single column pushed everything below it off the page, and the descriptions
  repeated what the detail page already says better. So the card carries only
  what helps you choose which one to open: what it is, when, and what it was
  built with. The description lives on the project's own page.

  Order comes from sort_order, set in the admin panel — there's a "sort by
  date" control there that renumbers it. Re-sorting here would silently
  override whatever was chosen on that screen.
*/

/** "2020-11" → "2020". Projects are dated to the month at best. */
function year(value?: string): string | null {
  return value ? value.slice(0, 4) : null;
}

/** "2020" or "2020 — 2021", collapsing a same-year range to one number. */
function span(p: Project): string | null {
  const from = year(p.started);
  const to = year(p.ended);
  if (!from) return null;
  if (!to) return from;
  return from === to ? from : `${from} — ${to}`;
}

export function Projects({ projects }: { projects: Project[] }) {
  if (!projects.length) return null;

  return (
    <Section id="projects" eyebrow="01 — Projects" title="Things I've built">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => {
          const dates = span(p);

          return (
            <Highlightable
              key={p.slug}
              itemId={itemId("projects", p.slug)}
              fill
              /* Featured projects take the full row on wide screens so the grid
                 has a focal point instead of reading as twelve equal tiles. */
              className={p.featured ? "sm:col-span-2 lg:col-span-2" : undefined}
            >
              <article className="group relative flex h-full flex-col rounded-[var(--radius)] border border-hairline bg-surface p-5 transition-colors hover:border-accent/40">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-display text-xl leading-tight">
                    <Link
                      href={entityPath("projects", p.slug)}
                      /* Stretched link: the whole card is the hit target, but
                         the markup stays a single anchor for screen readers. */
                      className="after:absolute after:inset-0 after:content-[''] transition-colors group-hover:text-accent"
                    >
                      {p.name}
                    </Link>
                  </h3>
                  {dates && (
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                      {dates}
                    </span>
                  )}
                </div>

                {p.featured && (
                  <span className="mt-2 self-start rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-accent">
                    featured
                  </span>
                )}

                {p.summary && (
                  <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">
                    {p.summary}
                  </p>
                )}

                {p.tech.length > 0 && (
                  <ul className="mt-auto flex flex-wrap gap-1.5 pt-4">
                    {p.tech.slice(0, 4).map((t) => (
                      <li
                        key={t}
                        className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] text-muted"
                      >
                        {t}
                      </li>
                    ))}
                    {p.tech.length > 4 && (
                      <li className="px-1 py-0.5 font-mono text-[10px] text-muted">
                        +{p.tech.length - 4}
                      </li>
                    )}
                  </ul>
                )}

                {/* Above the stretched link's overlay, or these stop being
                    clickable in their own right. */}
                {(p.repoUrl || p.liveUrl) && (
                  <div className="relative z-10 mt-3 flex gap-4">
                    {p.repoUrl && (
                      <a
                        href={p.repoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[11px] uppercase tracking-widest text-accent hover:underline"
                      >
                        Code →
                      </a>
                    )}
                    {p.liveUrl && (
                      <a
                        href={p.liveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[11px] uppercase tracking-widest text-accent hover:underline"
                      >
                        Live →
                      </a>
                    )}
                  </div>
                )}
              </article>
            </Highlightable>
          );
        })}
      </div>
    </Section>
  );
}
