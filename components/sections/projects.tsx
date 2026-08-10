"use client";

import Link from "next/link";
import { Highlightable, Section } from "./section";
import { entityPath, itemId, type Project } from "@/lib/content/types";

export function Projects({ projects }: { projects: Project[] }) {
  if (!projects.length) return null;

  return (
    <Section id="projects" eyebrow="01 — Projects" title="Things I've built">
      <div className="space-y-10">
        {projects.map((p) => (
          <Highlightable key={p.slug} itemId={itemId("projects", p.slug)}>
            <article>
              <div className="flex flex-wrap items-baseline gap-3">
                <h3 className="font-display text-2xl">
                  <Link
                    href={entityPath("projects", p.slug)}
                    className="transition-colors hover:text-accent"
                  >
                    {p.name}
                    <span className="ml-1.5 font-mono text-sm text-muted" aria-hidden="true">
                      →
                    </span>
                  </Link>
                </h3>
                {p.featured && (
                  <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-accent">
                    featured
                  </span>
                )}
              </div>

              <p className="mt-1 text-muted">{p.summary}</p>
              <p className="mt-3 max-w-2xl leading-relaxed">{p.description}</p>

              {p.tech.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-1.5">
                  {p.tech.map((t) => (
                    <li
                      key={t}
                      className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[11px] text-muted"
                    >
                      {t}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 flex gap-4">
                {p.repoUrl && (
                  <a
                    href={p.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs uppercase tracking-widest text-accent hover:underline"
                  >
                    Code →
                  </a>
                )}
                {p.liveUrl && (
                  <a
                    href={p.liveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs uppercase tracking-widest text-accent hover:underline"
                  >
                    Live →
                  </a>
                )}
              </div>
            </article>
          </Highlightable>
        ))}
      </div>
    </Section>
  );
}
