/*
  Checks the structured data and metadata that a name search depends on.

  Worth automating because these fail silently: a malformed sameAs or a missing
  @id doesn't break the page, it just quietly stops the search engine connecting
  this domain to the GitHub and LinkedIn profiles — which is the entire point.

  Run: npx tsx scripts/verify-seo.ts
*/

import { seedPortfolio } from "../lib/content/seed";
import { buildDescription, buildPersonJsonLd, buildProjectsJsonLd, SITE_URL } from "../lib/seo";
import { detailJsonLd, detailMetadata } from "../lib/content/detail-meta";
import { entityPath, type EntityType } from "../lib/content/types";
import type { DetailView } from "../lib/content/entities";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const AVATAR = "https://anhatsingh.com/portrait.jpg";

console.log("\n── description ──");
const desc = buildDescription(seedPortfolio);
console.log(`  "${desc}"`);
check("mentions the full name", desc.includes(seedPortfolio.profile.name));
check("mentions the role", desc.includes(seedPortfolio.profile.tagline));
check("uses the correct article", !/\bis a [AEIOU]/.test(desc), desc.match(/is an? \S+/)?.[0] ?? "");
check("no double spaces", !desc.includes("  "));
check("stays under 300 chars", desc.length <= 300, `${desc.length} chars`);

console.log("\n── Person / ProfilePage graph ──");
const graph = buildPersonJsonLd(seedPortfolio, AVATAR) as {
  "@context": string;
  "@graph": Array<Record<string, unknown>>;
};

check("has @context", graph["@context"] === "https://schema.org");
check("serialises to valid JSON", (() => {
  try { JSON.parse(JSON.stringify(graph)); return true; } catch { return false; }
})());

const byType = (t: string) => graph["@graph"].find((n) => n["@type"] === t);
const person = byType("Person");
const page = byType("ProfilePage");
const site = byType("WebSite");

check("contains Person", Boolean(person));
check("contains ProfilePage", Boolean(page));
check("contains WebSite", Boolean(site));

check("Person has a stable @id", person?.["@id"] === `${SITE_URL}/#person`);
check("ProfilePage points at the Person", (page?.about as { "@id": string })?.["@id"] === `${SITE_URL}/#person`);
check("WebSite publisher points at the Person", (site?.publisher as { "@id": string })?.["@id"] === `${SITE_URL}/#person`);

const sameAs = (person?.sameAs ?? []) as string[];
check("sameAs is populated", sameAs.length > 0, `${sameAs.length} profiles`);
check("every sameAs is an absolute https URL", sameAs.every((u) => /^https:\/\//.test(u)), sameAs.join(", "));
check("sameAs has no empty entries", sameAs.every(Boolean));

check("image is absolute", typeof person?.image === "string" && /^https:\/\//.test(person.image as string));
check("url is the canonical site", person?.url === SITE_URL);
check("email is a mailto URI", String(person?.email).startsWith("mailto:"));
check("jobTitle present", Boolean(person?.jobTitle));
check("knowsAbout populated from skills", ((person?.knowsAbout ?? []) as string[]).length === seedPortfolio.skills.length);
check("alumniOf populated from education", ((person?.alumniOf ?? []) as unknown[]).length === seedPortfolio.education.length);

console.log("\n── projects ItemList ──");
const projects = buildProjectsJsonLd(seedPortfolio) as {
  itemListElement: Array<{ position: number; item: Record<string, unknown> }>;
} | null;

check("built when projects exist", Boolean(projects));
if (projects) {
  check("one entry per project", projects.itemListElement.length === seedPortfolio.projects.length);
  check("positions are 1-indexed and sequential",
    projects.itemListElement.every((e, i) => e.position === i + 1));
  check("every item has an absolute url",
    projects.itemListElement.every((e) => /^https:\/\//.test(String(e.item.url))),
  );
  check("every item credits the Person node",
    projects.itemListElement.every((e) => (e.item.author as { "@id": string })["@id"] === `${SITE_URL}/#person`),
  );
}

console.log("\n── detail pages ──");
{
  /*
    Every detail route shares one metadata builder, so testing it once covers
    all five. The failure this catches is a page shipping without a canonical —
    which duplicates the homepage's content against itself in the index.
  */
  const view: DetailView = {
    type: "experience",
    slug: "ml-engineer-acme",
    title: "ML Engineer",
    subtitle: "Acme",
    summary: "Owned retrieval and evaluation.",
    body: [{ type: "text", markdown: "Rebuilt the pipeline around hybrid search." }],
    showInBlogList: false,
    meta: [],
    tech: ["PyTorch"],
    readingMinutes: 1,
    path: "/experience/ml-engineer-acme",
  };

  const meta = detailMetadata(view);
  check("canonical is absolute and matches the path",
    meta.alternates?.canonical === `${SITE_URL}/experience/ml-engineer-acme`,
    String(meta.alternates?.canonical));
  check("has a description", Boolean(meta.description));
  check("openGraph url matches the canonical",
    (meta.openGraph as { url?: string })?.url === `${SITE_URL}/experience/ml-engineer-acme`);
  check("title includes the subtitle", String(meta.title).includes("Acme"));

  const bodyless = detailMetadata({ ...view, summary: "", body: [] });
  check("a page with no summary or body still gets a description",
    Boolean(bodyless.description), String(bodyless.description));

  const ld = detailJsonLd(view) as Record<string, unknown>;
  check("JSON-LD credits the same #person node",
    (ld.author as { "@id": string })["@id"] === `${SITE_URL}/#person`);
  check("publisher too", (ld.publisher as { "@id": string })["@id"] === `${SITE_URL}/#person`);
  check("url is absolute", String(ld.url).startsWith("https://"));

  const projectLd = detailJsonLd({ ...view, type: "projects" }) as Record<string, unknown>;
  check("a project page is TechArticle, not Article", projectLd["@type"] === "TechArticle");

  console.log("\n── entity paths ──");
  const paths: Array<[EntityType, string]> = [
    ["experience", "/experience/x"],
    ["projects", "/projects/x"],
    ["skills", "/skills/x"],
    ["certifications", "/certifications/x"],
    // Posts live at /blog because that's what people type and link to.
    ["posts", "/blog/x"],
  ];
  for (const [type, expected] of paths) {
    check(`${type} → ${expected}`, entityPath(type, "x") === expected, entityPath(type, "x"));
  }
}

console.log("\n── empty-portfolio safety ──");
const bare = {
  ...seedPortfolio,
  projects: [],
  skills: [],
  education: [],
  certifications: [],
  experience: [],
};
check("projects list omitted when there are none", buildProjectsJsonLd(bare) === null);
check("person graph still builds with nothing optional", (() => {
  try { JSON.parse(JSON.stringify(buildPersonJsonLd(bare, AVATAR))); return true; } catch { return false; }
})());

console.log(failures === 0 ? "\nAll SEO checks passed.\n" : `\n${failures} SEO check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
