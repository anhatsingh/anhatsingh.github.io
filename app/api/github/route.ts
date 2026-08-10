import { getPortfolio } from "@/lib/content";
import { getGitHubStats } from "@/lib/github/service";

/*
  The page renders GitHub stats server-side, so this route isn't on the critical
  path. It exists so the data shape can be inspected directly — useful for
  verifying the cache is working and that the calendar query is costing the
  expected single rate-limit point.
*/
export async function GET() {
  const { profile } = await getPortfolio();
  const username = profile.githubUsername;

  if (!username) {
    return Response.json({ error: "No GitHub username configured." }, { status: 404 });
  }

  const stats = await getGitHubStats(username, profile.selectedRepos);
  if (!stats) {
    return Response.json(
      { error: "GitHub stats unavailable. Is GH_STATS_PAT set?" },
      { status: 503 },
    );
  }

  return Response.json(stats);
}
