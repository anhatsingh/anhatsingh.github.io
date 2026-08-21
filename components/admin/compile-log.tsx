"use client";

import { useState } from "react";
import { fetchCompileLogs } from "@/app/admin/actions";
import type { CompileTrace } from "@/lib/resume/compile";
import type { PipelineEvent } from "@/lib/resume/pipeline";
import type { AuditStep } from "@/lib/resume/audit";
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

/*
  The ATS checks, as a list of what ran.

  Previously the audit reported only what it found, so a clean resume produced
  nothing — which reads identically to an audit that never happened. Showing
  every check with its count is the difference between "no problems" and "no
  evidence", and the second is what this pipeline was actually doing on the
  save path until recently.
*/
function AuditSteps({ steps, pass }: { steps: AuditStep[]; pass: number }) {
  const problems = steps.reduce((n, s) => n + s.problems, 0);

  return (
    <details className="rounded-[var(--radius)] border border-hairline bg-elevated p-3" open={problems > 0}>
      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-muted hover:text-accent">
        ATS checks{pass > 1 ? ` · pass ${pass}` : ""}
        <span className={`ml-2 normal-case tracking-normal ${problems ? "text-danger" : "text-success"}`}>
          {problems ? `${problems} problem${problems === 1 ? "" : "s"}` : "all clean"}
        </span>
      </summary>
      <ul className="mt-2 space-y-1">
        {steps.map((step) => (
          <li key={step.check} className="flex items-baseline gap-2 text-[11px]">
            <span
              aria-hidden="true"
              className={`font-mono ${step.problems ? "text-danger" : "text-success"}`}
            >
              {step.problems ? "✗" : "✓"}
            </span>
            <span className="min-w-0 flex-1">{step.label}</span>
            <span className="shrink-0 font-mono text-[10px] text-muted">
              {step.problems ? `${step.problems}/${step.examined}` : step.examined}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Everything the pipeline did, in the order it did it.
 *
 * Open while it runs and collapsible afterwards: during, it is the only sign
 * the half-minute of compiling and model calls is progressing; after, it is
 * reference material that should not sit on top of the findings.
 */
export function PipelineLog({ events, running }: { events: PipelineEvent[]; running: boolean }) {
  if (!events.length) return null;

  const traces = events.flatMap((e) => (e.type === "compiled" ? [e.trace] : []));
  const elapsed = traces.reduce((sum, t) => sum + t.durationMs, 0);
  /*
    The last stage is the one in flight. Everything before it has been
    superseded by a later event, which is what makes a plain list readable
    without tracking completion per stage.
  */
  const stages = events.filter((e) => e.type === "stage");
  const current = running ? stages[stages.length - 1] : null;

  return (
    <details
      className="rounded-[var(--radius)] border border-hairline bg-surface"
      open={running}
      /*
        Keyed on running so the browser re-applies `open` when a run starts.
        Without the key, a panel the user collapsed stays collapsed through the
        next run and the live log is invisible.
      */
      key={running ? "running" : "idle"}
    >
      <summary className="cursor-pointer px-4 py-2.5 font-mono text-xs uppercase tracking-widest text-muted hover:text-accent">
        {running ? (
          <>
            <span className="relative mr-2 inline-flex h-1.5 w-1.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            <span className="text-accent">{current?.type === "stage" ? current.message : "Working"}</span>
          </>
        ) : (
          <>
            Pipeline log
            <span className="ml-2 normal-case tracking-normal text-[11px]">
              {traces.length > 1 ? `${traces.length} compiles · ` : ""}
              {elapsed ? ms(elapsed) : `${events.length} events`}
            </span>
          </>
        )}
      </summary>

      <div className="space-y-2 border-t border-hairline p-4">
        {events.map((event, i) => {
          switch (event.type) {
            case "stage":
              return (
                <p key={i} className="font-mono text-[11px] text-accent">
                  <span aria-hidden="true" className="mr-1.5">
                    ↳
                  </span>
                  {event.message}
                  {running && i === events.length - 1 && (
                    <span aria-hidden="true" className="ml-1 animate-pulse">
                      ▍
                    </span>
                  )}
                </p>
              );

            case "note":
              return (
                <p key={i} className="pl-4 text-[11px] text-muted">
                  {event.message}
                </p>
              );

            case "fidelity":
              return (
                <p key={i} className={`pl-4 text-[11px] ${event.ok ? "text-muted" : "text-warn"}`}>
                  Fidelity — {event.note}
                </p>
              );

            case "audited":
              return <AuditSteps key={i} steps={event.steps} pass={event.pass} />;

            case "compiled":
              return (
                <TracePanel
                  key={event.trace.requestId}
                  trace={event.trace}
                  index={traces.findIndex((t) => t.requestId === event.trace.requestId)}
                  total={traces.length}
                />
              );

            case "failed":
              return (
                <p key={i} className="pl-4 text-[11px] text-danger">
                  {event.error}
                </p>
              );

            case "saved":
              return (
                <p key={i} className="pl-4 text-[11px] text-success">
                  Saved as {event.slug}
                </p>
              );

            default:
              return null;
          }
        })}
      </div>
    </details>
  );
}
