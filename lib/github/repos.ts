import { LANGUAGE_AFFILIATIONS } from "./queries";

/*
  The repository picker's data source.

  Admin-only: this lists PRIVATE and organisation repository names, which must
  never reach the public page. Only /admin/repos calls it, and that route is
  behind the auth guard.

  Not cached as aggressively as the public stats — an admin opening this screen
  wants to see a repo they created five minutes ago.
*/

const ENDPOINT = "https://api.github.com/graphql";

const REPO_LIST_QUERY = /* GraphQL */ `
  query RepoList {
    viewer {
      repositories(
        first: 100
        isFork: false
        ownerAffiliations: ${LANGUAGE_AFFILIATIONS}
        orderBy: { field: PUSHED_AT, direction: DESC }
      ) {
        totalCount
        nodes {
          nameWithOwner
          description
          isPrivate
          pushedAt
          primaryLanguage {
            name
            color
          }
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges {
              size
              node {
                name
              }
            }
          }
        }
      }
    }
  }
`;

export interface RepoSummary {
  nameWithOwner: string;
  description: string | null;
  isPrivate: boolean;
  pushedAt: string;
  primaryLanguage: string | null;
  primaryLanguageColor: string | null;
  /** Total language bytes — the weight this repo would carry in the chart. */
  bytes: number;
  topLanguages: string[];
}

export async function listRepositories(): Promise<RepoSummary[] | null> {
  const token = process.env.GH_STATS_PAT;
  if (!token) return null;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: REPO_LIST_QUERY }),
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      console.error(`[github/repos] HTTP ${res.status}`);
      return null;
    }

    const json = (await res.json()) as {
      data?: {
        viewer: {
          repositories: {
            nodes: Array<{
              nameWithOwner: string;
              description: string | null;
              isPrivate: boolean;
              pushedAt: string;
              primaryLanguage: { name: string; color: string } | null;
              languages: { edges: Array<{ size: number; node: { name: string } }> };
            }>;
          };
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      console.error("[github/repos]", json.errors.map((e) => e.message).join("; "));
      return null;
    }

    const nodes = json.data?.viewer.repositories.nodes ?? [];

    return nodes
      .map((r) => ({
        nameWithOwner: r.nameWithOwner,
        description: r.description,
        isPrivate: r.isPrivate,
        pushedAt: r.pushedAt,
        primaryLanguage: r.primaryLanguage?.name ?? null,
        primaryLanguageColor: r.primaryLanguage?.color ?? null,
        bytes: r.languages.edges.reduce((sum, e) => sum + e.size, 0),
        topLanguages: r.languages.edges.slice(0, 3).map((e) => e.node.name),
      }))
      // Biggest first: size is what distorts the chart, so the repos worth
      // deciding about are at the top.
      .sort((a, b) => b.bytes - a.bytes);
  } catch (err) {
    console.error("[github/repos] request failed:", err);
    return null;
  }
}
