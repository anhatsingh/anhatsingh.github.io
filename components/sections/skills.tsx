"use client";

import Link from "next/link";
import { Section } from "./section";
import { useHighlight } from "@/components/ui-control";
import { entityPath, itemId, type Skill } from "@/lib/content/types";

/*
  What he works with, as six sentences.

  This was 62 bordered pills in a wrapping row, and three things made it a mess.
  Labels run from one character ("C") to thirty-three ("Cross-Platform Mobile
  Development"), so every wrapped line ended ragged with irregular gaps. Every
  badge carried an invisible eighteen-pixel indent, because Highlightable always
  renders border-l-2 pl-4 whether or not anything is highlighted — fine around
  one card, ruinous around sixty-two chips in a flex row. And nothing had more
  weight than anything else, so Python, which eight entries name, looked exactly
  like Figma, which nothing does.

  So: one flowing line per heading. Boxes are what made uneven names a problem;
  without them a long name is just a long word in a sentence. Skills are
  data-like, and on this site data-like sections — experience, education, the
  GitHub stats — are borderless lists structured by a hairline, while bordered
  cards are for things you browse and choose between.
*/

/*
  One skill, and the reason this doesn't use Highlightable.

  The chatbot addresses skills individually as "skills:<slug>", so per-skill
  registration has to survive a redesign or a tool call ends up pointing at
  nothing. useHighlight is the hook underneath Highlightable and gives exactly
  that — a ref to register and the note to show — without the left rail that
  only makes sense around a card.
*/
function SkillLink({ skill, strong }: { skill: Skill; strong: boolean }) {
  const { isHighlighted, note, ref } = useHighlight(itemId("skills", skill.slug));

  return (
    <li ref={ref} className="inline">
      <Link
        href={entityPath("skills", skill.slug)}
        /*
          The whole hierarchy, in one class. A skill some job or project
          actually names reads at full strength; one that appears nowhere else
          on the site sits back a shade. That is the difference between a
          reader learning what he does and reading sixty-two equal words.
        */
        className={`transition-colors hover:text-accent ${
          isHighlighted
            ? "text-accent underline decoration-accent/40 underline-offset-4"
            : strong
              ? "text-text"
              : "text-muted"
        }`}
      >
        {skill.name}
      </Link>
      {isHighlighted && note && (
        <span
          role="note"
          className="animate-rise ml-1.5 inline-flex items-baseline gap-1 rounded-[var(--radius)] border border-callout-border bg-callout-bg px-2 py-0.5 align-middle"
        >
          <span className="font-mono text-[10px] text-accent" aria-hidden="true">
            ⌁
          </span>
          <span className="text-xs text-text">{note}</span>
        </span>
      )}
    </li>
  );
}

export function Skills({
  skills,
  /*
    How many jobs and projects name each skill, keyed by slug.

    Computed on the server from data the page already holds. Only 27 of 62 have
    any, and most of those exactly one, which is why it drives emphasis rather
    than being printed — a column of "1"s beside a group showing nothing raises
    a question the section can't answer.
  */
  evidence = {},
}: {
  skills: Skill[];
  evidence?: Record<string, number>;
}) {
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
      <div className="grid gap-x-12 gap-y-9 md:grid-cols-2">
        {[...grouped.entries()].map(([category, items]) => (
          <div key={category}>
            <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">{category}</h3>

            {/*
              A real list that reads as a sentence. The separators are drawn by
              CSS rather than typed between the items, so a screen reader
              announces eleven list items instead of reading "middot" eleven
              times.
            */}
            <ul className="skill-line mt-3 text-[0.9375rem] leading-[2] text-muted">
              {items.map((s) => (
                <SkillLink key={s.slug} skill={s} strong={hasEvidence(s, evidence)} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

/*
  Which skills read at full strength.

  Exported so app/page.tsx can build the map with the same case-folding the
  taxonomy uses, and so a test can hold the rule.
*/
export function hasEvidence(skill: Skill, evidence: Record<string, number>): boolean {
  return (evidence[skill.slug] ?? 0) > 0;
}
