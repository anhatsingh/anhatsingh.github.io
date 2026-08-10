/*
  Renumbers sort_order by date across every dated table.

  The same operation as the "Newest first" / "Oldest first" buttons in the admin
  panel, and it shares their ordering function so the two can't disagree. This
  exists for the bulk case: setting every section at once, or repairing order
  after an import that left every row at sort_order 0.

  Dry run by default:
    npx tsx scripts/reorder-by-date.ts             # newest first, preview
    npx tsx scripts/reorder-by-date.ts --apply
    npx tsx scripts/reorder-by-date.ts --asc --apply
    npx tsx scripts/reorder-by-date.ts --only projects --apply
*/

import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { ADMIN_TABLES } from "../lib/admin/schema";
import { orderByDate } from "../lib/content/timeline";
import { checkSupabaseUrl } from "../lib/supabase/config";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} });

const apply = process.argv.includes("--apply");
const direction: "asc" | "desc" = process.argv.includes("--asc") ? "asc" : "desc";
// indexOf returns -1 when the flag is absent, and argv[0] is the node binary —
// so guarding this is the difference between "all tables" and "a table named
// /usr/local/bin/node".
const onlyAt = process.argv.indexOf("--only");
const only = onlyAt === -1 ? undefined : process.argv[onlyAt + 1];

async function main() {
  const { url, problem } = checkSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(problem ?? "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });

  const targets = ADMIN_TABLES.filter(
    (t) => t.dateField && !t.singleton && (!only || t.key === only),
  );

  if (!targets.length) {
    console.error(only ? `No dated table named "${only}".` : "No dated tables.");
    process.exit(1);
  }

  console.log(`\n${direction === "desc" ? "Newest" : "Oldest"} first${apply ? "" : " (dry run)"}\n`);

  for (const spec of targets) {
    const { data, error } = await db.from(spec.table).select("*");
    if (error) {
      console.error(`  ${spec.label}: ${error.message}`);
      continue;
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length < 2) {
      console.log(`  ${spec.label}: ${rows.length} row(s), nothing to order`);
      continue;
    }

    const ids = orderByDate(rows, spec.dateField!, direction);
    const byId = new Map(rows.map((r) => [String(r.id), r]));

    console.log(`  ${spec.label} — ${ids.length} rows, by ${spec.dateField}`);
    for (const [i, id] of ids.entries()) {
      const row = byId.get(id)!;
      const date = String(row[spec.dateField!] ?? "—");
      const title = String(row[spec.titleField] ?? id);
      console.log(`     ${String(i).padStart(2)}  ${date.padEnd(10)} ${title.slice(0, 58)}`);
    }

    if (apply) {
      for (const [i, id] of ids.entries()) {
        const { error: err } = await db.from(spec.table).update({ sort_order: i }).eq("id", id);
        if (err) console.error(`     ! ${id}: ${err.message}`);
      }
      console.log(`     written`);
    }
    console.log();
  }

  if (!apply) console.log("Dry run. Re-run with --apply to write.\n");
}

main();
