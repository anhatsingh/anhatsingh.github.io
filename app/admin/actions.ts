"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { coerceRow, getTableSpec } from "@/lib/admin/schema";
import { entityPath, type EntityType } from "@/lib/content/types";
import { getAdminSession, getSupabaseServerClient } from "@/lib/supabase/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { uploadImage, type UploadResult } from "@/lib/storage";

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

/** Tables the LinkedIn importer is allowed to touch. */
const IMPORTABLE = ["experience", "education", "skills", "certifications"] as const;
export type ImportableTable = (typeof IMPORTABLE)[number];

export type ImportPayload = Partial<Record<ImportableTable, Record<string, unknown>[]>>;

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

  for (const table of IMPORTABLE) {
    const rows = payload[table];
    if (!rows?.length) continue;

    const { error } = await db.from(table).upsert(rows, { onConflict: "slug" });
    if (error) return { ok: false, error: `${table}: ${error.message}` };

    counts[table] = rows.length;
  }

  revalidatePath("/");
  return { ok: true, counts };
}
