/*
  Re-categorises the LinkedIn-imported skills.

  The import deliberately dumped everything into one "Imported" bucket, because
  LinkedIn has no category concept and guessing at import time would have been
  wrong quietly. This is the deliberate second pass.

  Three problems, not one:

   1. No categories. 100 badges in a single block is unreadable.
   2. Duplicates. LinkedIn stores "Python" and "Python (Programming Language)"
      as separate skills, and its parenthetical suffixes ("(Software)",
      "(Language Model)") read as noise on a portfolio.
   3. Volume. 100 skills says "I ticked every box on LinkedIn". A curated ~35
      says "I know what I'm good at" — which is the thing a recruiter is
      actually assessing.

  Nothing is deleted. Skills that don't make the cut are set is_published =
  false, so they vanish from the site but stay in /admin to re-enable.

  Run: npx tsx scripts/tidy-skills.ts          (dry run — prints the plan)
       npx tsx scripts/tidy-skills.ts --apply  (writes)
*/

import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { checkSupabaseUrl } from "../lib/supabase/config";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} });

/*
  Category order is the display order, and it leads with ML because that's the
  role being targeted. A recruiter screening for AI/ML should hit the relevant
  block first rather than scrolling past web frameworks to reach it.
*/
const PLAN: Array<{ category: string; skills: Array<[linkedinName: string, display?: string]> }> = [
  {
    category: "AI & Machine Learning",
    skills: [
      ["Machine Learning"],
      ["Deep Learning"],
      ["Large Language Models (LLM)", "LLMs"],
      ["Transformers"],
      ["PyTorch"],
      ["TensorFlow"],
      ["Scikit-Learn"],
      ["BERT (Language Model)", "BERT"],
      ["Supervised Learning"],
      ["Regression Models"],
      ["Bayesian statistics", "Bayesian Statistics"],
    ],
  },
  {
    category: "Data",
    skills: [
      ["Pandas (Software)", "Pandas"],
      ["NumPy"],
      ["Apache Spark", "Spark"],
      ["PySpark"],
      ["Extract, Transform, Load (ETL)", "ETL"],
      ["Data Science"],
      ["Statistical Data Analysis"],
      ["Data Visualization"],
      ["Large-scale Data Processing"],
      ["Microsoft Power BI", "Power BI"],
      ["Tableau"],
    ],
  },
  {
    category: "Languages",
    skills: [
      ["Python"],
      ["JavaScript"],
      ["SQL"],
      ["Java"],
      ["C (Programming Language)", "C"],
      ["Dart"],
      ["Bash"],
      ["LaTeX"],
    ],
  },
  {
    category: "Backend",
    skills: [
      ["FastAPI"],
      ["Flask"],
      ["Celery"],
      ["REST APIs"],
      ["PostgreSQL"],
      ["Redis"],
      ["Microsoft SQL Server", "SQL Server"],
    ],
  },
  {
    category: "Frontend",
    skills: [
      ["React.js", "React"],
      ["Vue.js", "Vue"],
      ["Flutter"],
      ["HTML"],
      ["Cascading Style Sheets (CSS)", "CSS"],
      ["Figma (Software)", "Figma"],
    ],
  },
  {
    category: "Infrastructure & Tools",
    skills: [
      ["Amazon Web Services (AWS)", "AWS"],
      ["Linux"],
      ["Git"],
      ["Continuous Integration and Continuous Delivery (CI/CD)", "CI/CD"],
      ["Shell Scripting"],
    ],
  },
];

/*
  Sort order is category block × 100 + position, so a whole category can be
  reordered later without renumbering every row, and inserting a skill mid-block
  doesn't collide.
*/
const BLOCK = 100;

async function main() {
  const apply = process.argv.includes("--apply");

  const { url, problem } = checkSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!url) throw new Error(problem ?? "NEXT_PUBLIC_SUPABASE_URL not set");

  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: existing, error } = await db.from("skills").select("id,slug,name,category");
  if (error) throw new Error(error.message);

  /*
    Look up by BOTH the LinkedIn name and the cleaned display name.

    This script renames rows, which made an earlier version destructive on a
    second run: after "Pandas (Software)" had become "Pandas", the plan could no
    longer find it, so it fell through to the hidden set. Re-running a tidy-up
    must be a no-op, not a cull.
  */
  const byName = new Map(existing.map((s) => [s.name.toLowerCase(), s]));
  const find = (linkedinName: string, display?: string) =>
    byName.get(linkedinName.toLowerCase()) ??
    (display ? byName.get(display.toLowerCase()) : undefined);
  const updates: Array<{ id: string; name: string; category: string; sort_order: number }> = [];
  const missing: string[] = [];
  const keptIds = new Set<string>();

  PLAN.forEach((group, blockIndex) => {
    group.skills.forEach(([linkedinName, display], position) => {
      const row = find(linkedinName, display);
      if (!row) {
        missing.push(linkedinName);
        return;
      }
      keptIds.add(row.id);
      updates.push({
        id: row.id,
        name: display ?? linkedinName,
        category: group.category,
        sort_order: blockIndex * BLOCK + position,
      });
    });
  });

  const hidden = existing.filter((s) => !keptIds.has(s.id));

  console.log(`\n${existing.length} skills in the database\n`);
  for (const group of PLAN) {
    const names = updates
      .filter((u) => u.category === group.category)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((u) => u.name);
    console.log(`  ${group.category} (${names.length})`);
    console.log(`    ${names.join(" · ")}\n`);
  }

  console.log(`  Hidden — is_published=false, still editable in /admin (${hidden.length}):`);
  console.log(`    ${hidden.map((h) => h.name).join(", ")}\n`);

  if (missing.length) {
    console.log(`  Named in the plan but not in the database (${missing.length}):`);
    console.log(`    ${missing.join(", ")}\n`);
  }

  if (!apply) {
    console.log("Dry run. Re-run with --apply to write.\n");
    return;
  }

  for (const u of updates) {
    const { error: e } = await db
      .from("skills")
      .update({ name: u.name, category: u.category, sort_order: u.sort_order, is_published: true })
      .eq("id", u.id);
    if (e) throw new Error(`${u.name}: ${e.message}`);
  }

  if (hidden.length) {
    const { error: e } = await db
      .from("skills")
      .update({ is_published: false })
      .in("id", hidden.map((h) => h.id));
    if (e) throw new Error(e.message);
  }

  console.log(`Applied. ${updates.length} shown, ${hidden.length} hidden.\n`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message, "\n");
  process.exit(1);
});
