"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  buildGraph,
  itemRange,
  KIND_DASH,
  KIND_LABELS,
  type GraphItem,
  type ItemKind,
} from "@/lib/content/graph";
import type { Portfolio } from "@/lib/content/types";

/*
  A git network diagram of everything dated, on one continuous track that
  scrolls sideways.

  One dot is one month, always. That fixed scale is the reason it's worth
  drawing: a four-year degree is four times the length of a one-year job, and
  two things that ran at once are visibly concurrent rather than merely listed
  near each other.

  Nothing is labelled on the track itself. Names printed beside each bar had to
  be truncated to fit, still collided where entries were close, and turned a
  chart you read shapes from into a list you read words from. The caption below
  names whatever is hovered instead.

  Bars never share a row. Overlapping entries fork onto their own branches —
  though only the bars count, so ends that merely touch are left to sit close
  rather than costing a row. Every entry gets its own colour — see lib/content/graph.ts, which does the
  packing and hands back a row and a hue for each.

  Colour identifies the entry, so the category is carried by line style
  instead: solid for a job, dashed for study, dotted for a project. A span
  terminates in a second node where its end is actually known; an ongoing role
  simply runs on, since its end month is today's date rather than a fact.

  Sections are stacked bands, Gantt-style, with their names in a gutter that
  doesn't scroll — otherwise you scroll out to 2024 and can no longer tell
  which band you're looking at.

  Not gitgraph.js: that library lays commits out in sequence with no time axis,
  so a fixed month scale is the one thing it can't express. It is also
  unmaintained — last published 2022, and the `gitgraph.js` package is flagged
  deprecated on npm.
*/

const COL = 14; // px per month
const LANE_H = 26; // px between branches
const TOP = 16; // px above the first branch
const AXIS_H = 28; // px below the last branch, for the year axis
function colorFor(item: GraphItem): string {
  // Saturation and lightness are theme tokens; only the hue varies per entry.
  return `hsl(${item.hue.toFixed(1)} var(--graph-sat) var(--graph-lum))`;
}

export function LifeGraph({ portfolio, now }: { portfolio: Portfolio; now: number }) {
  const [active, setActive] = useState<GraphItem | null>(null);

  const graph = useMemo(() => buildGraph(portfolio, { now }), [portfolio, now]);

  if (!graph.items.length) return null;

  const plotH = TOP + graph.lanes * LANE_H;
  const height = plotH + AXIS_H;
  const width = graph.totalMonths * COL;

  const x = (col: number) => col * COL + COL / 2;
  const y = (lane: number) => TOP + lane * LANE_H;

  return (
    <div className="mt-14">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-display text-xl">The whole thing, on one track</h3>
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted">
          one dot = one month · hover a branch · scroll →
        </p>
      </div>

      {/* Line style is the only thing shared between entries, so it's the only
          thing a key can usefully explain. */}
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
        {(["experience", "education", "projects"] as ItemKind[]).map((kind) => (
          <li key={kind} className="flex items-center gap-2">
            <svg width="26" height="8" aria-hidden="true">
              <line
                x1={1}
                y1={4}
                x2={25}
                y2={4}
                stroke="var(--muted)"
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray={KIND_DASH[kind] || undefined}
              />
            </svg>
            <span className="font-mono text-[11px] uppercase tracking-widest text-muted">
              {KIND_LABELS[kind]}
            </span>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <svg width="26" height="8" aria-hidden="true">
            <circle cx={13} cy={4} r={3.5} fill="var(--muted)" />
          </svg>
          <span className="font-mono text-[11px] uppercase tracking-widest text-muted">
            Certificate / recommendation
          </span>
        </li>
      </ul>

      <div className="mt-4 flex rounded-[var(--radius)] border border-hairline bg-surface">
        {/*
          Section gutter. Outside the scroll container so it stays put, and
          sized from the same constants as the SVG so a name always sits
          against its own band.
        */}
        <div className="shrink-0 border-r border-hairline py-3 pl-4 pr-3" aria-hidden="true">
          <div style={{ height: TOP - LANE_H / 2 }} />
          {graph.groups.map((group) => (
            <div
              key={group.kind}
              className="flex items-center"
              style={{ height: group.lanes * LANE_H }}
            >
              <span className="whitespace-nowrap font-mono text-[10px] uppercase tracking-widest text-muted">
                {group.label}
              </span>
            </div>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto p-3">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Timeline of ${graph.items.length} dated entries from ${graph.yearTicks[0]?.label} to now, one dot per month, ${graph.lanes} parallel branches at the busiest point.`}
          style={{ display: "block" }}
        >
          {/*
            Alternating band tints, so a section reads as one block even where
            its rows are sparse. Drawn first, behind everything.
          */}
          {graph.groups.map((group, i) =>
            i % 2 === 1 ? (
              <rect
                key={group.kind}
                x={0}
                y={TOP + group.firstLane * LANE_H - LANE_H / 2}
                width={width}
                height={group.lanes * LANE_H}
                fill="var(--graph-trunk)"
                opacity={0.28}
              />
            ) : null,
          )}

          {/* Year gridlines, with the axis along the bottom. */}
          {graph.yearTicks.map(({ col, label }) => (
            <g key={label}>
              <line
                x1={x(col) - COL / 2}
                y1={2}
                x2={x(col) - COL / 2}
                y2={plotH}
                stroke="var(--graph-trunk)"
                strokeWidth={1}
              />
              <text
                x={x(col) - COL / 2 + 4}
                y={plotH + 16}
                className="fill-[var(--muted)] font-mono"
                style={{ fontSize: 10 }}
              >
                {label}
              </text>
            </g>
          ))}

          {/* The month ruler every branch is measured against. */}
          {Array.from({ length: graph.totalMonths }, (_, c) => (
            <circle key={c} cx={x(c)} cy={plotH - 3} r={0.9} fill="var(--graph-trunk)" />
          ))}

          {graph.items.map((item) => {
            const cy = y(item.lane);
            const x1 = x(item.startCol);
            const x2 = x(item.endCol);
            const isActive = active?.id === item.id;
            const dim = active && !isActive ? 0.22 : 1;
            const color = colorFor(item);

            const body = (
              <g
                onMouseEnter={() => setActive(item)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(item)}
                onBlur={() => setActive(null)}
                style={{
                  cursor: item.href ? "pointer" : "default",
                  opacity: dim,
                  transition: "opacity 120ms",
                }}
              >
                {/* A fat transparent hit area — a single-month entry is only
                    14px of track, far too small to point at reliably. */}
                <rect
                  x={x1 - 8}
                  y={cy - LANE_H / 2}
                  width={x2 - x1 + 16}
                  height={LANE_H}
                  fill="transparent"
                />

                {/* The branch itself. A point entry has no length, so the node
                    alone carries it. */}
                {item.endCol > item.startCol && (
                  <line
                    x1={x1}
                    y1={cy}
                    x2={x2}
                    y2={cy}
                    stroke={color}
                    strokeWidth={isActive ? 7 : 5}
                    strokeLinecap="round"
                    strokeDasharray={KIND_DASH[item.kind] || undefined}
                    style={{ transition: "stroke-width 120ms" }}
                  />
                )}

                {/* Hollow for a span, filled for a moment. */}
                <circle
                  cx={x1}
                  cy={cy}
                  r={isActive ? 5.5 : 4.5}
                  fill={item.isPoint ? color : "var(--surface)"}
                  stroke={color}
                  strokeWidth={2.5}
                  style={{ transition: "r 120ms" }}
                />

                {/*
                  Closing node, only where the end is a recorded fact. An
                  ongoing role's end month is today's date, so capping it would
                  assert the job has finished.
                */}
                {item.hasEnd && item.endCol > item.startCol && (
                  <circle
                    cx={x2}
                    cy={cy}
                    r={isActive ? 5.5 : 4.5}
                    fill="var(--surface)"
                    stroke={color}
                    strokeWidth={2.5}
                    style={{ transition: "r 120ms" }}
                  />
                )}
              </g>
            );

            return item.href ? (
              <Link key={item.id} href={item.href} aria-label={item.label}>
                {body}
              </Link>
            ) : (
              <g key={item.id} tabIndex={0} aria-label={item.label}>
                {body}
              </g>
            );
          })}
        </svg>
        </div>
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
              style={{ backgroundColor: colorFor(active) }}
              aria-hidden="true"
            />
            <span className="min-w-0">
              <span className="block text-sm">
                {active.label}
                {active.detail && <span className="text-muted"> · {active.detail}</span>}
              </span>
              <span className="block font-mono text-[11px] text-muted">
                {KIND_LABELS[active.kind]} · {itemRange(active, now)}
              </span>
            </span>
          </>
        ) : (
          <span className="self-center font-mono text-[11px] uppercase tracking-widest text-muted">
            Hover a branch for detail
          </span>
        )}
      </div>
    </div>
  );
}
