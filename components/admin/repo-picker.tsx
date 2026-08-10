"use client";

import { useMemo, useState, useTransition } from "react";
import { saveSelectedRepos } from "@/app/admin/actions";
import type { RepoSummary } from "@/lib/github/repos";
import { formatNumber } from "@/lib/format";

/*
  Picks which repositories feed the GitHub language chart.

  Sorted biggest-first, because size is what distorts the chart and those are
  the repos actually worth a decision. Each row shows its share of the current
  selection, so it's obvious which one is responsible when a language looks
  wrong.

  Selecting nothing is a valid state, not an error — it falls back to the
  "recently active" default rather than showing an empty chart.
*/

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 31) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function RepoPicker({
  repos,
  initialSelection,
}: {
  repos: RepoSummary[];
  initialSelection: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelection));
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState("");
  const [filter, setFilter] = useState("");

  // Language mix of the current selection, recomputed live so the effect of a
  // checkbox is visible before saving.
  const preview = useMemo(() => {
    const chosen = repos.filter((r) => selected.has(r.nameWithOwner));
    const total = chosen.reduce((sum, r) => sum + r.bytes, 0);
    if (!total) return { total: 0, languages: [] as Array<{ name: string; percent: number }> };

    const byLanguage = new Map<string, number>();
    for (const repo of chosen) {
      // topLanguages is only the names; approximate each repo's weight by its
      // primary language. Exact per-language bytes live server-side — this is a
      // preview, not the published number.
      if (repo.primaryLanguage) {
        byLanguage.set(repo.primaryLanguage, (byLanguage.get(repo.primaryLanguage) ?? 0) + repo.bytes);
      }
    }
    return {
      total,
      languages: [...byLanguage.entries()]
        .map(([name, bytes]) => ({ name, percent: (bytes / total) * 100 }))
        .sort((a, b) => b.percent - a.percent)
        .slice(0, 6),
    };
  }, [repos, selected]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? repos.filter((r) => r.nameWithOwner.toLowerCase().includes(q)) : repos;
  }, [repos, filter]);

  function toggle(name: string) {
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function save() {
    setProblem("");
    startTransition(async () => {
      const result = await saveSelectedRepos([...selected]);
      if (!result.ok) setProblem(result.error);
      else setSaved(true);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[var(--radius)] border border-hairline bg-surface p-4 text-sm">
        <p className="text-muted">
          Choose which repositories count toward <strong className="text-text">Languages by volume</strong>{" "}
          on the site. Nothing else on the page changes — contributions, PRs and the public repo
          list are unaffected.
        </p>
        <p className="mt-2 text-xs text-muted">
          GitHub reports language bytes per repository, not per author, so a large repo you barely
          touched still counts fully. Leave everything unselected to fall back to
          &ldquo;pushed in the last 4 years&rdquo;.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter repos…"
          className="min-w-0 flex-1 rounded-[var(--radius)] border border-hairline bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
        <button
          type="button"
          onClick={() => {
            setSelected(new Set(visible.map((r) => r.nameWithOwner)));
            setSaved(false);
          }}
          className="font-mono text-xs uppercase tracking-widest text-muted hover:text-accent"
        >
          select shown
        </button>
        <button
          type="button"
          onClick={() => {
            setSelected(new Set());
            setSaved(false);
          }}
          className="font-mono text-xs uppercase tracking-widest text-muted hover:text-accent"
        >
          clear
        </button>
      </div>

      {selected.size > 0 && preview.languages.length > 0 && (
        <div className="rounded-[var(--radius)] border border-accent/30 bg-accent/5 p-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-accent">
            Preview · {selected.size} repos · {formatNumber(Math.round(preview.total / 1024))} KB
          </p>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-hairline">
            {preview.languages.map((l) => (
              <span
                key={l.name}
                style={{ width: `${l.percent}%` }}
                className="bg-accent/70 [&:nth-child(even)]:bg-accent/40"
                title={`${l.name} ${l.percent.toFixed(0)}%`}
              />
            ))}
          </div>
          <p className="mt-2 font-mono text-xs text-muted">
            {preview.languages.map((l) => `${l.name} ${l.percent.toFixed(0)}%`).join(" · ")}
          </p>
          <p className="mt-1 text-xs text-muted">
            Approximate — grouped by each repo&apos;s primary language. The published chart uses
            exact per-language bytes.
          </p>
        </div>
      )}

      <ul className="divide-y divide-hairline overflow-hidden rounded-[var(--radius)] border border-hairline">
        {visible.map((repo) => {
          const isOn = selected.has(repo.nameWithOwner);
          return (
            <li key={repo.nameWithOwner}>
              <label
                className={`flex cursor-pointer items-start gap-3 p-3 transition-colors ${
                  isOn ? "bg-accent/5" : "hover:bg-elevated"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={() => toggle(repo.nameWithOwner)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-sm">{repo.nameWithOwner}</span>
                    {repo.isPrivate && (
                      <span className="rounded-full border border-hairline px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted">
                        private
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-muted">
                    <span className="tabular-nums">{formatNumber(Math.round(repo.bytes / 1024))} KB</span>
                    <span>{timeAgo(repo.pushedAt)}</span>
                    {repo.topLanguages.length > 0 && <span>{repo.topLanguages.join(" · ")}</span>}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="p-4 text-sm text-muted">No repositories match that filter.</li>
        )}
      </ul>

      {problem && <p className="text-sm text-danger">{problem}</p>}
      {saved && <p className="text-sm text-success">Saved. The site updates within the hour.</p>}

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-[var(--radius)] bg-accent px-4 py-2 font-mono text-xs uppercase tracking-widest text-accent-ink disabled:opacity-50"
        >
          {pending ? "Saving…" : `Save ${selected.size} selected`}
        </button>
        <span className="font-mono text-xs text-muted">
          {selected.size === 0 ? "falling back to last 4 years" : `${repos.length - selected.size} excluded`}
        </span>
      </div>
    </div>
  );
}
