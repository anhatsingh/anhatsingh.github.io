/*
  LeetCode profile stats.

  IMPORTANT: https://leetcode.com/graphql is an UNOFFICIAL endpoint. It's what
  leetcode.com's own frontend calls, it needs no auth for public profiles, and
  it's what every LeetCode-stats widget on the internet uses — but there is no
  documented contract and no deprecation policy. It can change or start blocking
  without notice.

  So this is written to fail quietly: any error, any shape mismatch, and the
  whole section disappears rather than breaking the page. Cached for six hours,
  which is far more often than solve counts meaningfully change and keeps us
  well clear of any rate limiting.

  Must run server-side. LeetCode doesn't send CORS headers, so a browser fetch
  would be blocked.
*/

const ENDPOINT = "https://leetcode.com/graphql";
const REVALIDATE_SECONDS = 21_600; // 6 hours

const PROFILE_QUERY = /* GraphQL */ `
  query userProfile($username: String!) {
    allQuestionsCount {
      difficulty
      count
    }
    matchedUser(username: $username) {
      username
      profile {
        realName
        ranking
        userAvatar
        countryName
      }
      submitStatsGlobal {
        acSubmissionNum {
          difficulty
          count
          submissions
        }
      }
      languageProblemCount {
        languageName
        problemsSolved
      }
      tagProblemCounts {
        advanced {
          tagName
          problemsSolved
        }
        intermediate {
          tagName
          problemsSolved
        }
        fundamental {
          tagName
          problemsSolved
        }
      }
      userCalendar {
        activeYears
      }
    }
  }
`;

export type Difficulty = "Easy" | "Medium" | "Hard";

export interface LeetCodeStats {
  username: string;
  profileUrl: string;
  /** Global rank. Lower is better; LeetCode reports this in the millions. */
  ranking: number | null;
  totalSolved: number;
  totalAvailable: number;
  /** Per-difficulty solved vs. how many exist, for progress bars. */
  breakdown: Array<{ difficulty: Difficulty; solved: number; available: number }>;
  totalSubmissions: number;
  /** Accepted / total submissions, as a percentage. */
  acceptanceRate: number | null;
  languages: Array<{ name: string; solved: number }>;
  topTags: Array<{ name: string; solved: number }>;
  activeYears: number[];
}

interface RawResponse {
  data?: {
    allQuestionsCount?: Array<{ difficulty: string; count: number }>;
    matchedUser?: {
      username: string;
      profile: { realName: string | null; ranking: number | null; countryName: string | null };
      submitStatsGlobal: {
        acSubmissionNum: Array<{ difficulty: string; count: number; submissions: number }>;
      };
      languageProblemCount: Array<{ languageName: string; problemsSolved: number }>;
      tagProblemCounts: {
        advanced: Array<{ tagName: string; problemsSolved: number }>;
        intermediate: Array<{ tagName: string; problemsSolved: number }>;
        fundamental: Array<{ tagName: string; problemsSolved: number }>;
      } | null;
      userCalendar: { activeYears: number[] | null } | null;
    } | null;
  };
  errors?: Array<{ message: string }>;
}

export async function getLeetCodeStats(username: string): Promise<LeetCodeStats | null> {
  if (!username?.trim()) return null;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // LeetCode rejects requests without a plausible Referer/User-Agent.
        Referer: "https://leetcode.com",
        "User-Agent": "Mozilla/5.0 (compatible; portfolio-site)",
      },
      body: JSON.stringify({ query: PROFILE_QUERY, variables: { username: username.trim() } }),
      next: { revalidate: REVALIDATE_SECONDS },
    });

    if (!res.ok) {
      console.error(`[leetcode] HTTP ${res.status}`);
      return null;
    }

    const json = (await res.json()) as RawResponse;
    if (json.errors?.length) {
      console.error("[leetcode]", json.errors.map((e) => e.message).join("; "));
      return null;
    }

    const user = json.data?.matchedUser;
    // A username that doesn't exist returns matchedUser: null with no error.
    if (!user) return null;

    const totals = new Map(
      (json.data?.allQuestionsCount ?? []).map((q) => [q.difficulty, q.count]),
    );
    const solved = new Map(
      user.submitStatsGlobal.acSubmissionNum.map((s) => [s.difficulty, s]),
    );

    const all = solved.get("All");
    const totalSolved = all?.count ?? 0;
    const totalSubmissions = all?.submissions ?? 0;

    const breakdown = (["Easy", "Medium", "Hard"] as const).map((difficulty) => ({
      difficulty,
      solved: solved.get(difficulty)?.count ?? 0,
      available: totals.get(difficulty) ?? 0,
    }));

    const tags = user.tagProblemCounts;
    const topTags = [
      ...(tags?.advanced ?? []),
      ...(tags?.intermediate ?? []),
      ...(tags?.fundamental ?? []),
    ]
      .filter((t) => t.problemsSolved > 0)
      .sort((a, b) => b.problemsSolved - a.problemsSolved)
      .slice(0, 8)
      .map((t) => ({ name: t.tagName, solved: t.problemsSolved }));

    return {
      username: user.username,
      profileUrl: `https://leetcode.com/u/${user.username}/`,
      ranking: user.profile.ranking || null,
      totalSolved,
      totalAvailable: totals.get("All") ?? 0,
      breakdown,
      totalSubmissions,
      acceptanceRate: totalSubmissions > 0 ? (totalSolved / totalSubmissions) * 100 : null,
      languages: user.languageProblemCount
        .filter((l) => l.problemsSolved > 0)
        .sort((a, b) => b.problemsSolved - a.problemsSolved)
        .map((l) => ({ name: l.languageName, solved: l.problemsSolved })),
      topTags,
      activeYears: (user.userCalendar?.activeYears ?? []).slice().sort(),
    };
  } catch (err) {
    console.error("[leetcode] request failed:", err);
    return null;
  }
}
