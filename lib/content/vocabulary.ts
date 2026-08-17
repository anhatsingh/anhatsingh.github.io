import type { Portfolio } from "@/lib/content/types";

/*
  Everything this site claims to know, as one list.

  Skills and tech are the same thing stored twice. A skill is a badge in the
  Skills section with a page of its own; tech is a pill on an experience or
  project card. Nobody reconciles them, so the site currently names thirty-six
  technologies on entry cards that never appear under "What I work with" —
  Spark, Firebase, Query Optimization, iOS Application Development — and the
  JSON-LD, the chat context and the résumé generator all read the shorter list.

  This collects both into one vocabulary with provenance, which is what makes
  the difference between a technology and a domain visible: "PostgreSQL" turns
  up across four entries, "Physician Segmentation" in one, and that is most of
  what tells them apart.
*/

export interface Term {
  /** As it should be displayed. The existing skill's spelling wins. */
  name: string;
  /** Lowercased, for comparison only. */
  key: string;
  /** The skill row this already is, if it is one. */
  slug: string | null;
  /** Whether a skill row exists — a term can be a skill, a tech, or both. */
  isSkill: boolean;
  /** "experience:slug" / "projects:slug", in the order encountered. */
  usedIn: string[];
}

/** Case and surrounding space are not meaningful differences. */
export function termKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Every distinct term, with where it came from.
 *
 * Published skills only. The database holds a hundred skill rows of which
 * fifty-two are unpublished LinkedIn leftovers, and a regrouping pass that
 * swept those back in would undo a decision somebody already made.
 */
export function collectVocabulary(portfolio: Portfolio): Term[] {
  const terms = new Map<string, Term>();

  const touch = (name: string): Term => {
    const key = termKey(name);
    const existing = terms.get(key);
    if (existing) return existing;
    const fresh: Term = { name: name.trim(), key, slug: null, isSkill: false, usedIn: [] };
    terms.set(key, fresh);
    return fresh;
  };

  /*
    Skills first, so an existing skill's spelling is the one that survives.
    "Large-scale Data Processing" is a row somebody curated; "Large-Scale Data
    Processing" is how it was typed into a tech list once.
  */
  for (const skill of portfolio.skills) {
    const term = touch(skill.name);
    term.name = skill.name.trim();
    term.slug = skill.slug;
    term.isSkill = true;
  }

  const fromEntries = (
    entries: Array<{ slug: string; tech: string[] }>,
    section: "experience" | "projects",
  ) => {
    for (const entry of entries) {
      for (const raw of entry.tech ?? []) {
        if (!raw.trim()) continue;
        const term = touch(raw);
        const ref = `${section}:${entry.slug}`;
        if (!term.usedIn.includes(ref)) term.usedIn.push(ref);
      }
    }
  };

  fromEntries(portfolio.experience, "experience");
  fromEntries(portfolio.projects, "projects");

  return [...terms.values()];
}

/** Terms named on an entry but missing from the Skills section. */
export function unabsorbed(vocabulary: Term[]): Term[] {
  return vocabulary.filter((t) => !t.isSkill);
}
