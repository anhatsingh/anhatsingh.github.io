/*
  The skills vocabulary and the regrouping planner.

  Everything here is pure, so it runs without a model, a network or a database.
  That is the point of splitting the planner out: what a taxonomy does to a
  hundred rows is decided by code a test can hold, and only the proposal itself
  needs a model.

  The rules worth guarding are the ones that fail silently. A merge that
  forgets to rewrite tech[] leaves a skill page whose "Used in" list is empty
  and whose emptiness looks like a content gap. A slug that changes on a rename
  404s a URL that was in the sitemap yesterday. A second run that unpublishes
  what the first one wrote is a cull dressed as a no-op — which is precisely
  what an earlier version of scripts/tidy-skills.ts did.

  Run: npx tsx scripts/verify-skills.ts
*/

import { collectVocabulary, termKey, unabsorbed } from "../lib/content/vocabulary";
import { isPinned, planRegroup, slugify, type EntryRow, type SkillRow, type Taxonomy } from "../lib/admin/regroup";
import type { Portfolio } from "../lib/content/types";
import { readFileSync } from "node:fs";
import { skillTenure } from "../lib/content/skill-tenure";
import { educationHasPage } from "../lib/content/entities";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const skill = (
  slug: string,
  name: string,
  extra: Partial<SkillRow> = {},
): SkillRow => ({
  slug,
  name,
  category: "Other",
  sortOrder: 0,
  isPublished: true,
  hasBody: false,
  inBlogList: false,
  hasHeroImage: false,
  ...extra,
});

const portfolio = (
  skills: Array<{ slug: string; name: string }>,
  experience: Array<{ slug: string; tech: string[] }>,
  projects: Array<{ slug: string; tech: string[] }> = [],
) =>
  ({
    skills: skills.map((s) => ({ ...s, category: "Other", body: [], showInBlogList: false })),
    experience,
    projects,
  }) as unknown as Portfolio;

console.log("\n── the vocabulary ──");
{
  const vocab = collectVocabulary(
    portfolio(
      [{ slug: "spark", name: "Spark" }, { slug: "python", name: "Python" }],
      [{ slug: "axtria", tech: ["Python", "Apache Spark", "Query Optimization"] }],
      [{ slug: "app", tech: ["Python", "Firebase"] }],
    ),
  );

  check("skills and tech become one list", vocab.length === 5, `${vocab.length} terms`);

  const python = vocab.find((t) => t.key === "python")!;
  check("a term that is both keeps its skill row", python.isSkill && python.slug === "python");
  check(
    "and records every entry that names it",
    python.usedIn.join(",") === "experience:axtria,projects:app",
    python.usedIn.join(","),
  );

  const firebase = vocab.find((t) => t.key === "firebase")!;
  check("a tech that is no skill is still a term", !firebase.isSkill && firebase.slug === null);
  check("and that is what 'missing from the section' means", unabsorbed(vocab).length === 3);

  /*
    "Large-Scale Data Processing" typed into a tech list is the same thing as
    the curated skill row, and the curated spelling is the one that survives.
  */
  const cased = collectVocabulary(
    portfolio(
      [{ slug: "lsdp", name: "Large-scale Data Processing" }],
      [{ slug: "a", tech: ["Large-Scale Data Processing"] }],
    ),
  );
  check("case is not a difference", cased.length === 1, `${cased.length}`);
  check("the curated spelling wins", cased[0].name === "Large-scale Data Processing", cased[0].name);
  check("and the entry still counts as evidence", cased[0].usedIn.length === 1);

  check("blank tech entries are ignored", collectVocabulary(portfolio([], [{ slug: "a", tech: ["", "  "] }])).length === 0);
  check("keys fold whitespace", termKey("  Data   Science ") === "data science");
}

console.log("\n── slugs ──");
check("a name becomes a slug", slugify("Apache Spark") === "apache-spark");
check("punctuation is dropped, not encoded", slugify("Sales Force Effectiveness (SFE)") === "sales-force-effectiveness-sfe");
check("and runs of separators collapse", slugify("CI / CD") === "ci-cd");

console.log("\n── the planner ──");
{
  const current: SkillRow[] = [
    skill("spark", "Spark", { category: "Data", sortOrder: 100 }),
    skill("python", "Python", { category: "Languages", sortOrder: 200 }),
    skill("retired", "Retired", { sortOrder: 900, isPublished: false }),
  ];

  const entries: EntryRow[] = [
    { section: "experience", slug: "axtria", tech: ["Apache Spark", "Python"] },
    { section: "projects", slug: "app", tech: ["Firebase"] },
  ];

  const vocab = collectVocabulary(
    portfolio(
      [{ slug: "spark", name: "Spark" }, { slug: "python", name: "Python" }],
      [{ slug: "axtria", tech: ["Apache Spark", "Python"] }],
      [{ slug: "app", tech: ["Firebase"] }],
    ),
  );

  const taxonomy: Taxonomy = {
    headings: [
      { name: "Data Engineering", rationale: "" },
      { name: "Languages", rationale: "" },
    ],
    terms: [
      { term: "Spark", canonical: "Spark", heading: "Data Engineering" },
      { term: "Apache Spark", canonical: "Spark", heading: "Data Engineering" },
      { term: "Firebase", canonical: "Firebase", heading: "Data Engineering" },
      { term: "Python", canonical: "Python", heading: "Languages" },
    ],
  };

  const plan = planRegroup(taxonomy, vocab, current, entries);

  check("a merged alias does not become its own row", plan.upserts.length === 3, `${plan.upserts.length} rows`);
  check(
    "an existing skill keeps its slug through a re-categorisation",
    plan.upserts.find((u) => u.name === "Spark")?.slug === "spark",
  );
  check("a new term gets a slug", plan.upserts.find((u) => u.name === "Firebase")?.slug === "firebase");

  /*
    Sort order encodes both which heading and where within it, so the section
    renders headings in the taxonomy's order without a second field.
  */
  check(
    "sort order carries heading and position",
    plan.upserts.find((u) => u.name === "Python")?.sortOrder === 100 &&
      new Set([
        plan.upserts.find((u) => u.name === "Spark")?.sortOrder,
        plan.upserts.find((u) => u.name === "Firebase")?.sortOrder,
      ]).size === 2,
    plan.upserts.map((u) => `${u.name}=${u.sortOrder}`).join(" "),
  );
  /*
    Evidence follows a merge. "Spark" is named by nothing under that spelling —
    the entry says "Apache Spark" — so without inheriting it, the merged skill
    would sort behind a term used once, as though nothing referenced it.
  */
  check(
    "a merged skill inherits its alias's evidence and leads",
    plan.upserts[0]?.name === "Spark",
    plan.upserts.map((u) => u.name).join(" > "),
  );

  /*
    The one that fails silently. Evidence pages match a skill's NAME against
    tech[], so without this the Spark page loses the role that used it.
  */
  const rewrite = plan.rewrites.find((r) => r.slug === "axtria");
  check("a merge rewrites the tech that named the alias", rewrite?.tech.join(",") === "Spark,Python", rewrite?.tech.join(","));
  check("an entry with nothing to change is left alone", !plan.rewrites.some((r) => r.slug === "app"));

  check("an already-unpublished row is not touched again", !plan.unpublish.includes("retired"));
  check("nothing is deleted", !("delete" in plan));
  check("retiring a page is reported", Array.isArray(plan.retiredUrls));
}

console.log("\n── merging two aliases onto one entry ──");
{
  const entries: EntryRow[] = [{ section: "experience", slug: "a", tech: ["Apache Spark", "Spark"] }];
  const taxonomy: Taxonomy = {
    headings: [{ name: "Data", rationale: "" }],
    terms: [
      { term: "Spark", canonical: "Spark", heading: "Data" },
      { term: "Apache Spark", canonical: "Spark", heading: "Data" },
    ],
  };
  const plan = planRegroup(taxonomy, [], [], entries);
  // Two pills reading "Spark" on one card is the visible version of this bug.
  check("the entry ends with one pill, not two", plan.rewrites[0]?.tech.join(",") === "Spark", plan.rewrites[0]?.tech.join(","));
}

console.log("\n── a written page is not merged away ──");
{
  const current: SkillRow[] = [
    skill("spark", "Spark", { category: "Data" }),
    skill("apache-spark", "Apache Spark", { category: "Data", sortOrder: 1, hasBody: true }),
  ];
  const taxonomy: Taxonomy = {
    headings: [{ name: "Data", rationale: "" }],
    terms: [
      { term: "Spark", canonical: "Spark", heading: "Data" },
      { term: "Apache Spark", canonical: "Spark", heading: "Data" },
    ],
  };
  const plan = planRegroup(taxonomy, [], current, []);

  check("the merge is refused", plan.conflicts.length === 1, JSON.stringify(plan.conflicts));
  check("and says why", plan.conflicts[0]?.reason.includes("written page"));
  /*
    Refused means the term survives on its own rather than vanishing. Losing a
    page somebody wrote is the one outcome an automated pass must not produce.
  */
  check("the page survives", plan.upserts.some((u) => u.slug === "apache-spark"));
}

console.log("\n── the weakest badges gather at the end ──");
{
  /*
    Heading order is the taxonomy's judgement; order within a heading is not.
    A model asked to group eighty terms groups eighty terms, so getting to a
    section that reads as curated means a person pruning it — and that is far
    easier when the terms nothing references are together at the end rather
    than scattered among the ones that matter.
  */
  const vocab = collectVocabulary(
    portfolio(
      [],
      [
        { slug: "a", tech: ["Python", "Local Storage"] },
        { slug: "b", tech: ["Python"] },
        { slug: "c", tech: ["Python"] },
      ],
      [{ slug: "d", tech: ["Firebase", "Local Storage"] }],
    ),
  );

  const plan = planRegroup(
    {
      headings: [{ name: "Everything", rationale: "" }],
      terms: [
        // Deliberately proposed weakest-first, so only the sort can fix it.
        { term: "Local Storage", canonical: "Local Storage", heading: "Everything" },
        { term: "Firebase", canonical: "Firebase", heading: "Everything" },
        { term: "Python", canonical: "Python", heading: "Everything" },
      ],
    },
    vocab,
    [],
    [],
  );

  check(
    "the most-used term leads its heading",
    plan.upserts[0]?.name === "Python",
    plan.upserts.map((u) => u.name).join(" > "),
  );
  check("and the least-used trails it", plan.upserts[2]?.name === "Firebase");
  check("sort order still runs 0, 1, 2", plan.upserts.map((u) => u.sortOrder).join(",") === "0,1,2");
}

console.log("\n── a page is never taken down by omission ──");
{
  /*
    The quieter half of the pin rule. Refusing a merge is not enough: a skill
    the model simply forgot would fall out of the kept set and be unpublished,
    and unpublishing is not soft-hiding — RLS drops the row, so /skills/<slug>
    404s and any post linking to it keeps a dead link. Invisible until somebody
    follows the link.
  */
  for (const [label, extra] of [
    ["a written page", { hasBody: true }],
    ["a blog listing", { inBlogList: true }],
    ["a chosen hero image", { hasHeroImage: true }],
  ] as const) {
    const plan = planRegroup(
      { headings: [{ name: "Languages", rationale: "" }], terms: [{ term: "Python", canonical: "Python", heading: "Languages" }] },
      [],
      [skill("python", "Python"), skill("forgotten", "Forgotten", extra)],
      [],
    );
    check(`a skill with ${label} survives being forgotten`, !plan.unpublish.includes("forgotten"));
    check(`  and says so`, plan.conflicts.some((c) => c.term === "Forgotten"), plan.conflicts.map((c) => c.term).join(","));
  }

  // An ordinary skill left out is still retired — the rule protects work, not
  // everything.
  const plain = planRegroup(
    { headings: [{ name: "Languages", rationale: "" }], terms: [{ term: "Python", canonical: "Python", heading: "Languages" }] },
    [],
    [skill("python", "Python"), skill("plain", "Plain")],
    [],
  );
  check("a skill with nothing behind it is retired", plain.unpublish.includes("plain"));
  check("and the page it costs is named", plain.retiredUrls.includes("/skills/plain"));
}

console.log("\n── slugs against rows nobody can see ──");
{
  /*
    The trap that only fires on the second run, in production. RLS hides
    unpublished skills from the public client, but their slugs keep occupying
    the unique index — so a planner reading getPortfolio() would mint a slug
    that already exists and take a unique violation.

    Passing unpublished rows in is the caller's job; adopting them rather than
    minting "etl-2" is this planner's.
  */
  const plan = planRegroup(
    { headings: [{ name: "Data", rationale: "" }], terms: [{ term: "ETL", canonical: "ETL", heading: "Data" }] },
    [],
    [skill("etl", "ETL", { isPublished: false })],
    [],
  );
  check("an unpublished row is adopted, not duplicated", plan.upserts[0]?.slug === "etl", plan.upserts[0]?.slug);
  check("and comes back published", plan.upserts[0]?.isPublished === true);

  // Two different names reducing to one slug is worth making visible rather
  // than silently merging two skills into one row.
  const collide = planRegroup(
    {
      headings: [{ name: "Languages", rationale: "" }],
      terms: [
        { term: "C++", canonical: "C++", heading: "Languages" },
        { term: "C", canonical: "C", heading: "Languages" },
      ],
    },
    [],
    [],
    [],
  );
  const slugs = collide.upserts.map((u) => u.slug);
  check("two names that slugify alike stay two rows", new Set(slugs).size === 2, slugs.join(","));
}

console.log("\n── running it twice ──");
{
  const taxonomy: Taxonomy = {
    headings: [{ name: "Languages", rationale: "" }],
    terms: [{ term: "Python", canonical: "Python", heading: "Languages" }],
  };
  const settled: SkillRow[] = [skill("python", "Python", { category: "Languages" })];
  const entries: EntryRow[] = [{ section: "experience", slug: "a", tech: ["Python"] }];

  const plan = planRegroup(taxonomy, [], settled, entries);
  check("a settled taxonomy reports no work", plan.noop, JSON.stringify({ u: plan.unpublish, r: plan.rewrites.length }));
  check("and no tech is rewritten", plan.rewrites.length === 0);

  // The failure mode this replaces: the second run culling what the first wrote.
  const unsettled = planRegroup(
    taxonomy,
    [],
    [skill("python", "Python", { sortOrder: 900 })],
    entries,
  );
  check("an unsettled one reports work", !unsettled.noop);
  check("but still unpublishes nothing it is keeping", unsettled.unpublish.length === 0);
}

/*
  The old hand-written pass is now a hazard.

  scripts/tidy-skills.ts unpublishes every skill absent from a fixed list of
  forty-eight names — which, after a regroup absorbs tech values, is most of
  the section. It is kept for the sort_order convention and the reasoning in
  its header, and it must not be runnable by muscle memory.
*/
console.log("\n── the superseded script cannot cull ──");
{
  const tidy = readFileSync("scripts/tidy-skills.ts", "utf8");
  check("it is marked superseded", /SUPERSEDED/.test(tidy));
  check("--apply alone no longer writes", /process\.argv\.includes\("--apply"\) && process\.argv\.includes\(SUPERSEDED_GUARD\)/.test(tidy));
  check("and it says where the replacement is", /\/admin\/taxonomy/.test(tidy));
}

/*
  The section itself.

  Two properties that a redesign can drop without anything failing. The
  chatbot addresses skills as "skills:<slug>", validated per request against
  the known set — so a section that stopped registering them would leave
  highlightItems succeeding server-side and doing nothing on screen, which is
  the exact failure mode /how-it-works section 01 is about.

  And the separators have to stay in CSS. Typed between the items they would be
  read aloud, so a list of eleven skills becomes eleven skills and eleven
  middots.
*/
console.log("\n── the section keeps what a redesign can quietly drop ──");
{
  const section = readFileSync("components/sections/skills.tsx", "utf8");

  check("every skill still registers for highlighting", /useHighlight\(itemId\("skills", skill\.slug\)\)/.test(section));
  /*
    Highlightable renders border-l-2 pl-4 unconditionally — an eighteen-pixel
    indent on every item whether or not anything is highlighted. Around one
    card that is the design; around sixty-two in a wrapping row it is why
    nothing lined up.
  */
  check("but not through the wrapper that indents each one", !/<Highlightable/.test(section));
  check("emphasis follows evidence", /strong={hasEvidence\(s, evidence\)}/.test(section));

  const css = readFileSync("app/globals.css", "utf8");
  check("separators are drawn by CSS", /\.skill-line li:not\(:last-child\)::after/.test(css));
  check("and are not typed into the markup", !section.includes("·"));
  check("the list stays a list", /<ul className="skill-line/.test(section) && /<li ref={ref}/.test(section));
}

/*
  How long a skill has actually been in use.

  The assistant declined to answer "how much Python experience?" because it had
  no figure and its instructions forbid adding up dates unaided — rightly, since
  two roles held at once are not twice the experience. This is that arithmetic,
  and the cases below are the three ways the date helpers make it easy to get
  quietly wrong.
*/
console.log("\n── how long a skill has been in use ──");
{
  const p = (
    experience: Array<Record<string, unknown>>,
    projects: Array<Record<string, unknown>> = [],
    skills: Array<{ slug: string; name: string }> = [],
  ) => ({ experience, projects, skills }) as unknown as Portfolio;

  const role = (slug: string, tech: string[], startDate: string, endDate: string | null) =>
    ({ slug, role: "Engineer", company: "C", tech, startDate, endDate });

  // Two roles held at once are one stretch of using the thing, not two.
  const overlap = skillTenure(
    p([role("a", ["Python"], "2023-01", "2024-12"), role("b", ["Python"], "2023-06", "2024-06")]),
    "Python",
  );
  check("concurrent entries count once", overlap.months === 24, `${overlap.months} months`);
  check("but both are still shown as working", overlap.spans.length === 2);

  check("case and stray spaces still match", skillTenure(p([role("a", ["python "], "2024-01", "2024-03")]), "  PYTHON ").months === 3);

  /*
    monthIndex(null) returns TODAY. A project with no start date would become a
    span from now to now — a zero-length row that also drags the earliest date
    forward. Project dates are both optional, so this is the common case.
  */
  const undated = skillTenure(
    p([], [{ slug: "x", name: "Undated thing", tech: ["Rust"] }, { slug: "y", name: "Dated", tech: ["Rust"], started: "2024-01", ended: "2024-02" }]),
    "Rust",
  );
  check("an undated entry is excluded from the sum", undated.months === 2, `${undated.months}`);
  check("and reported rather than dropped", undated.undated.includes("Undated thing"));
  check("and said out loud", /carr(y|ies) no dates/.test(undated.summary), undated.summary);

  // A bare year as an END means the year finished, not the 1st of January.
  const bareYear = skillTenure(p([], [{ slug: "x", name: "P", tech: ["Go"], started: "2022", ended: "2022" }]), "Go");
  check("a bare end year counts to December", bareYear.months === 12, `${bareYear.months}`);

  /*
    formatDuration(0) returns an empty string, so a skill nothing dated uses
    must produce a sentence rather than a blank. Several will — "Machine
    Learning" is listed on the real site and tagged on nothing.
  */
  const listedOnly = skillTenure(p([], [], [{ slug: "ml", name: "Machine Learning" }]), "Machine Learning");
  check("a listed-but-untagged skill still says something", listedOnly.summary.length > 20);
  check("and does not claim a duration", listedOnly.formatted === "" && listedOnly.months === 0);
  check("and is not confused with an unknown one", /listed as a skill/.test(listedOnly.summary));
  check(
    "something nowhere on the site says so instead",
    /Nothing on the site mentions/.test(skillTenure(p([]), "Fortran").summary),
  );

  // Still running means the span reaches today and says "Present".
  const current = skillTenure(p([role("a", ["Kotlin"], "2024-01", null)]), "Kotlin");
  check("an open-ended role runs to today", current.ongoing && current.spans[0].to === "Present");
  check("and the summary says it is still in use", /still in use/.test(current.summary));

  check("the biggest span leads the working", overlap.spans[0].months >= overlap.spans[1].months);
}

/*
  A degree can be tagged with what it taught, and that must not become
  experience.

  The whole timeline answer turns on keeping study and work apart — it leads
  with the professional figure and names the qualification separately, and
  refuses to fold one into the other. Education tech reaching skillTenure
  through a side door would undo that silently, in the direction that flatters.
*/
/*
  Which degrees have a page.

  Education is the one type where a published row may have no URL, and the rule
  has three consumers that fail in different silent directions when they
  disagree: the route, the sitemap, and whether the homepage card is a link.
*/
console.log("\n── a degree only has a page when there is something on it ──");
{
  const written = { slug: "a", institution: "U", degree: "B.Tech", body: [{ type: "text", markdown: "x" }] };
  const bare = { slug: "b", institution: "S", degree: "Matric", body: [] };
  check("a written-up degree has one", educationHasPage(written as never));
  check("an empty one does not", !educationHasPage(bare as never));
  // A row from a database that predates the migration has no body at all.
  check("nor does a row with no body field", !educationHasPage({ slug: "c" } as never));
}

console.log("\n── studying something is not using it ──");
{
  const taught = {
    skills: [],
    experience: [
      { slug: "one-role", role: "Engineer", company: "C", tech: ["Python"], startDate: "2024-01", endDate: "2024-06" },
    ],
    projects: [],
    education: [
      { slug: "a-degree", institution: "U", degree: "B.Tech", tech: ["Python"], startYear: "2020", endYear: "2024" },
    ],
  } as unknown as Portfolio;

  const tenure = skillTenure(taught, "Python");
  check("a degree does not add months", tenure.months === 6, `${tenure.months}`);
  check("nor a span to the working", tenure.spans.length === 1, `${tenure.spans.length} spans`);
  check(
    "and does not enter the vocabulary either",
    !collectVocabulary(taught).some((t) => t.usedIn.some((u) => u.startsWith("education:"))),
  );
}

console.log(failures === 0 ? "\nAll skills checks passed.\n" : `\n${failures} skills check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
