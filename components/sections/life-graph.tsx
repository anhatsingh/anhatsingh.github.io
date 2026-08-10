"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { buildGraph, itemRange, type GraphItem, type LaneKey } from "@/lib/content/graph";
import type { Portfolio } from "@/lib/content/types";

/*
  A git-network diagram of everything dated: education, jobs, projects,
  certificates and recommendations, each on its own coloured branch.

  One dot is one month, always. That fixed scale is the reason it's worth
  drawing at all — a four-year degree is four times the length of a one-year
  job on screen, and overlaps between a job and a side project are visible
  rather than asserted.

  Twenty-two years of that is 260-odd dots, so the track snakes: left to right,
  drop a band, right to left. Reversing alternate rows instead of restarting on
  the left keeps the line continuous, so time never appears to jump backwards
  mid-graph.

  Geometry lives in lib/content/graph.ts and is tested there. This file is only
  concerned with turning that plan into SVG.
*/

const COL = 13; // px per month
const LANE_H = 15; // px between branches
const ROW_PAD = 26; // px below each band, for the year label and breathing room
const LEFT = 34; // px reserved for year labels

function laneColor(lane: LaneKey): string {
  return `var(--graph-${lane})`;
}

export function LifeGraph({
  portfolio,
  now,
  monthsPerRow = 36,
}: {
  portfolio: Portfolio;
  /*
    The current month, supplied by the server rather than read from the clock
    here. Calling new Date() during a client render would disagree with the
    server's value across a month boundary or a timezone, and the mismatch
    would surface as a hydration error in the middle of the SVG.
  */
  now: number;
  monthsPerRow?: number;
}) {
  const [active, setActive] = useState<GraphItem | null>(null);

  const graph = useMemo(
    () => buildGraph(portfolio, { monthsPerRow, now }),
    [portfolio, monthsPerRow, now],
  );

  if (!graph.items.length) return null;

  const laneCount = graph.lanes.length;
  const bandH = laneCount * LANE_H + ROW_PAD;
  const width = LEFT + monthsPerRow * COL + 8;
  const height = graph.rows * bandH + 12;

  const byId = new Map(graph.items.map((i) => [i.id, i]));
  const laneIndex = new Map(graph.lanes.map((l, i) => [l.key, i]));

  const x = (col: number) => LEFT + col * COL + COL / 2;
  const y = (row: number, lane: LaneKey) => row * bandH + (laneIndex.get(lane) ?? 0) * LANE_H + 14;

  return (
    <div className="mt-14">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-display text-xl">The whole thing, on one track</h3>
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted">
          one dot = one month
        </p>
      </div>

      {/* Legend doubles as the accessible key to the colours, so nothing is
          carried by hue alone. */}
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
        {graph.lanes.map((lane) => (
          <li key={lane.key} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: laneColor(lane.key) }}
              aria-hidden="true"
            />
            <span className="font-mono text-[11px] uppercase tracking-widest text-muted">
              {lane.label}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-5 overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          className="max-w-full"
          role="img"
          aria-label={`Timeline of ${graph.items.length} dated entries from ${graph.rowYears[0]?.label} to now, one dot per month.`}
        >
          {/* Trunk: the month grid every branch is measured against. */}
          {graph.rowYears.map(({ row, label }) => (
            <g key={`row-${row}`}>
              <text
                x={LEFT - 8}
                y={row * bandH + 16}
                textAnchor="end"
                className="fill-[var(--muted)] font-mono"
                style={{ fontSize: 10 }}
              >
                {label}
              </text>
              <line
                x1={x(0)}
                y1={row * bandH + bandH - ROW_PAD + 6}
                x2={x(monthsPerRow - 1)}
                y2={row * bandH + bandH - ROW_PAD + 6}
                stroke="var(--graph-trunk)"
                strokeWidth={1}
              />
              {Array.from({ length: monthsPerRow }, (_, c) => (
                <circle
                  key={c}
                  cx={x(c)}
                  cy={row * bandH + bandH - ROW_PAD + 6}
                  r={c % 12 === 0 ? 1.7 : 0.9}
                  fill="var(--graph-trunk)"
                />
              ))}
            </g>
          ))}

          {/* Branches. Drawn after the trunk so they sit above it. */}
          {graph.segments.map((seg, i) => {
            const item = byId.get(seg.itemId);
            if (!item) return null;

            const cy = y(seg.row, seg.lane);
            const x1 = x(seg.fromCol);
            const x2 = x(seg.toCol);
            const isActive = active?.id === item.id;
            const color = laneColor(seg.lane);

            const body = (
              <g
                onMouseEnter={() => setActive(item)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(item)}
                onBlur={() => setActive(null)}
                style={{ cursor: item.href ? "pointer" : "default" }}
              >
                {/* A fat transparent hit area — a 3px line is far too thin to
                    point at reliably. */}
                <line
                  x1={x1 - 4}
                  y1={cy}
                  x2={x2 + 4}
                  y2={cy}
                  stroke="transparent"
                  strokeWidth={LANE_H}
                  strokeLinecap="round"
                />
                <line
                  x1={x1}
                  y1={cy}
                  x2={x2}
                  y2={cy}
                  stroke={color}
                  strokeWidth={isActive ? 5 : 3}
                  strokeLinecap="round"
                  opacity={active && !isActive ? 0.3 : 1}
                  style={{ transition: "stroke-width 120ms, opacity 120ms" }}
                />
                {/* The node marking where a thing began. */}
                {seg.isStart && (
                  <circle
                    cx={seg.reversed ? x2 : x1}
                    cy={cy}
                    r={isActive ? 4.5 : 3.5}
                    fill={item.isPoint ? color : "var(--bg)"}
                    stroke={color}
                    strokeWidth={2}
                    opacity={active && !isActive ? 0.3 : 1}
                    style={{ transition: "r 120ms, opacity 120ms" }}
                  />
                )}
              </g>
            );

            return item.href ? (
              <Link key={`${seg.itemId}-${i}`} href={item.href} aria-label={item.label}>
                {body}
              </Link>
            ) : (
              <g key={`${seg.itemId}-${i}`} tabIndex={0} aria-label={item.label}>
                {body}
              </g>
            );
          })}
        </svg>
      </div>

      {/*
        One caption below the graph rather than a floating tooltip: a tooltip
        near the pointer covers the neighbouring branches, which are exactly
        what you're comparing against. Fixed height so hovering doesn't shift
        the page.
      */}
      <div className="mt-3 flex min-h-[2.75rem] items-start gap-3 rounded-[var(--radius)] border border-hairline bg-surface px-4 py-2.5">
        {active ? (
          <>
            <span
              className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: laneColor(active.lane) }}
              aria-hidden="true"
            />
            <span className="min-w-0">
              <span className="block text-sm">
                {active.label}
                {active.detail && <span className="text-muted"> · {active.detail}</span>}
              </span>
              <span className="block font-mono text-[11px] text-muted">
                {itemRange(active, now)}
              </span>
            </span>
          </>
        ) : (
          <span className="self-center font-mono text-[11px] uppercase tracking-widest text-muted">
            Hover a branch
          </span>
        )}
      </div>
    </div>
  );
}
