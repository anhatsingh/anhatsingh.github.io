"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { coerceRow, getTableSpec } from "@/lib/admin/schema";
import { getAdminSession, getSupabaseServerClient } from "@/lib/supabase/auth";
import { getServiceClient } from "@/lib/supabase/server";

/*
  All admin mutations.

  Every action re-checks the session itself. The layout guard is a convenience
  for rendering — it is NOT the security boundary, because a server action can
  be invoked directly without ever rendering the page that hosts it.

  Writes go through the service-role client (RLS denies anon writes by design),
  which is exactly why the auth check above it has to be unconditional.
*/

export type ActionResult = { ok: true } | { ok: false; error: string };

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

  revalidatePath("/");
  revalidatePath(`/admin/${tableKey}`);
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

  revalidatePath("/");
  revalidatePath(`/admin/${tableKey}`);
  return { ok: true };
}

export async function signOut() {
  const supabase = await getSupabaseServerClient();
  await supabase?.auth.signOut();
  redirect("/admin/login");
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
