"use client";

import Link from "next/link";
import { Highlightable, Section } from "./section";
import { entityPath, itemId, type Skill } from "@/lib/content/types";

export function Skills({ skills }: { skills: Skill[] }) {
  if (!skills.length) return null;

  // Preserve admin sort order within each category rather than sorting again.
  const grouped = new Map<string, Skill[]>();
  for (const s of skills) {
    const list = grouped.get(s.category) ?? [];
    list.push(s);
    grouped.set(s.category, list);
  }

  return (
    <Section id="skills" eyebrow="05 — Skills" title="What I work with">
      <div className="space-y-8">
        {[...grouped.entries()].map(([category, items]) => (
          <div key={category}>
            <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">{category}</h3>
            <ul className="mt-3 flex flex-wrap gap-2">
              {items.map((s) => (
                <li key={s.slug}>
                  <Highlightable itemId={itemId("skills", s.slug)}>
                    <Link
                      href={entityPath("skills", s.slug)}
                      className="inline-block rounded-[var(--radius)] border border-hairline px-3 py-1.5 font-mono text-sm text-text transition-colors hover:border-accent hover:text-accent"
                    >
                      {s.name}
                    </Link>
                  </Highlightable>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}
