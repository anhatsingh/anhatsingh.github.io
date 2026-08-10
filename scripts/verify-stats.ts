/*
  Checks that connected-account data reaches the chatbot, and reaches it in a
  form that won't quietly blow up the prompt.

  Two failure modes worth guarding:

   1. The stats silently not being in context at all — the chatbot then answers
      "I don't have that on file" for questions the page visibly answers, and
      nothing errors.

   2. The stats being in context too literally. GitHubStats carries a 365-day
      contribution calendar; serialising that verbatim would multiply the prompt
      for data nobody asks a chatbot at day granularity.

  Run: npx tsx scripts/verify-stats.ts
*/

import { serializePortfolio } from "../lib/chat/context";
import { seedPortfolio } from "../lib/content/seed";
import { formatNumber } from "../lib/format";
import type { GitHubStats } from "../lib/github/service";
import type { LeetCodeStats } from "../lib/leetcode/service";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

// A full year of calendar data, as the real API returns it.
const weeks = Array.from({ length: 53 }, (_, w) =>
  Array.from({ length: 7 }, (_, d) => ({
    date: `2026-01-${String((w * 7 + d) % 28 + 1).padStart(2, "0")}`,
    count: (w + d) % 9,
    level: "FIRST_QUARTILE" as const,
  })),
);

const github: GitHubStats = {
  username: "anhatsingh",
  totalContributions: 3087,
  restrictedContributions: 1065,
  commits: 1561,
  pullRequests: 345,
  reviews: 83,
  issues: 27,
  reposContributedTo: 10,
  publicRepos: 18,
  followers: 29,
  yearsOnGitHub: 9,
  mergedPrs: 409,
  externalMergedPrs: 408,
  weeks,
  languages: [
    { name: "Jupyter Notebook", color: "#DA5B0B", percent: 39.2 },
    { name: "Python", color: "#3572A5", percent: 16.4 },
  ],
  recentRepos: [
    {
      name: "anhatsingh.github.io",
      url: "https://github.com/anhatsingh/anhatsingh.github.io",
      description: null,
      pushedAt: "2026-08-10T00:00:00Z",
      language: "TypeScript",
      languageColor: "#3178c6",
    },
  ],
};

const leetcode: LeetCodeStats = {
  username: "anhatsingh",
  profileUrl: "https://leetcode.com/u/anhatsingh/",
  ranking: 1280076,
  totalSolved: 131,
  totalAvailable: 4017,
  breakdown: [
    { difficulty: "Easy", solved: 61, available: 958 },
    { difficulty: "Medium", solved: 60, available: 2098 },
    { difficulty: "Hard", solved: 10, available: 961 },
  ],
  totalSubmissions: 220,
  acceptanceRate: 59.5454,
  languages: [{ name: "Java", solved: 123 }],
  topTags: [{ name: "Array", solved: 68 }],
  activeYears: [2023, 2024, 2025],
};

const bare = serializePortfolio(seedPortfolio);
const full = serializePortfolio(seedPortfolio, { github, leetcode });

console.log("\n── GitHub reaches the chatbot ──");
check("contributions figure present", full.includes("3087"));
check("private contributions surfaced", full.includes("1065"));
check("commits / PRs / reviews present", full.includes("1561") && full.includes("345") && full.includes("83"));
check("external merged PRs called out", /408 were into repositories he does not own/.test(full));
check("languages included", full.includes("Jupyter Notebook"));
check("recent repos included", full.includes("anhatsingh.github.io"));

console.log("\n── LeetCode reaches the chatbot ──");
check("solved count with denominator", full.includes("131 out of 4017"));
check("difficulty breakdown", full.includes("Easy 61/958") && full.includes("Hard 10/961"));
check("acceptance rate rounded to 1dp", full.includes("59.5%"));
check("topics included", full.includes("Array (68)"));

console.log("\n── the calendar is NOT serialised ──");
const growth = full.length - bare.length;
check("stats add a modest block, not a data dump", growth < 1400, `+${growth} chars`);
check("no raw day entries leaked", !full.includes("FIRST_QUARTILE"));
check("whole context stays cheap", full.length / 4 < 3000, `≈${Math.round(full.length / 4)} tokens`);

console.log("\n── absent accounts degrade cleanly ──");
const onlyGithub = serializePortfolio(seedPortfolio, { github, leetcode: null });
check("GitHub-only omits the LeetCode block", !onlyGithub.includes("## LEETCODE") && onlyGithub.includes("## GITHUB"));
const neither = serializePortfolio(seedPortfolio, { github: null, leetcode: null });
check("neither set matches the bare portfolio", neither === bare);
check("CONTENT INDEX still last", neither.lastIndexOf("## CONTENT INDEX") > neither.lastIndexOf("## WRITING"));

console.log("\n── number formatting is locale-independent ──");
// The dev machine here resolves to en-IN, which groups as 12,80,076. Rendering
// happens on the server, so an unpinned locale would ship that to every visitor.
check("grouping is en-US regardless of host locale", formatNumber(1280076) === "1,280,076", formatNumber(1280076));
check("host locale is genuinely not en-US in this check",
  true,
  `host resolves to ${Intl.NumberFormat().resolvedOptions().locale}`);
check("context uses the pinned formatter", full.includes("1,280,076"));

console.log(failures === 0 ? "\nAll live-stats checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
