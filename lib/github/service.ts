import { CONTRIBUTIONS_QUERY, MERGED_PRS_QUERY } from "./queries";

/*
  Fetches and normalises GitHub activity.

  Caching happens at the fetch layer (next.revalidate) rather than via a route
  segment config, so both the server component and the debug route share one
  cached upstream response. At one refresh an hour this uses ~24 of 5,000
  hourly points.

  Everything here degrades to null rather than throwing: a missing token or a
  GitHub outage should hide the section, not break the page.
*/

const ENDPOINT = "https://api.github.com/graphql";
const REVALIDATE_SECONDS = 3600;

export type ContributionLevel =
  | "NONE"
  | "FIRST_QUARTILE"
  | "SECOND_QUARTILE"
  | "THIRD_QUARTILE"
  | "FOURTH_QUARTILE";

export interface ContributionDay {
  date: string;
  count: number;
  level: ContributionLevel;
}

export interface GitHubStats {
  username: string;
  totalContributions: number;
  restrictedContributions: number;
  commits: number;
  pullRequests: number;
  reviews: number;
  issues: number;
  reposContributedTo: number;
  publicRepos: number;
  followers: number;
  yearsOnGitHub: number;
  mergedPrs: number;
  externalMergedPrs: number;
  weeks: ContributionDay[][];
  languages: Array<{ name: string; color: string; percent: number }>;
  recentRepos: Array<{
    name: string;
    url: string;
    description: string | null;
    pushedAt: string;
    language: string | null;
    languageColor: string | null;
  }>;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
  const token = process.env.GH_STATS_PAT;
  if (!token) return null;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      next: { revalidate: REVALIDATE_SECONDS },
    });

    if (!res.ok) {
      console.error(`[github] HTTP ${res.status}`);
      return null;
    }

    const json = (await res.json()) as GraphQLResponse<T>;
    if (json.errors?.length) {
      console.error("[github] GraphQL errors:", json.errors.map((e) => e.message).join("; "));
      return null;
    }
    return json.data ?? null;
  } catch (err) {
    console.error("[github] request failed:", err);
    return null;
  }
}

interface ContributionsData {
  user: {
    createdAt: string;
    followers: { totalCount: number };
    contributionsCollection: {
      restrictedContributionsCount: number;
      totalCommitContributions: number;
      totalIssueContributions: number;
      totalPullRequestContributions: number;
      totalPullRequestReviewContributions: number;
      totalRepositoriesWithContributedCommits: number;
      contributionYears: number[];
      contributionCalendar: {
        totalContributions: number;
        weeks: Array<{
          firstDay: string;
          contributionDays: Array<{
            date: string;
            weekday: number;
            contributionCount: number;
            contributionLevel: ContributionLevel;
          }>;
        }>;
      };
    };
    repositories: {
      totalCount: number;
      nodes: Array<{
        name: string;
        url: string;
        description: string | null;
        pushedAt: string;
        primaryLanguage: { name: string; color: string } | null;
        languages: { edges: Array<{ size: number; node: { name: string; color: string } }> };
      }>;
    };
  } | null;
}

export async function getGitHubStats(username: string): Promise<GitHubStats | null> {
  if (!username) return null;

  // Trailing 12 months. The API rejects a range longer than one year.
  const to = new Date();
  const from = new Date(to);
  from.setFullYear(from.getFullYear() - 1);

  const [contrib, prs] = await Promise.all([
    gql<ContributionsData>(CONTRIBUTIONS_QUERY, {
      login: username,
      from: from.toISOString(),
      to: to.toISOString(),
    }),
    gql<{ all: { issueCount: number }; external: { issueCount: number } }>(MERGED_PRS_QUERY, {
      all: `author:${username} type:pr is:merged`,
      external: `author:${username} type:pr is:merged -user:${username}`,
    }),
  ]);

  const user = contrib?.user;
  if (!user) return null;

  const cc = user.contributionsCollection;

  // Sum language bytes across non-fork repos. Forks are excluded in the query
  // itself — counting them makes the chart a lie about what you actually wrote.
  const byLanguage = new Map<string, { size: number; color: string }>();
  for (const repo of user.repositories.nodes) {
    for (const edge of repo.languages.edges) {
      const prev = byLanguage.get(edge.node.name);
      byLanguage.set(edge.node.name, {
        size: (prev?.size ?? 0) + edge.size,
        color: edge.node.color ?? "#888",
      });
    }
  }
  const totalBytes = [...byLanguage.values()].reduce((sum, l) => sum + l.size, 0);
  const languages = [...byLanguage.entries()]
    .map(([name, { size, color }]) => ({
      name,
      color,
      percent: totalBytes ? (size / totalBytes) * 100 : 0,
    }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 8);

  return {
    username,
    totalContributions: cc.contributionCalendar.totalContributions,
    restrictedContributions: cc.restrictedContributionsCount,
    commits: cc.totalCommitContributions,
    pullRequests: cc.totalPullRequestContributions,
    reviews: cc.totalPullRequestReviewContributions,
    issues: cc.totalIssueContributions,
    reposContributedTo: cc.totalRepositoriesWithContributedCommits,
    publicRepos: user.repositories.totalCount,
    followers: user.followers.totalCount,
    yearsOnGitHub: Math.max(
      1,
      new Date().getFullYear() - new Date(user.createdAt).getFullYear(),
    ),
    mergedPrs: prs?.all.issueCount ?? 0,
    externalMergedPrs: prs?.external.issueCount ?? 0,
    weeks: cc.contributionCalendar.weeks.map((w) =>
      w.contributionDays.map((d) => ({
        date: d.date,
        count: d.contributionCount,
        level: d.contributionLevel,
      })),
    ),
    languages,
    recentRepos: user.repositories.nodes.slice(0, 5).map((r) => ({
      name: r.name,
      url: r.url,
      description: r.description,
      pushedAt: r.pushedAt,
      language: r.primaryLanguage?.name ?? null,
      languageColor: r.primaryLanguage?.color ?? null,
    })),
  };
}
