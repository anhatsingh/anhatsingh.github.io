/*
  Fills dates the importer parsed but had nowhere to put: `started`/`ended` on
  projects, and `received_at` on testimonials.

  The projects table had no date column when the archive was first imported, so
  the importer parsed "Started On" and then dropped it. That is why the section
  came out in arbitrary order — there was nothing to sort on. This backfills the
  dates that were already in the archive rather than asking for them again.

  Matches on slug, which the importer derives from the project title the same
  way both times, so re-running is safe and idempotent.

  Dry run by default:
    npx tsx scripts/backfill-project-dates.ts <export.zip>
    npx tsx scripts/backfill-project-dates.ts <export.zip> --apply
*/

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { parseLinkedInExport } from "../lib/linkedin/import";
import { checkSupabaseUrl } from "../lib/supabase/config";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} });

const apply = process.argv.includes("--apply");
const zipPath = process.argv.slice(2).find((a) => !a.startsWith("--"));

async function main() {
  if (!zipPath) {
    console.error("Usage: npx tsx scripts/backfill-project-dates.ts <export.zip> [--apply]");
    process.exit(1);
  }

  const { url, problem } = checkSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(problem ?? "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });

  const buf = readFileSync(zipPath);
  const parsed = await parseLinkedInExport(buf as unknown as Blob);
  console.log(`\nArchive holds ${parsed.projects.length} projects.\n`);

  const { data: rows, error } = await db.from("projects").select("slug,name,started,ended");
  if (error) {
    // The most likely cause by far is the migration not having been run yet.
    console.error(`Couldn't read projects: ${error.message}`);
    console.error("If this mentions a missing column, run lib/db/schema.sql first.");
    process.exit(1);
  }

  const bySlug = new Map((rows ?? []).map((r) => [r.slug as string, r]));
  const updates: Array<{ slug: string; started: string; ended: string | null }> = [];
  const unmatched: string[] = [];

  for (const p of parsed.projects) {
    const row = bySlug.get(p.slug);
    if (!row) {
      unmatched.push(p.name);
      continue;
    }
    if (!p.started) continue;

    // Don't overwrite a date already set by hand in the admin panel.
    if (row.started) {
      console.log(`  = ${p.slug} — already dated ${row.started}, left alone`);
      continue;
    }

    updates.push({ slug: p.slug, started: p.started, ended: p.ended ?? null });
    console.log(`  + ${p.slug} — ${p.started}${p.ended ? ` → ${p.ended}` : ""}`);
  }

  for (const name of unmatched) console.log(`  ? "${name}" — no matching row, skipped`);

  /*
    Recommendations carry a "Creation Date" that had no column until the life
    graph needed one. Same rule as projects: never overwrite a date already set
    by hand.
  */
  const { data: tRows } = await db.from("testimonials").select("slug,received_at");
  const tBySlug = new Map((tRows ?? []).map((r) => [r.slug as string, r]));
  const tUpdates: Array<{ slug: string; received_at: string }> = [];

  for (const t of parsed.testimonials) {
    const row = tBySlug.get(t.slug);
    if (!row || !t.received_at) continue;
    if (row.received_at) {
      console.log(`  = ${t.slug} — already dated ${row.received_at}, left alone`);
      continue;
    }
    tUpdates.push({ slug: t.slug, received_at: t.received_at });
    console.log(`  + ${t.slug} — recommended ${t.received_at}`);
  }

  if (apply) {
    for (const u of tUpdates) {
      const { error: err } = await db
        .from("testimonials")
        .update({ received_at: u.received_at })
        .eq("slug", u.slug);
      if (err) console.error(`  ! ${u.slug}: ${err.message}`);
    }
    if (tUpdates.length) console.log(`\nDated ${tUpdates.length} testimonial(s).`);
  }

  if (!updates.length) {
    console.log(
      tUpdates.length && !apply
        ? `\nDry run. ${tUpdates.length} testimonial(s) would be dated. Re-run with --apply.\n`
        : "\nNothing further to backfill.\n",
    );
    return;
  }

  if (!apply) {
    console.log(`\nDry run. ${updates.length} project(s) would be dated. Re-run with --apply.\n`);
    return;
  }

  for (const u of updates) {
    const { error: err } = await db
      .from("projects")
      .update({ started: u.started, ended: u.ended })
      .eq("slug", u.slug);
    if (err) console.error(`  ! ${u.slug}: ${err.message}`);
  }

  console.log(`\nDated ${updates.length} project(s).\n`);
}

main();
