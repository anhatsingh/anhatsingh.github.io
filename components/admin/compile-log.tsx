"use client";

import { useState } from "react";
import { fetchCompileLogs } from "@/app/admin/actions";
import type { CompileTrace } from "@/lib/resume/compile";
import type { LogEntry } from "@/lib/gcp/logs";

/*
  What the compiler did, for the click that just happened.

  Before this, a failed compile in the admin was one red line — "LaTeX:
  Undefined control sequence" — while the log that says which line of which
  file was captured, passed through the action, and then dropped by the page.
  A successful compile showed nothing at all.

  Collapsed by default. On a good day nobody needs it, and a wall of TeX output
  above the findings would bury the thing you actually came to read.

  Nothing here is stored. It describes one click and is gone on reload, which
  is deliberate: a compile log is a debugging aid with a half-life of minutes,
  and keeping them would mean deciding how long to keep documents that contain
  a person's contact details.
*/

function ms(value: number): string {
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`;
}

function severityColour(severity: string): string {
  if (severity === "ERROR" || severity === "CRITICAL" || severity === "ALERT") return "text-danger";
  if (severity === "WARNING") return "text-warn";
  return "text-muted";
}

function TracePanel({ trace, index, total }: { trace: CompileTrace; index: number; total: number }) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [logError, setLogError] = useState("");
  const [loading, setLoading] = useState(false);

  async function pull() {
    setLoading(true);
    setLogError("");
    const result = await fetchCompileLogs({
      requestId: trace.requestId,
      since: trace.startedAt,
      until: trace.finishedAt,
    });
    setLoading(false);
    if (result.ok) setEntries(result.entries);
    else setLogError(result.error);
  }

  return (
    <div className="rounded-[var(--radius)] border border-hairline bg-elevated p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-accent">
          {total > 1 ? `compile ${index + 1} of ${total}` : "compile"}
        </span>
        <span className="font-mono text-[11px] text-muted">
          {trace.backend}
          {trace.status ? ` · ${trace.status}` : ""} · {ms(trace.durationMs)}
        </span>
      </div>

      {/*
        Identity before output. When a compile behaves differently from the
        last one, the first question is whether it was even the same build of
        the container — and that is unanswerable without the revision.
      */}
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
        <dt className="text-muted">request</dt>
        <dd className="truncate">{trace.requestId}</dd>
        {trace.revision && (
          <>
            <dt className="text-muted">revision</dt>
            <dd className="truncate">{trace.revision}</dd>
          </>
        )}
        {trace.instance && (
          <>
            <dt className="text-muted">instance</dt>
            <dd className="truncate">{trace.instance}</dd>
          </>
        )}
        {trace.timings && (
          <>
            <dt className="text-muted">stages</dt>
            <dd>
              {Object.entries(trace.timings)
                .map(([k, v]) => `${k.replace(/Ms$/, "")} ${ms(v)}`)
                .join(" · ")}
            </dd>
          </>
        )}
      </dl>

      {trace.backend === "remote" && !trace.texLog && !trace.stdout && (
        <p className="mt-2 text-xs text-muted">
          This deployment didn&apos;t return a log. Redeploy the container from{" "}
          <code className="text-accent">infra/latex</code> to get one.
        </p>
      )}

      {/*
        Pre with its own horizontal scroll. TeX wraps at 79 columns and then
        emits paths longer than that anyway, so without this the whole admin
        page scrolls sideways.
      */}
      {trace.texLog && (
        <details className="mt-2">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-muted hover:text-accent">
            TeX log
          </summary>
          <pre className="mt-1 max-h-72 overflow-auto rounded-[var(--radius)] border border-hairline bg-surface p-2 text-[11px] leading-relaxed">
            {trace.texLog}
          </pre>
        </details>
      )}

      {trace.stdout && (
        <details className="mt-2">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-muted hover:text-accent">
            pdflatex output
          </summary>
          <pre className="mt-1 max-h-72 overflow-auto rounded-[var(--radius)] border border-hairline bg-surface p-2 text-[11px] leading-relaxed">
            {trace.stdout}
          </pre>
        </details>
      )}

      {/*
        Only offered for a remote compile. A local pdflatex has no Cloud Run
        logs, and a button that can only fail is worse than no button.
      */}
      {trace.backend === "remote" && (
        <div className="mt-3">
          <button
            onClick={pull}
            disabled={loading}
            className="font-mono text-[10px] uppercase tracking-widest text-accent hover:underline disabled:opacity-50"
          >
            {loading ? "reading Cloud Run…" : entries ? "refresh Cloud Run logs" : "fetch Cloud Run logs"}
          </button>

          {logError && <p className="mt-1 text-xs text-danger">{logError}</p>}

          {entries && entries.length === 0 && (
            <p className="mt-1 text-xs text-muted">
              Nothing in that window — which usually means the request never reached Cloud Run.
            </p>
          )}

          {entries && entries.length > 0 && (
            <ul className="mt-2 max-h-72 space-y-0.5 overflow-auto rounded-[var(--radius)] border border-hairline bg-surface p-2 font-mono text-[11px]">
              {entries.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 text-muted">{e.timestamp.slice(11, 19)}</span>
                  <span className={`shrink-0 ${severityColour(e.severity)}`}>{e.severity}</span>
                  <span className="min-w-0 break-all">{e.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function CompileLog({ traces }: { traces: CompileTrace[] }) {
  if (!traces.length) return null;

  const total = traces.reduce((sum, t) => sum + t.durationMs, 0);

  return (
    <details className="rounded-[var(--radius)] border border-hairline bg-surface">
      <summary className="cursor-pointer px-4 py-2.5 font-mono text-xs uppercase tracking-widest text-muted hover:text-accent">
        Compile log
        <span className="ml-2 normal-case tracking-normal text-[11px]">
          {traces.length > 1 ? `${traces.length} compiles · ` : ""}
          {ms(total)}
        </span>
      </summary>
      <div className="space-y-3 border-t border-hairline p-4">
        {traces.map((t, i) => (
          <TracePanel key={t.requestId} trace={t} index={i} total={traces.length} />
        ))}
      </div>
    </details>
  );
}
