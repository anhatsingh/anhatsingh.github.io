"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { coerceRow, getTableSpec } from "@/lib/admin/schema";
import { entityPath, type EntityType } from "@/lib/content/types";
import { getAdminSession, getSupabaseServerClient } from "@/lib/supabase/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { uploadImage, type UploadResult } from "@/lib/storage";
import { draftFromParagraph, type Draft, type DraftResult } from "@/lib/ai/author";
import { getPortfolio } from "@/lib/content";
import { parseBlocks, type Block } from "@/lib/content/blocks";
import { reindexEntity } from "@/lib/chat/embeddings";

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
  entityType: "experience" | "projects" | "skills" | "certifications" | "posts";
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
