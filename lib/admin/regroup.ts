import { termKey, type Term } from "@/lib/content/vocabulary";

/*
  Turning an approved taxonomy into exact database writes.

  Pure on purpose. The model proposes and a human edits, but what actually
  happens to a hundred rows is decided here — and every rule below is one a
  test can hold, without a model, a network or a database.

  The rule that shapes everything: a skill page's "Used in" evidence is built
  by comparing the skill's NAME against the tech[] arrays on experience and
  projects, case-insensitively, with no join table (lib/content/entities.ts).
  So a merge is not a bookkeeping change. Folding "Apache Spark" into "Spark"
  empties the Spark page unless the tech arrays are rewritten in the same pass,
  and those arrays are rendered as pills on cards, on detail pages and in OG
  images. It is a content edit, which is why the review screen shows merges
  rather than burying them.
*/

/** One heading, in display order. */
export interface ProposedHeading {
  name: string;
  rationale: string;
}

export interface ProposedTerm {
  /** The term as it appears in the vocabulary. */
  term: string;
  /** The name that survives. Equal to `term` unless this folds into another. */
  canonical: string;
  /** Which heading the canonical name belongs under. */
  heading: string;
}

export interface Taxonomy {
  headings: ProposedHeading[];
  terms: ProposedTerm[];
}

/*
  A skill row as it exists today — INCLUDING unpublished ones.

  This must be read through the service client, not getPortfolio(). RLS hides
  unpublished skills from the public client while their slugs keep occupying
  the unique index, so a planner that cannot see them will happily mint a slug
  that already exists. The symptom is a unique violation on the second run
  only, in production, which is the worst place to learn it.
*/
export interface SkillRow {
  slug: string;
  name: string;
  category: string;
  sortOrder: number;
  isPublished: boolean;
  /** Non-empty body means somebody wrote a page for it. */
  hasBody: boolean;
  /** Listed in /blog. */
  inBlogList: boolean;
  hasHeroImage: boolean;
}

/*
  A skill that owns something a regroup must not destroy.

  Unpublishing does not soft-hide a skill: RLS drops the row from the public
  portfolio, so /skills/<slug> stops resolving and 404s, its OG image goes with
  it, and any post that linked to it keeps a dead link. A page, a blog listing
  or a hero image all mean somebody put work in, and no automated pass gets to
  throw that away — not by merging it and not by leaving it out of a taxonomy.
*/
export function isPinned(skill: SkillRow): boolean {
  return skill.hasBody || skill.inBlogList || skill.hasHeroImage;
}

export interface EntryRow {
  section: "experience" | "projects";
  slug: string;
  tech: string[];
}

export interface SkillUpsert {
  slug: string;
  name: string;
  category: string;
  sortOrder: number;
  isPublished: true;
}

export interface TechRewrite {
  section: "experience" | "projects";
  slug: string;
  tech: string[];
}

export interface Conflict {
  term: string;
  into: string;
  reason: string;
}

export interface Plan {
  upserts: SkillUpsert[];
  /** Slugs to set is_published = false. Never a delete. */
  unpublish: string[];
  rewrites: TechRewrite[];
  /** Merges that were refused, with why. */
  conflicts: Conflict[];
  /** Pages that will stop existing, so the choice is made knowingly. */
  retiredUrls: string[];
  /** True when nothing would change — what makes a second run a no-op. */
  noop: boolean;
}

/*
  Sort order is heading index × 100 + position, the convention scripts/
  tidy-skills.ts established: a whole heading can be moved without renumbering
  every row, and inserting one skill mid-block collides with nothing.
*/
const BLOCK = 100;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

/*
  Resolves a fresh slug against every row, published or not.

  Returns the colliding row's slug when there is one — adopting it, which is
  what the caller then upserts over. Only a collision with a slug already
  claimed in THIS plan needs a suffix, and that means two different names
  reduced to the same slug in one pass, which is worth making visible rather
  than silently merging.
*/
function claimSlug(base: string, current: SkillRow[], taken: Set<string>): string {
  const existing = current.find((s) => s.slug === base);
  if (existing && !taken.has(base)) return base;
  if (!taken.has(base)) return base;

  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function planRegroup(
  taxonomy: Taxonomy,
  vocabulary: Term[],
  current: SkillRow[],
  entries: EntryRow[],
): Plan {
  const byKey = new Map(vocabulary.map((t) => [t.key, t]));
  const skillByKey = new Map(current.map((s) => [termKey(s.name), s]));
  const headingIndex = new Map(taxonomy.headings.map((h, i) => [h.name, i]));

  const conflicts: Conflict[] = [];

  /*
    Merges, resolved first because everything downstream needs to know which
    name survives. A merge into a name that is not itself in the taxonomy would
    fold a term into nothing, so it is refused rather than silently dropped.
  */
  const canonicalOf = new Map<string, string>();
  /*
    A refused merge leaves the term standing on its own, under whichever
    heading its intended target was given. Reporting it as refused and then
    again as "left out of the taxonomy" describes one event twice, and a panel
    that says the same thing twice trains people to skim it.
  */
  const refused = new Map<string, string>();

  for (const entry of taxonomy.terms) {
    const from = termKey(entry.term);
    const to = termKey(entry.canonical);
    if (from === to) continue;

    /*
      A hand-written page cannot be discarded by an automated pass. Nothing has
      one today, which is exactly why this has to be written now rather than
      after the first one exists.
    */
    const losing = skillByKey.get(from);
    if (losing && isPinned(losing)) {
      conflicts.push({
        term: entry.term,
        into: entry.canonical,
        reason: losing.hasBody
          ? "it has a written page, which merging would discard"
          : losing.inBlogList
            ? "it is listed in /blog, and merging would break that link"
            : "it has a hero image somebody chose",
      });
      refused.set(from, entry.heading);
      continue;
    }

    canonicalOf.set(from, entry.canonical);
  }

  /** Where a term ends up after any merge. */
  const resolve = (key: string) => termKey(canonicalOf.get(key) ?? key);

  /*
    Evidence follows the merge.

    A skill absorbing an alias gains that alias's entries — "Spark" after
    swallowing "Apache Spark" is named by everything that named either. Counting
    only the surviving spelling would sort a merged skill as though nothing
    referenced it, which is precisely backwards: it has more behind it than it
    did, not less.
  */
  const evidence = new Map<string, Set<string>>();
  for (const term of vocabulary) {
    const target = resolve(term.key);
    const seenRefs = evidence.get(target) ?? new Set<string>();
    for (const ref of term.usedIn) seenRefs.add(ref);
    evidence.set(target, seenRefs);
  }
  const evidenceFor = (name: string) => evidence.get(termKey(name))?.size ?? 0;

  /*
    Group the surviving names under their headings, keeping the order the
    taxonomy lists them in — that order is the display order.
  */
  const grouped = new Map<string, string[]>();
  const seen = new Set<string>();

  for (const entry of taxonomy.terms) {
    // A refused merge contributes the term itself rather than its target.
    const refusedHeading = refused.get(termKey(entry.term));
    const key = refusedHeading ? termKey(entry.term) : termKey(entry.canonical);
    if (seen.has(key)) continue;
    // A term folded into another contributes its target, not itself.
    if (!refusedHeading && canonicalOf.has(termKey(entry.term)) && termKey(entry.term) === key) continue;
    seen.add(key);

    const proposed = refusedHeading ?? entry.heading;
    const heading = headingIndex.has(proposed) ? proposed : taxonomy.headings[0]?.name;
    if (!heading) continue;

    const list = grouped.get(heading) ?? [];
    // The existing row's spelling wins; a curated name is not overwritten by
    // however it was typed into a tech list.
    list.push(skillByKey.get(key)?.name ?? byKey.get(key)?.name ?? (refusedHeading ? entry.term : entry.canonical));
    grouped.set(heading, list);
  }

  const upserts: SkillUpsert[] = [];
  const taken = new Set<string>();
  for (const heading of taxonomy.headings) {
    /*
      Within a heading, the ones with evidence first.

      Heading order is the taxonomy's — that is a judgement about what a
      recruiter should meet first. Order inside a heading is not: sorting by
      how many jobs and projects actually name a term puts the real skills at
      the front and gathers the ones with nothing behind them at the end, which
      is where "Local Storage" and "Push Notifications" turn out to be
      implementation detail rather than a skill.

      That matters for the review screen more than for the site. A model asked
      to group eighty terms will group eighty terms; getting to a section that
      reads as curated is a human pruning it, and this is what makes the
      candidates for pruning obvious rather than scattered.
    */
    const names = [...(grouped.get(heading.name) ?? [])].sort(
      (a, b) => evidenceFor(b) - evidenceFor(a),
    );

    names.forEach((name, position) => {
      const existing = skillByKey.get(termKey(name));
      /*
        A brand-new term can still slugify onto a row that exists under a
        different name — "C++" and "C" both reduce to "c". Adopting that row is
        right and minting "c-2" is not: a numbered slug is a permanent scar
        from a moment's collision.
      */
      const slug = existing?.slug ?? claimSlug(slugify(name), current, taken);
      taken.add(slug);

      upserts.push({
        /*
          An existing skill keeps its slug through a rename. /skills/<slug> is a
          real URL with an OG image and a sitemap entry, and the chatbot
          addresses it as "skills:<slug>" — a fresh slug is a 404 and a dead
          highlight at once.
        */
        slug,
        name,
        category: heading.name,
        sortOrder: (headingIndex.get(heading.name) ?? 0) * BLOCK + position,
        isPublished: true,
      });
    });
  }

  const keeping = new Set(upserts.map((u) => u.slug));

  /*
    Pinned skills are never unpublished, whatever the taxonomy says. A term the
    model simply forgot would otherwise take a live page down with it, and that
    failure is invisible — a 404 on a page nobody happened to visit that week.
    A pinned skill left out of the proposal is kept and reported instead.
  */
  const orphanedPins = current.filter((s) => s.isPublished && !keeping.has(s.slug) && isPinned(s));
  for (const pin of orphanedPins) {
    conflicts.push({
      term: pin.name,
      into: "",
      reason: "left out of the taxonomy, but it has a page — kept where it was",
    });
    upserts.push({
      slug: pin.slug,
      name: pin.name,
      category: pin.category,
      sortOrder: pin.sortOrder,
      isPublished: true,
    });
    keeping.add(pin.slug);
  }

  const unpublish = current
    .filter((s) => s.isPublished && !keeping.has(s.slug) && !isPinned(s))
    .map((s) => s.slug);

  /*
    The rewrite that keeps evidence pages working. Only entries whose tech list
    actually changes are returned — an update that writes back what was already
    there is a wasted round trip and a misleading diff.
  */
  const rewrites: TechRewrite[] = [];
  for (const entry of entries) {
    const next: string[] = [];
    for (const tech of entry.tech) {
      const target = resolve(termKey(tech));
      const name = skillByKey.get(target)?.name ?? canonicalOf.get(termKey(tech)) ?? tech;
      // Two aliases on one entry collapse to one pill rather than a duplicate.
      if (!next.some((t) => termKey(t) === termKey(name))) next.push(name);
    }

    const changed =
      next.length !== entry.tech.length || next.some((t, i) => t !== entry.tech[i]);
    if (changed) rewrites.push({ section: entry.section, slug: entry.slug, tech: next });
  }

  const retiredUrls = unpublish.map((slug) => `/skills/${slug}`);

  /*
    Nothing to do is a real answer. Re-running a regroup has to be a no-op —
    tidy-skills.ts learned that the hard way, when a second run of an earlier
    version turned a rename into a cull.
  */
  const unchanged = upserts.every((u) => {
    const existing = current.find((s) => s.slug === u.slug);
    return (
      existing &&
      existing.name === u.name &&
      existing.category === u.category &&
      existing.sortOrder === u.sortOrder &&
      existing.isPublished
    );
  });

  return {
    upserts,
    unpublish,
    rewrites,
    conflicts,
    retiredUrls,
    noop: unchanged && unpublish.length === 0 && rewrites.length === 0,
  };
}
