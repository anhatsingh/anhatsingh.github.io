"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { coerceRow, getTableSpec } from "@/lib/admin/schema";
import { entityPath, type EntityType } from "@/lib/content/types";
import { getAdminSession, getSupabaseServerClient } from "@/lib/supabase/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { uploadImage, type UploadResult } from "@/lib/storage";
import {
  draftFromParagraph,
  generateShortSummary,
  type Draft,
  type DraftResult,
  type ShortSummaryResult,
  type ShortSummarySource,
} from "@/lib/ai/author";
import { getPortfolio } from "@/lib/content";
import { parseBlocks, type Block } from "@/lib/content/blocks";
import { orderByDate } from "@/lib/content/timeline";
import { reindexEntity } from "@/lib/chat/embeddings";
import { collectVocabulary, type Term } from "@/lib/content/vocabulary";
import { planRegroup, type EntryRow, type SkillRow, type Taxonomy } from "@/lib/admin/regroup";
import { proposeTaxonomy } from "@/lib/ai/taxonomy";
import { confirmFidelity, draftResume, draftResumeMeta, reviseResume } from "@/lib/ai/resume";
import { auditExtraction, hasErrors, type AuditFinding } from "@/lib/resume/audit";
import { renderResume } from "@/lib/resume/render";
import { compileTex } from "@/lib/resume/compile";
import { saveResume } from "@/lib/resume/store";
import { issueToken, listTokens, revokeToken, type IssuedToken, type McpToken } from "@/lib/mcp/tokens";
import { uploadResumePdf } from "@/lib/storage";
import type { Resume, ResumeMeta } from "@/lib/resume/schema";

/*
  All admin mutations.

  Every action re-checks the session itself. The layout guard is a convenience
  for rendering — it is NOT the security boundary, because a server action can
  be invoked directly without ever rendering the page that hosts it.

  Writes go through the service-role client (RLS denies anon writes by design),
  which is exactly why the auth check above it has to be unconditional.
*/

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Which admin tables have detail pages, and under which entity namespace. */
const DETAIL_ENTITY: Record<string, EntityType> = {
  experience: "experience",
  projects: "projects",
  skills: "skills",
  education: "education",
  certifications: "certifications",
  writing: "posts",
};

/*
  Revalidate everything a row appears on.

  Without the detail-page path, editing a post left its own page serving the old
  copy for up to a minute — the homepage updated instantly and the page you were
  actually looking at didn't, which reads as a broken save.

  /blog and the sitemap are included because a title or a show_in_blog_list
  change alters both.
*/
/*
  Re-embed after a write.

  Fire-and-forget, same pattern as logQuestion: an indexing failure must never
  fail a save. The alternative — awaiting it — would make every admin save wait
  on an embedding round trip, and a transient OpenAI error would look like the
  save itself failed.

  The cost of it being async is a brief window where the chatbot quotes the old
  body. `npm run reindex` is the escape hatch when that matters.
*/
function reindexAfterSave(tableKey: string, row: Record<string, unknown>) {
  const entity = DETAIL_ENTITY[tableKey];
  if (!entity) return;

  const slug = typeof row.slug === "string" ? row.slug : null;
  if (!slug) return;

  const spec = getTableSpec(tableKey);
  const titleField = spec?.titleField ?? "name";
  const title = String(row[titleField] ?? slug);

  void reindexEntity(entity, slug, title, parseBlocks(row.body));
}

function revalidateFor(tableKey: string, slug: unknown) {
  revalidatePath("/");
  revalidatePath(`/admin/${tableKey}`);

  const entity = DETAIL_ENTITY[tableKey];
  if (!entity) return;

  revalidatePath("/blog");
  revalidatePath("/sitemap.xml");
  if (typeof slug === "string" && slug) revalidatePath(entityPath(entity, slug));
}

async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) throw new Error("Not authorised");
  return session;
}

export async function saveRow(
  tableKey: string,
  id: string | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorised." };
  }

  const spec = getTableSpec(tableKey);
  if (!spec) return { ok: false, error: "Unknown section." };

  const db = getServiceClient();
  if (!db) return { ok: false, error: "Supabase isn't configured (SUPABASE_SERVICE_ROLE_KEY)." };

  const row = coerceRow(spec, formData);
  // Captured before the update branch deletes it from `row`.
  const slug = row.slug;

  for (const field of spec.fields) {
    if (field.required && !row[field.name]) {
      return { ok: false, error: `${field.label} is required.` };
    }
  }

  if (spec.singleton) {
    // Singleton is pinned to id=1 by a CHECK constraint, so upsert is stable.
    const { error } = await db.from(spec.table).upsert({ ...row, id: 1 });
    if (error) return { ok: false, error: error.message };
  } else if (id) {
    // Slug is locked after creation — stripping it here means a tampered form
    // still can't rewrite an id the chatbot may already be referencing.
    delete row.slug;
    const { error } = await db.from(spec.table).update(row).eq("id", id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await db.from(spec.table).insert(row);
    if (error) return { ok: false, error: error.message };
  }

  revalidateFor(tableKey, slug);
  reindexAfterSave(tableKey, { ...row, slug });
  return { ok: true };
}

/**
 * Renumbers sort_order across a table so it matches date order.
 *
 * This writes rather than sorting at render time, deliberately. sort_order is
 * what every reader already honours — homepage, detail pages, sitemap, the
 * chatbot's sense of "most recent" — so making the date the source of truth in
 * one place and leaving sort_order stale would have those two disagree. After
 * this runs, a single row can still be dragged out of place by editing its
 * number, and that edit survives until this is run again.
 *
 * Rows with no date sink to the bottom in both directions. They have no
 * position on a timeline, and floating them to the top in ascending order
 * would put the least-known entries first.
 */
export async function reorderByDate(
  tableKey: string,
  direction: "asc" | "desc",
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorised." };
  }

  const spec = getTableSpec(tableKey);
  if (!spec) return { ok: false, error: "Unknown section." };
  if (!spec.dateField) return { ok: false, error: `${spec.label} has no date to sort on.` };

  const db = getServiceClient();
  if (!db) return { ok: false, error: "Supabase isn't configured." };

  // select("*") rather than a built column list: the client's types can't
  // narrow a column name only known at runtime, and these tables are small.
  const { data, error } = await db.from(spec.table).select("*");
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as Record<string, unknown>[];
  if (!rows.length) return { ok: true };

  // Shared with scripts/reorder-by-date.ts, and it uses the same date parser
  // as the timeline so "2021" and "2021-06" order against each other properly
  // rather than sorting as strings.
  const ids = orderByDate(rows, spec.dateField, direction);

  // Sequential rather than batched: an upsert would need every NOT NULL column
  // present, and sending partial rows through it would blank them.
  for (let i = 0; i < ids.length; i++) {
    const { error: err } = await db.from(spec.table).update({ sort_order: i }).eq("id", ids[i]);
    if (err) return { ok: false, error: err.message };
  }

  revalidateFor(tableKey, null);
  return { ok: true };
}

export async function deleteRow(tableKey: string, id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorised." };
  }

  const spec = getTableSpec(tableKey);
  if (!spec || spec.singleton) return { ok: false, error: "Can't delete that." };

  const db = getServiceClient();
  if (!db) return { ok: false, error: "Supabase isn't configured." };

  const { error } = await db.from(spec.table).delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  // No slug to hand over — the row is gone. The index paths still need
  // refreshing so the deleted entry stops appearing in listings.
  revalidateFor(tableKey, null);
  return { ok: true };
}

export async function signOut() {
  const supabase = await getSupabaseServerClient();
  await supabase?.auth.signOut();
  redirect("/admin/login");
}

/**
 * Saves the repositories chosen in /admin/repos.
 *
 * Stored on the profile singleton rather than its own table — it's one array
 * belonging to one person, and a table would buy nothing.
 */
export async function saveSelectedRepos(repos: string[]): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorised." };
  }

  const db = getServiceClient();
  if (!db) return { ok: false, error: "Supabase isn't configured." };

  // Cap and sanitise: these come from a client form, and the column is only
  // ever compared against GitHub's own nameWithOwner values.
  const clean = [...new Set(repos)]
    .filter((r) => typeof r === "string" && /^[\w.-]+\/[\w.-]+$/.test(r))
    .slice(0, 300);

  const { error } = await db.from("profile").update({ selected_repos: clean }).eq("id", 1);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  revalidatePath("/admin/repos");
  return { ok: true };
}

/**
 * Uploads an image and returns its public URL.
 *
 * Auth is re-checked here, not inherited from the page: a server action is
 * directly invocable, and this one writes to storage with the service key.
 */
export async function uploadMedia(formData: FormData): Promise<UploadResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorised." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file received." };

  return uploadImage(file);
}

/**
 * Asks the model for a draft. Writes nothing.
 *
 * The existing skill list is passed in so the model reuses established
 * spellings rather than inventing a third variant of "PyTorch".
 */
export async function requestDraft(input: {
  entityType: "experience" | "projects" | "skills" | "education" | "certifications" | "posts";
  title: string;
  paragraph: string;
  prompt?: string;
}): Promise<DraftResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorised." };
  }

  const { skills } = await getPortfolio();
  return draftFromParagraph({ ...input, existingSkills: skills });
}

/**
 * Condenses a role into one line for the timeline card.
 *
 * Returns the text rather than writing it: the value lands in the form field
 * for review and is only persisted when the form is saved, which keeps this
 * consistent with the rest of the AI tooling here — nothing the model produces
 * reaches the database without passing a human first.
 */
export async function requestShortSummary(
  source: ShortSummarySource,
): Promise<ShortSummaryResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorised." };
  }

  return generateShortSummary(source);
}

/*
  The skills taxonomy: propose, then apply what was approved.

  Two actions rather than one, for the reason requestShortSummary states above
  — nothing a model produces reaches the database without passing a person
  first. requestTaxonomy reads and returns; applyTaxonomy takes back only what
  the human left ticked.
*/

export type TaxonomyProposal = {
  taxonomy: Taxonomy;
  vocabulary: Term[];
  /** Every skill row, published or not — see the note on SkillRow. */
  current: SkillRow[];
  entries: EntryRow[];
};

export type TaxonomyRequest = { ok: true; proposal: TaxonomyProposal } | { ok: false; error: string };

/*
  Reads skills through the SERVICE client, deliberately.

  getPortfolio() goes through the public client, where RLS hides unpublished
  rows — and this database has fifty-two of them, every one still holding its
  slug under the unique index. Planning against the public view would mint a
  slug that already exists and fail on insert, and only on a second run, in
  production.

  Experience and projects do come from the portfolio: only published entries
  should contribute vocabulary in the first place.
*/
export async function loadTaxonomyInputs(): Promise<
  { ok: true; vocabulary: Term[]; current: SkillRow[]; entries: EntryRow[] } | { ok: false; error: string }
> {
  const db = getServiceClient();
  if (!db) return { ok: false, error: "No service key, so skills can't be read in full." };

  const { data, error } = await db
    .from("skills")
    .select("slug, name, category, sort_order, is_published, body, show_in_blog_list, hero_image_url");
  if (error) return { ok: false, error: error.message };

  const current: SkillRow[] = (data ?? []).map((r: Record<string, unknown>) => ({
    slug: String(r.slug),
    name: String(r.name),
    category: String(r.category ?? "Other"),
    sortOrder: Number(r.sort_order ?? 0),
    isPublished: r.is_published !== false,
    hasBody: Array.isArray(r.body) && r.body.length > 0,
    inBlogList: r.show_in_blog_list === true,
    hasHeroImage: Boolean(r.hero_image_url),
  }));

  const portfolio = await getPortfolio();
  const entries: EntryRow[] = [
    ...portfolio.experience.map((e) => ({ section: "experience" as const, slug: e.slug, tech: e.tech })),
    ...portfolio.projects.map((p) => ({ section: "projects" as const, slug: p.slug, tech: p.tech })),
  ];

  return { ok: true, vocabulary: collectVocabulary(portfolio), current, entries };
}

export async function requestTaxonomy(): Promise<TaxonomyRequest> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorised." };
  }

  const inputs = await loadTaxonomyInputs();
  if (!inputs.ok) return inputs;

  const proposed = await proposeTaxonomy(inputs.vocabulary);
  if (!proposed.ok) return proposed;

  return {
    ok: true,
    proposal: {
      taxonomy: proposed.taxonomy,
      vocabulary: inputs.vocabulary,
      current: inputs.current,
      entries: inputs.entries,
    },
  };
}

export type TaxonomyApplied =
  | { ok: true; upserted: number; unpublished: number; rewritten: number; noop: boolean }
  | { ok: false; error: string };

/**
 * Applies an approved taxonomy.
 *
 * `rewriteTech` is separate and off unless ticked: rewriting a tech list edits
 * what an entry card says about itself, which is a content change the human is
 * making rather than a side effect of approving some headings. Skipping it
 * leaves merged skills with thinner evidence pages, which is the lesser harm
 * and a reversible one.
 */
export async function applyTaxonomy(
  taxonomy: Taxonomy,
  options: { rewriteTech: boolean },
): Promise<TaxonomyApplied> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorised." };
  }

  const db = getServiceClient();
  if (!db) return { ok: false, error: "No service key." };

  const inputs = await loadTaxonomyInputs();
  if (!inputs.ok) return inputs;

  const plan = planRegroup(taxonomy, inputs.vocabulary, inputs.current, inputs.entries);
  if (plan.noop && (!options.rewriteTech || plan.rewrites.length === 0)) {
    return { ok: true, upserted: 0, unpublished: 0, rewritten: 0, noop: true };
  }

  /*
    One row at a time, as reorderByDate does. A batched upsert would need every
    NOT NULL column present on every row, and a partial row blanks what it
    omits — which here would wipe the bodies of the skills that have one.
  */
  for (const row of plan.upserts) {
    const existing = inputs.current.find((s) => s.slug === row.slug);
    const { error } = existing
      ? await db
          .from("skills")
          .update({ name: row.name, category: row.category, sort_order: row.sortOrder, is_published: true })
          .eq("slug", row.slug)
      : await db
          .from("skills")
          .insert({ slug: row.slug, name: row.name, category: row.category, sort_order: row.sortOrder });

    if (error) return { ok: false, error: `${row.name}: ${error.message}` };

    // A renamed skill with a page needs its embedding chunks rewritten, or
    // retrieval keeps answering under the old title.
    if (existing?.hasBody && existing.name !== row.name) {
      reindexAfterSave("skills", { slug: row.slug, name: row.name });
    }
  }

  for (const slug of plan.unpublish) {
    const { error } = await db.from("skills").update({ is_published: false }).eq("slug", slug);
    if (error) return { ok: false, error: `${slug}: ${error.message}` };
  }

  let rewritten = 0;
  if (options.rewriteTech) {
    for (const rewrite of plan.rewrites) {
      const table = rewrite.section === "experience" ? "experience" : "projects";
      const { error } = await db.from(table).update({ tech: rewrite.tech }).eq("slug", rewrite.slug);
      if (error) return { ok: false, error: `${rewrite.slug}: ${error.message}` };
      rewritten++;
    }
  }

  revalidateFor("skills", null);
  for (const row of plan.upserts) revalidatePath(entityPath("skills", row.slug));

  return {
    ok: true,
    upserted: plan.upserts.length,
    unpublished: plan.unpublish.length,
    rewritten,
    noop: false,
  };
}

/**
 * Writes the parts of a draft the human ticked.
 *
 * Everything is optional and applied independently, because the review panel
 * lets each piece be accepted or rejected on its own. New skills are created
 * only when explicitly included — the isNew flag exists so that decision is
 * always deliberate rather than a side effect of a typo.
 */
export async function applyDraft(input: {
  tableKey: string;
  rowId: string;
  summary?: string;
  highlights?: string[];
  body?: Block[];
  tech?: string[];
  newSkills?: Array<{ name: string; slug: string; category: string }>;
}): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorised." };
  }

  const spec = getTableSpec(input.tableKey);
  if (!spec) return { ok: false, error: "Unknown section." };

  const db = getServiceClient();
  if (!db) return { ok: false, error: "Supabase isn't configured." };

  // Only send columns that exist on this table — skills have no highlights,
  // certifications have no tech.
  const columns = new Set(spec.fields.map((f) => f.name));
  const patch: Record<string, unknown> = {};
  if (input.summary !== undefined && columns.has("summary")) patch.summary = input.summary;
  if (input.highlights !== undefined && columns.has("highlights")) patch.highlights = input.highlights;
  if (input.body !== undefined && columns.has("body")) patch.body = input.body;
  if (input.tech !== undefined && columns.has("tech")) patch.tech = input.tech;

  if (Object.keys(patch).length) {
    const { error } = await db.from(spec.table).update(patch).eq("id", input.rowId);
    if (error) return { ok: false, error: error.message };
  }

  if (input.newSkills?.length) {
    // Upsert on slug so re-applying a draft can't create duplicates, and an
    // existing skill's category isn't clobbered.
    const { error } = await db.from("skills").upsert(
      input.newSkills.map((s) => ({
        slug: s.slug,
        name: s.name,
        category: s.category || "Other",
        sort_order: 900,
      })),
      { onConflict: "slug", ignoreDuplicates: true },
    );
    if (error) return { ok: false, error: `Skills: ${error.message}` };
  }

  const { data: row } = await db
    .from(spec.table)
    .select("*")
    .eq("id", input.rowId)
    .maybeSingle();

  revalidateFor(input.tableKey, row?.slug);
  if (row) reindexAfterSave(input.tableKey, row);

  return { ok: true };
}

/*
  What the LinkedIn importer is allowed to touch.

  Keyed by the group the review screen shows rather than by table, because the
  two aren't one-to-one: volunteering has no table of its own and rides in
  `experience`, and the counts read better as "6 volunteering" than as a lump
  added to "experience".
*/
const IMPORT_TARGETS = {
  experience: { table: "experience" },
  education: { table: "education" },
  skills: { table: "skills" },
  certifications: { table: "certifications" },
  projects: { table: "projects", drop: ["started"] },
  testimonials: { table: "testimonials" },
  /*
    Volunteering lands unpublished. Six society roles appearing unannounced in
    a work timeline misrepresents it, so it stays hidden until reviewed — but
    only for rows that are new. Forcing is_published on every import would undo
    the publish decision every time a fresh export is re-imported.
  */
  volunteering: { table: "experience", unpublishNew: true },
} as const;

export type ImportGroup = keyof typeof IMPORT_TARGETS;

export type ImportPayload = Partial<Record<ImportGroup, Record<string, unknown>[]>>;

/**
 * Upserts parsed LinkedIn records, keyed on slug.
 *
 * Upsert rather than insert is what makes re-importing safe: running a fresh
 * export six months later updates the rows that changed instead of creating a
 * second copy of every job.
 *
 * Only the columns present in each row are written, so fields the export
 * doesn't know about survive a re-import untouched — logo_url in particular,
 * since LinkedIn's archive contains no logo URLs and hand-added logos would
 * otherwise be wiped every time Anhat re-syncs.
 */
export async function importLinkedIn(
  payload: ImportPayload,
): Promise<ActionResult & { counts?: Record<string, number> }> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorised." };
  }

  const db = getServiceClient();
  if (!db) return { ok: false, error: "Supabase isn't configured." };

  const counts: Record<string, number> = {};

  for (const group of Object.keys(IMPORT_TARGETS) as ImportGroup[]) {
    const target = IMPORT_TARGETS[group] as {
      table: string;
      drop?: readonly string[];
      unpublishNew?: boolean;
    };
    const rows = payload[group];
    if (!rows?.length) continue;

    // Parser fields that aren't columns would fail the whole upsert.
    let prepared = rows.map((row) => {
      if (!target.drop) return row;
      const copy = { ...row };
      for (const key of target.drop) delete copy[key];
      return copy;
    });

    if (target.unpublishNew) {
      const slugs = prepared.map((r) => String(r.slug));
      const { data: existing } = await db.from(target.table).select("slug").in("slug", slugs);
      const known = new Set((existing ?? []).map((r) => r.slug as string));
      prepared = prepared.map((row) =>
        known.has(String(row.slug)) ? row : { ...row, is_published: false },
      );
    }

    const { error } = await db.from(target.table).upsert(prepared, { onConflict: "slug" });
    if (error) return { ok: false, error: `${group}: ${error.message}` };

    counts[group] = prepared.length;
  }

  revalidatePath("/");
  return { ok: true, counts };
}


/*
  Resume generation.

  Split into draft and compile deliberately, so a human reads the proposal
  before anything is rendered or stored — the same propose-then-apply shape as
  applyDraft. Nothing here writes until compileAndSaveResume is called.
*/

export type ResumeDraftAction =
  | { ok: true; resume: Resume; meta: ResumeMeta; dropped: string[] }
  | { ok: false; error: string };

/** Drafts a resume and its keywords from a job description. Writes nothing. */
export async function requestResumeDraft(jobDescription: string): Promise<ResumeDraftAction> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorised." };
  }

  const portfolio = await getPortfolio();
  const draft = await draftResume(jobDescription, portfolio);
  if (!draft.ok) return draft;

  const meta = await draftResumeMeta(draft.resume, jobDescription);
  if (!meta.ok) {
    // Keywords failing shouldn't throw away a good draft — the admin can write
    // them by hand, so hand back an empty shell instead of an error.
    return {
      ok: true,
      resume: draft.resume,
      dropped: draft.dropped,
      meta: { label: "", slug: "", keywords: [] },
    };
  }

  return { ok: true, resume: draft.resume, meta: meta.meta, dropped: draft.dropped };
}

export type ResumeCheckAction =
  | {
      ok: true;
      resume: Resume;
      findings: AuditFinding[];
      revised: boolean;
      pages: number;
      /** Data URL, so the draft can be previewed before anything is stored. */
      previewPdf: string;
    }
  | { ok: false; error: string; log?: string };

/**
 * Compiles a draft, reads the PDF back, and fixes what is wrong.
 *
 * The order matters. Deterministic checks run first because they are cheap and
 * never disagree with themselves — they catch missing content, mangled
 * headings, leaked escapes. Only then is the model asked to judge fidelity,
 * which is the part no rule can decide.
 *
 * One revision round, not a loop. A second pass that still fails usually means
 * the source data is thin rather than the wording wrong, and a human reading
 * the findings will get further than another attempt.
 *
 * Nothing is written here. The result is a proposal and a preview.
 */
export async function checkResume(input: {
  resume: Resume;
  jobDescription: string;
}): Promise<ResumeCheckAction> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorised." };
  }

  const portfolio = await getPortfolio();

  const compiled = await compileTex(renderResume(input.resume));
  if (!compiled.ok) return { ok: false, error: `LaTeX: ${compiled.error}`, log: compiled.log };

  let findings = auditExtraction(input.resume, compiled.text, compiled.pages);

  const fidelity = await confirmFidelity(input.resume, compiled.text);
  if (fidelity.ok) findings = [...findings, ...fidelity.findings];

  // Warnings are for a human to weigh; only errors are worth spending a
  // revision round and another compile on.
  if (!hasErrors(findings)) {
    return {
      ok: true,
      resume: input.resume,
      findings,
      revised: false,
      pages: compiled.pages,
      previewPdf: toDataUrl(compiled.pdf),
    };
  }

  const revision = await reviseResume(input.resume, findings, input.jobDescription, portfolio);
  if (!revision.ok) {
    return {
      ok: true,
      resume: input.resume,
      findings,
      revised: false,
      pages: compiled.pages,
      previewPdf: toDataUrl(compiled.pdf),
    };
  }

  const recompiled = await compileTex(renderResume(revision.resume));
  if (!recompiled.ok) {
    // The revision broke the build, so the original stands — better a document
    // with known flaws than none at all.
    return {
      ok: true,
      resume: input.resume,
      findings,
      revised: false,
      pages: compiled.pages,
      previewPdf: toDataUrl(compiled.pdf),
    };
  }

  const after = auditExtraction(revision.resume, recompiled.text, recompiled.pages);
  const afterFidelity = await confirmFidelity(revision.resume, recompiled.text);

  return {
    ok: true,
    resume: revision.resume,
    findings: afterFidelity.ok ? [...after, ...afterFidelity.findings] : after,
    revised: true,
    pages: recompiled.pages,
    previewPdf: toDataUrl(recompiled.pdf),
  };
}

/** Base64 data URL, so a preview needs no storage and leaves nothing behind. */
function toDataUrl(pdf: Uint8Array): string {
  return `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`;
}

export type ResumeSaveAction = { ok: true; slug: string; pdfUrl: string } | { ok: false; error: string };

/** Renders, compiles, stores the PDF, and saves the row. */
export async function compileAndSaveResume(input: {
  resume: Resume;
  meta: ResumeMeta;
  jobDescription: string;
  isDefault: boolean;
  isPublished: boolean;
}): Promise<ResumeSaveAction> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorised." };
  }

  if (!input.meta.slug.trim() || !input.meta.label.trim()) {
    return { ok: false, error: "Give it a label and a slug first." };
  }

  const compiled = await compileTex(renderResume(input.resume));
  if (!compiled.ok) {
    // The first line of a TeX log beginning with "!" is the only useful part of
    // several thousand; compile.ts pulls it out so this can be acted on.
    return { ok: false, error: `LaTeX: ${compiled.error}` };
  }

  const upload = await uploadResumePdf(compiled.pdf, input.meta.slug);
  if (!upload.ok || !upload.url) return { ok: false, error: upload.error ?? "Upload failed." };

  const saved = await saveResume({
    meta: input.meta,
    resume: input.resume,
    pdfUrl: upload.url,
    jobDescription: input.jobDescription,
    isDefault: input.isDefault,
    isPublished: input.isPublished,
  });
  if (!saved.ok) return { ok: false, error: saved.error };

  revalidatePath("/admin/resumes");
  revalidatePath("/");
  return { ok: true, slug: saved.slug, pdfUrl: upload.url };
}


/*
  MCP tokens.

  Issuing and revoking only — nothing here can read a hash back, because
  lib/mcp/tokens.ts never selects the column. The plaintext is returned once,
  to the browser that asked for it, and is not stored anywhere it could be
  fetched again.
*/

export async function loadMcpTokens(): Promise<McpToken[]> {
  try {
    await requireAdmin();
  } catch {
    return [];
  }
  return listTokens();
}

export async function createMcpToken(label: string): Promise<IssuedToken> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorised." };
  }

  const result = await issueToken(label);
  if (result.ok) revalidatePath("/admin/mcp");
  return result;
}

export async function revokeMcpToken(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorised." };
  }

  const result = await revokeToken(id);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/admin/mcp");
  return { ok: true };
}
