"use client";

import { useState } from "react";
import { reorderByDate } from "@/app/admin/actions";
import type { TableSpec } from "@/lib/admin/schema";

/*
  "Sort by date" for a table that has one.

  This rewrites sort_order rather than changing how the list is displayed. The
  distinction matters: sort_order is what the public site, the sitemap and the
  chatbot all read, so a sort that only affected this screen would show an
  order nobody else sees.

  Because it writes, it asks first. Renumbering is not destructive — no content
  changes and it can be run again in the other direction — but it does discard
  hand-set positions, and that's worth a click rather than a surprise.
*/

export function DateSort({ spec, count }: { spec: TableSpec; count: number }) {
  const [busy, setBusy] = useState<"asc" | "desc" | null>(null);
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState("");
  const [confirming, setConfirming] = useState<"asc" | "desc" | null>(null);

  if (!spec.dateField || count < 2) return null;

  async function run(direction: "asc" | "desc") {
    setBusy(direction);
    setProblem("");
    setDone("");
    setConfirming(null);

    const result = await reorderByDate(spec.key, direction);
    setBusy(null);

    if (!result.ok) {
      setProblem(result.error);
      return;
    }

    setDone(direction === "desc" ? "Newest first." : "Oldest first.");
    // Full reload rather than router.refresh(): the numbers just changed on
    // every row, and a stale list showing the old ones reads as a failed save.
    window.location.reload();
  }

  const label = (d: "asc" | "desc") => (d === "desc" ? "Newest first" : "Oldest first");

  return (
    <div className="rounded-[var(--radius)] border border-hairline bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-mono text-[11px] uppercase tracking-widest text-muted">
          Order by {spec.dateField.replace(/_/g, " ")}
        </span>

        {(["desc", "asc"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setConfirming(d)}
            disabled={busy !== null}
            className="font-mono text-[11px] uppercase tracking-widest text-accent hover:underline disabled:opacity-50"
          >
            {busy === d ? "Sorting…" : label(d)}
          </button>
        ))}
      </div>

      {confirming && (
        <div className="mt-3 border-t border-hairline pt-3">
          <p className="text-sm text-muted">
            Renumber all {count} rows to {label(confirming).toLowerCase()}? Any positions you
            set by hand will be replaced.
          </p>
          <div className="mt-2 flex gap-4">
            <button
              type="button"
              onClick={() => run(confirming)}
              className="font-mono text-[11px] uppercase tracking-widest text-accent hover:underline"
            >
              Yes, renumber
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="font-mono text-[11px] uppercase tracking-widest text-muted hover:text-text"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {problem && <p className="mt-2 text-sm text-danger">{problem}</p>}
      {done && !problem && <p className="mt-2 text-sm text-success">{done}</p>}
    </div>
  );
}
