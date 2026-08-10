"use client";

import { Section } from "./section";
import { formatNumber } from "@/lib/format";
import type { ContributionLevel, GitHubStats } from "@/lib/github/service";

/*
  GitHub activity, framed around velocity rather than popularity.

  Deliberately no star counts anywhere: for someone with few stars they'd
  undersell real work. Contributions, merged PRs — especially into other
  people's repos — and recency are the honest signals.

  The heatmap is themed with the site accent instead of GitHub's green so it
  reads as part of the page rather than an embedded widget.
*/

const LEVEL_CLASS: Record<ContributionLevel, string> = {
  NONE: "bg-hairline",
  FIRST_QUARTILE: "bg-accent/25",
  SECOND_QUARTILE: "bg-accent/50",
  THIRD_QUARTILE: "bg-accent/75",
  FOURTH_QUARTILE: "bg-accent",
};

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <p className="font-display text-3xl">{value}</p>
      <p className="mt-0.5 font-mono text-[11px] uppercase tracking-widest text-muted">{label}</p>
    </div>
  );
}

export function GitHub({ stats }: { stats: GitHubStats | null }) {
  // No token configured, or GitHub is down — hide rather than render an empty shell.
  if (!stats) return null;

  return (
    <Section id="github" eyebrow="03 — Activity" title="What I've been shipping">
      <div className="flex flex-wrap items-baseline gap-3">
        <p className="font-display text-6xl text-accent">
          {formatNumber(stats.totalContributions)}
        </p>
        <p className="font-mono text-xs uppercase tracking-widest text-muted">
          contributions in the last year
          {stats.restrictedContributions > 0 && (
            <span className="text-accent"> · +{stats.restrictedContributions} private</span>
          )}
        </p>
      </div>

      {/* Horizontal scroll on small screens keeps the page from overflowing. */}
      <div className="mt-8 overflow-x-auto pb-2">
        <div
          className="flex gap-[3px]"
          role="img"
          aria-label={`Contribution heatmap: ${stats.totalContributions} contributions over the past year`}
        >
          {stats.weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {week.map((day) => (
                <span
                  key={day.date}
                  title={`${day.count} on ${day.date}`}
                  className={`h-[11px] w-[11px] rounded-[2px] ${LEVEL_CLASS[day.level]}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
        <Stat value={formatNumber(stats.commits)} label="commits" />
        <Stat value={stats.mergedPrs} label="PRs merged" />
        <Stat value={stats.externalMergedPrs} label="into others' repos" />
        <Stat value={stats.reviews} label="reviews" />
        <Stat value={stats.reposContributedTo} label="repos touched" />
        <Stat value={`${stats.yearsOnGitHub}y`} label="on GitHub" />
      </div>

      {stats.languages.length > 0 && (
        <div className="mt-12">
          <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
            Languages by volume
            {stats.languageRepoCount > 0 && (
              // Says what the chart is actually measuring. Without this the
              // percentages look like they describe the public repos listed
              // below, which they don't.
              <span className="ml-2 normal-case tracking-normal text-muted/70">
                {stats.languagesCurated
                  ? `${stats.languageRepoCount} selected repos`
                  : `${stats.languageRepoCount} repos from the last ${stats.languageWindowYears} years`}
                {stats.privateRepoCount > 0 && `, incl. ${stats.privateRepoCount} private`}
              </span>
            )}
          </h3>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full">
            {stats.languages.map((l) => (
              <span
                key={l.name}
                style={{ width: `${l.percent}%`, backgroundColor: l.color }}
                title={`${l.name} ${l.percent.toFixed(1)}%`}
              />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {stats.languages.map((l) => (
              <li key={l.name} className="flex items-center gap-1.5 font-mono text-xs text-muted">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: l.color }}
                  aria-hidden="true"
                />
                {l.name} {l.percent.toFixed(1)}%
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats.recentRepos.length > 0 && (
        <div className="mt-12">
          <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
            Most recently pushed
          </h3>
          <ul className="mt-3 divide-y divide-hairline border-y border-hairline">
            {stats.recentRepos.map((r) => (
              <li key={r.name}>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-baseline justify-between gap-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="font-mono text-sm text-text group-hover:text-accent">
                      {r.name}
                    </span>
                    {r.description && (
                      <span className="ml-2 text-sm text-muted">{r.description}</span>
                    )}
                  </span>
                  {r.language && (
                    <span className="shrink-0 font-mono text-[11px] text-muted">{r.language}</span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
