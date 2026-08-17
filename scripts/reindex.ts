/*
  Re-embeds every body on the site.

  The escape hatch for when the fire-and-forget hook in saveRow didn't run —
  a bulk SQL edit, an OpenAI outage during a save, or a change to the chunking
  logic that makes existing chunks stale.

  Run: npm run reindex
*/

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} });

async function main() {
  const { getPortfolio } = await import("../lib/content");
  const { reindexEntity } = await import("../lib/chat/embeddings");
  const { getServiceClient } = await import("../lib/supabase/server");

  if (!process.env.OPENAI_API_KEY) {
    console.error("\nOPENAI_API_KEY isn't set — embedding needs it.\n");
    process.exit(1);
  }
  if (!getServiceClient()) {
    console.error("\nSUPABASE_SERVICE_ROLE_KEY isn't set.\n");
    process.exit(1);
  }

  const p = await getPortfolio();

  const targets = [
    ...p.experience.map((e) => ["experience", e.slug, e.role, e.body] as const),
    ...p.projects.map((x) => ["projects", x.slug, x.name, x.body] as const),
    ...p.skills.map((x) => ["skills", x.slug, x.name, x.body] as const),
    ...p.education.map((x) => ["education", x.slug, x.degree, x.body] as const),
    ...p.certifications.map((x) => ["certifications", x.slug, x.name, x.body] as const),
    ...p.writing.map((w) => ["posts", w.slug, w.title, w.body] as const),
  ].filter(([, , , body]) => body.length > 0);

  if (!targets.length) {
    console.log("\nNothing to index — no entity has a body yet.\n");
    return;
  }

  console.log(`\nIndexing ${targets.length} bodies…\n`);
  for (const [type, slug, title, body] of targets) {
    process.stdout.write(`  ${type}:${slug} … `);
    await reindexEntity(type, slug, title, body);
    console.log("done");
  }
  console.log("\nReindex complete.\n");
}

main().catch((err) => {
  console.error("\nFailed:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
