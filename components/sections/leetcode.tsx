"use client";

import { Section } from "./section";
import { formatNumber } from "@/lib/format";
import type { LeetCodeStats } from "@/lib/leetcode/service";

/*
  LeetCode activity.

  Framed as "solved out of available" rather than a bare count, because the
  denominator is what makes a number mean something — 131 solved reads very
  differently with 4,000 problems as context than without it.

  Difficulty keeps its conventional LeetCode colour coding (green/amber/red)
  rather than the site accent. That mapping is near-universal among people who
  use the platform, and overriding it for brand consistency would cost more in
  recognition than it gains in tidiness.
*/

const DIFFICULTY_STYLE: Record<string, { text: string; bar: string }> = {
  Easy: { text: "text-success", bar: "bg-success" },
  Medium: { text: "text-[var(--warn)]", bar: "bg-[var(--warn)]" },
  Hard: { text: "text-danger", bar: "bg-danger" },
};

export function LeetCode({ stats }: { stats: LeetCodeStats | null }) {
  // No username set, unknown user, or LeetCode is unreachable — hide entirely
  // rather than render an empty shell.
  if (!stats || stats.totalSolved === 0) return null;

  return (
    <Section id="leetcode" eyebrow="04 — Problem solving" title="LeetCode">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div>
          <div className="flex items-baseline gap-2">
            <p className="font-display text-6xl text-accent">{stats.totalSolved}</p>
            <p className="font-mono text-sm text-muted">/ {formatNumber(stats.totalAvailable)}</p>
          </div>
          <p className="mt-1 font-mono text-xs uppercase tracking-widest text-muted">
            problems solved
          </p>

          <dl className="mt-6 space-y-2 font-mono text-xs">
            {stats.acceptanceRate !== null && (
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-muted">acceptance</dt>
                <dd className="tabular-nums">{stats.acceptanceRate.toFixed(1)}%</dd>
              </div>
            )}
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-muted">submissions</dt>
              <dd className="tabular-nums">{formatNumber(stats.totalSubmissions)}</dd>
            </div>
            {stats.ranking && (
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-muted">global rank</dt>
                <dd className="tabular-nums">{formatNumber(stats.ranking)}</dd>
              </div>
            )}
            {stats.activeYears.length > 0 && (
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-muted">active</dt>
                <dd className="tabular-nums">
                  {stats.activeYears[0]}
                  {stats.activeYears.length > 1 && `–${stats.activeYears.at(-1)}`}
                </dd>
              </div>
            )}
          </dl>

          <a
            href={stats.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-block font-mono text-xs uppercase tracking-widest text-accent hover:underline"
          >
            @{stats.username} →
          </a>
        </div>

        <div className="space-y-8">
          <div className="space-y-4">
            {stats.breakdown.map((d) => {
              const pct = d.available > 0 ? (d.solved / d.available) * 100 : 0;
              const style = DIFFICULTY_STYLE[d.difficulty];

              return (
                <div key={d.difficulty}>
                  <div className="flex items-baseline justify-between font-mono text-xs">
                    <span className={style.text}>{d.difficulty}</span>
                    <span className="tabular-nums text-muted">
                      {d.solved} / {formatNumber(d.available)}
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hairline"
                    role="img"
                    aria-label={`${d.difficulty}: ${d.solved} of ${d.available} solved`}
                  >
                    <div
                      className={`h-full rounded-full ${style.bar}`}
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {stats.languages.length > 0 && (
            <div>
              <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
                Languages used
              </h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {stats.languages.map((l) => (
                  <li
                    key={l.name}
                    className="rounded-[var(--radius)] border border-hairline px-2.5 py-1 font-mono text-xs"
                  >
                    {l.name}
                    <span className="ml-1.5 tabular-nums text-muted">{l.solved}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {stats.topTags.length > 0 && (
            <div>
              <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
                Strongest topics
              </h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {stats.topTags.map((t) => (
                  <li
                    key={t.name}
                    className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 font-mono text-xs text-accent"
                  >
                    {t.name}
                    <span className="ml-1.5 tabular-nums opacity-70">{t.solved}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
