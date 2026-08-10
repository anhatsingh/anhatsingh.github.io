import { RepoPicker } from "@/components/admin/repo-picker";
import { getPortfolio } from "@/lib/content";
import { listRepositories } from "@/lib/github/repos";

export const dynamic = "force-dynamic";

/*
  Behind the admin auth guard, and it must stay there: listRepositories()
  returns PRIVATE and organisation repository names.
*/
export default async function ReposPage() {
  const [{ profile }, repos] = await Promise.all([getPortfolio(), listRepositories()]);

  return (
    <div>
      <h2 className="font-display text-3xl">GitHub repositories</h2>

      {!repos ? (
        <p className="mt-4 text-sm text-danger">
          Couldn&apos;t reach GitHub. Check <code>GH_STATS_PAT</code> is set and still valid.
        </p>
      ) : repos.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No repositories visible to this token.</p>
      ) : (
        <div className="mt-6">
          <RepoPicker repos={repos} initialSelection={profile.selectedRepos ?? []} />
        </div>
      )}
    </div>
  );
}
