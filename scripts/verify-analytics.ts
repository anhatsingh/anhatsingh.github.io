/*
  Attribution, and the two ways it lies.

  The point of this table is to decide where to spend effort, so the failure
  that matters is not a crash — it's a number that quietly ranks the wrong
  channel first. Two produce that:

    1. Losing the tag on the second page. UTM parameters exist only on the
       landing URL, so a visitor who arrives from LinkedIn and reads three
       project pages files as one LinkedIn visit and three direct ones. The
       working channel then looks like it does nothing.

    2. Counting rows instead of people. One visitor reading six pages is one
       person interested, not six, and a channel that sends deep readers would
       otherwise beat one that sends people who actually write to him.

  Run: npx tsx scripts/verify-analytics.ts
*/

import { clean, hostOf, resolveSource, taggedUrl } from "../lib/analytics/source";
import { summarise, type VisitRow } from "../components/admin/channels";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log("\n── naming the channel ──");
check(
  "an explicit tag beats the referrer",
  resolveSource({ utmSource: "application", referrer: "https://news.ycombinator.com/x" }) ===
    "application",
);
for (const [referrer, expected] of [
  ["https://news.ycombinator.com/item?id=1", "hacker-news"],
  ["https://www.linkedin.com/feed/", "linkedin"],
  ["https://lnkd.in/abc", "linkedin"],
  ["https://t.co/abc", "x"],
  ["https://www.google.co.in/search?q=x", "google"],
  ["https://old.reddit.com/r/x", "reddit"],
  ["https://someones-blog.dev/post", "someones-blog.dev"],
] as const) {
  check(`${referrer} → ${expected}`, resolveSource({ referrer }) === expected, resolveSource({ referrer }));
}
check("no referrer is 'direct', not empty", resolveSource({ referrer: "" }) === "direct");
/*
  Without this every internal link would look like traffic from the site's own
  domain, and it would sit at the top of the table burying every real source.
*/
check(
  "the site referring itself is not a channel",
  resolveSource({ referrer: "https://www.anhatsingh.com/blog", selfHost: "www.anhatsingh.com" }) ===
    "internal",
);

console.log("\n── labels group instead of splitting ──");
check("case doesn't split a channel", clean("LinkedIn") === clean("linkedin"));
check("spacing doesn't either", clean("hacker news") === "hacker-news");
check("a full referrer is never stored, only its host", hostOf("https://x.com/a/b?q=secret") === "x.com");

console.log("\n── tagged links ──");
{
  const url = taggedUrl("https://www.anhatsingh.com/", {
    source: "Application",
    medium: "email",
    campaign: "Razorpay",
  });
  check("source is normalised into the link", url.includes("utm_source=application"), url);
  check("campaign too", url.includes("utm_campaign=razorpay"));
}

console.log("\n── ranking channels ──");
{
  const row = (o: Partial<VisitRow>): VisitRow => ({
    visit_id: "v1",
    source: "direct",
    medium: null,
    campaign: null,
    path: "/",
    event: "view",
    created_at: "2026-01-01",
    ...o,
  });

  /*
    The case the whole table exists for: an aggregator sending three readers
    who never speak, against one cold email whose single reader opened the CV.
  */
  const summary = summarise([
    row({ visit_id: "a", source: "hacker-news" }),
    row({ visit_id: "a", source: "hacker-news", path: "/blog" }),
    row({ visit_id: "b", source: "hacker-news" }),
    row({ visit_id: "c", source: "hacker-news" }),
    row({ visit_id: "d", source: "outreach" }),
    row({ visit_id: "d", source: "outreach", event: "chat_message" }),
    row({ visit_id: "d", source: "outreach", event: "resume" }),
  ]);

  check(
    "the channel that produced something ranks first",
    summary[0].source === "outreach",
    summary.map((s) => s.source).join(" > "),
  );
  check("even though it sent fewer visitors", summary[0].visitors < summary[1].visitors);
  check(
    "a visitor reading two pages counts once",
    summary[1].visitors === 3 && summary[1].views === 4,
    `${summary[1].visitors} visitors / ${summary[1].views} views`,
  );
  check("the CV column is the strongest signal it has", summary[0].resumes === 1);

  // Internal navigation would otherwise top the table with the site's own name.
  const withInternal = summarise([row({ visit_id: "z", source: "internal" }), row({ visit_id: "y" })]);
  check("internal navigation is excluded", !withInternal.some((c) => c.source === "internal"));
}

console.log("\n── privacy ──");
{
  const schema = require("node:fs").readFileSync("lib/db/schema.sql", "utf8") as string;
  const table = schema.slice(schema.indexOf("create table if not exists visits"));
  const body = table.slice(0, table.indexOf(");"));
  /*
    Same rule as chat_questions. The one identifier is a random per-tab number
    that dies with the tab; anything durable would turn a decision aid into a
    tracking system and drag a personal site into needing a privacy policy.
  */
  for (const forbidden of ["ip", "user_agent", "fingerprint", "email"]) {
    check(`visits stores no ${forbidden}`, !new RegExp(`\\b${forbidden}\\b`).test(body));
  }
  check("only the referring host is stored", body.includes("referrer_host") && !/referrer_url/.test(body));
  check(
    "no anon policy, so RLS denies reads",
    !/on visits\s+for select/i.test(schema),
  );
}

console.log(failures === 0 ? "\nAll analytics checks passed.\n" : `\n${failures} analytics check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
