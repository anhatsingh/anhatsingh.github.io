"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RowForm } from "./row-form";
import type { TableSpec } from "@/lib/admin/schema";

/*
  List + inline editors for one table.

  Singletons (profile) skip the list entirely and render a single always-open
  form, since "add another profile" isn't a thing.
*/
export function SectionEditor({
  spec,
  rows,
}: {
  spec: TableSpec;
  rows: Record<string, unknown>[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  // router.refresh() re-runs the server component so the list reflects the
  // write without a full reload.
  const refresh = () => {
    setCreating(false);
    router.refresh();
  };

  if (spec.singleton) {
    return <RowForm spec={spec} row={rows[0] ?? null} onDone={refresh} />;
  }

  return (
    <div className="space-y-4">
      {creating ? (
        <div className="rounded-[var(--radius)] border border-accent/40 bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-mono text-xs uppercase tracking-widest text-accent">New entry</h3>
            <button
              onClick={() => setCreating(false)}
              className="font-mono text-xs uppercase tracking-widest text-muted hover:text-text"
            >
              cancel
            </button>
          </div>
          <RowForm spec={spec} row={null} onDone={refresh} />
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="rounded-[var(--radius)] border border-dashed border-hairline px-4 py-3 font-mono text-xs uppercase tracking-widest text-muted transition-colors hover:border-accent hover:text-accent"
        >
          + new {spec.label.toLowerCase().replace(/s$/, "")}
        </button>
      )}

      {rows.length === 0 && !creating && (
        <p className="text-sm text-muted">Nothing here yet.</p>
      )}

      {rows.map((row) => (
        <details
          key={String(row.id)}
          className="group rounded-[var(--radius)] border border-hairline bg-surface"
        >
          <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="font-medium">{String(row[spec.titleField] ?? "(untitled)")}</span>
              <span className="ml-2 font-mono text-xs text-muted">{String(row.slug ?? "")}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {row.is_published === false && (
                <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted">
                  draft
                </span>
              )}
              <span className="font-mono text-xs text-muted group-open:hidden">edit</span>
            </span>
          </summary>
          <div className="border-t border-hairline p-5">
            <RowForm spec={spec} row={row} onDone={refresh} />
          </div>
        </details>
      ))}
    </div>
  );
}
