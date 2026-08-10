"use client";

import { useState } from "react";
import { importLinkedIn, type ImportPayload } from "@/app/admin/actions";
import { parseLinkedInExport, type ImportResult } from "@/lib/linkedin/import";

/*
  LinkedIn import screen.

  Deliberately a review step, not a one-click sync: the CSVs contain whatever
  you last wrote on LinkedIn, which is rarely what you want verbatim on a
  portfolio. Everything lands unchecked-able but editable afterwards in the
  normal section editors.
*/

type Phase = "idle" | "parsing" | "review" | "saving" | "done" | "error";

const GROUPS = [
  { key: "experience", label: "Experience", note: "" },
  { key: "education", label: "Education", note: "" },
  { key: "skills", label: "Skills", note: "All land under “Imported” — re-file them afterwards." },
  {
    key: "certifications",
    label: "Certifications, honours and test scores",
    note: "Honours and test scores share this section — it's the one that renders things awarded by someone else.",
  },
  { key: "projects", label: "Projects", note: "" },
  {
    key: "testimonials",
    label: "Recommendations",
    note: "Only ones marked VISIBLE on LinkedIn — anything still pending isn't shown there either.",
  },
  {
    key: "volunteering",
    label: "Volunteering",
    note: "Imported hidden, into the experience section. Publish each one yourself once it reads the way you want.",
  },
] as const;

/** Groups vary in shape; this is the one place that knows how each reads. */
function rowTitle(row: Record<string, unknown>): string {
  if ("role" in row) return `${row.role} · ${row.company}`;
  if ("institution" in row) return `${row.degree} · ${row.institution}`;
  if ("author_name" in row) return `${row.author_name}${row.author_title ? ` · ${row.author_title}` : ""}`;
  return String(row.name ?? row.slug);
}

/** The second line — a quote needs showing, a slug is just plumbing. */
function rowDetail(row: Record<string, unknown>): string {
  if ("quote" in row) return `“${String(row.quote).slice(0, 120)}…”`;
  if ("repo_url" in row && row.repo_url) return String(row.repo_url);
  return String(row.slug);
}

export default function ImportPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [parsed, setParsed] = useState<ImportResult | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [problem, setProblem] = useState("");
  const [summary, setSummary] = useState<Record<string, number>>({});

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhase("parsing");
    setProblem("");

    try {
      const result = await parseLinkedInExport(file);
      setParsed(result);
      // Everything selected by default — the common case is "import it all".
      const initial: Record<string, boolean> = {};
      for (const g of GROUPS) {
        for (const row of result[g.key]) initial[`${g.key}:${row.slug}`] = true;
      }
      // Volunteering is the one group that isn't obviously wanted — it lands in
      // the work timeline, so make ticking it a deliberate act.
      for (const row of result.volunteering) initial[`volunteering:${row.slug}`] = false;
      setSelected(initial);
      setPhase("review");
    } catch {
      setProblem("Couldn't read that file. Make sure it's the .zip LinkedIn emailed you.");
      setPhase("error");
    }
  }

  async function commit() {
    if (!parsed) return;
    setPhase("saving");
    setProblem("");

    const payload: ImportPayload = {};
    for (const g of GROUPS) {
      const rows = (parsed[g.key] as unknown as Record<string, unknown>[]).filter(
        (r) => selected[`${g.key}:${r.slug}`],
      );
      if (rows.length) payload[g.key] = rows;
    }

    const result = await importLinkedIn(payload);
    if (!result.ok) {
      setProblem(result.error);
      setPhase("error");
      return;
    }
    setSummary(result.counts ?? {});
    setPhase("done");
  }

  const totalSelected = Object.values(selected).filter(Boolean).length;

  return (
    <div>
      <h2 className="font-display text-3xl">Import from LinkedIn</h2>

      <div className="mt-4 rounded-[var(--radius)] border border-hairline bg-surface p-4 text-sm">
        <p className="text-muted">
          LinkedIn has no API that exposes work history — the only self-serve one returns just your
          name, photo and email, and scraping breaches their terms. So this uses the official export
          instead.
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-muted">
          <li>
            LinkedIn → <span className="text-text">Settings &amp; Privacy</span> →{" "}
            <span className="text-text">Data Privacy</span> →{" "}
            <span className="text-text">Get a copy of your data</span>
          </li>
          <li>
            Ask for the <span className="text-text">full</span> archive — the small one omits
            Projects, Recommendations, Honours and Volunteering
          </li>
          <li>Wait for the email, download the .zip, drop it below</li>
        </ol>
        <p className="mt-3 text-xs text-muted">
          The file is parsed in your browser — it never gets uploaded anywhere.
        </p>
      </div>

      {(phase === "idle" || phase === "error" || phase === "parsing") && (
        <div className="mt-6">
          <label className="inline-block cursor-pointer rounded-[var(--radius)] border border-dashed border-hairline px-5 py-4 font-mono text-xs uppercase tracking-widest text-muted transition-colors hover:border-accent hover:text-accent">
            {phase === "parsing" ? "Reading…" : "Choose LinkedIn .zip"}
            <input type="file" accept=".zip" onChange={onFile} className="hidden" />
          </label>
        </div>
      )}

      {problem && <p className="mt-4 text-sm text-danger">{problem}</p>}

      {phase === "done" && (
        <div className="mt-6 rounded-[var(--radius)] border border-success/40 bg-success/10 p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-success">Imported</p>
          <ul className="mt-2 text-sm">
            {Object.entries(summary).map(([table, n]) => (
              <li key={table}>
                {n} {table}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted">
            Now go tidy them up — LinkedIn prose rarely reads well on a portfolio.
          </p>
        </div>
      )}

      {parsed && (phase === "review" || phase === "saving") && (
        <div className="mt-8 space-y-8">
          {parsed.missing.length > 0 && (
            <p className="text-sm text-muted">
              Not found in this archive: {parsed.missing.join(", ")}. That usually means you
              requested a partial export.
            </p>
          )}

          {parsed.skipped.length > 0 && (
            <section className="rounded-[var(--radius)] border border-hairline bg-surface p-4">
              <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
                Left out on purpose
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {parsed.skipped.map((s) => (
                  <li key={s.file}>
                    <span className="text-text">{s.file}</span>
                    {s.rows > 0 && ` (${s.rows} row${s.rows === 1 ? "" : "s"})`} — {s.why}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {GROUPS.map((g) => {
            const rows = parsed[g.key] as unknown as Record<string, unknown>[];
            if (!rows.length) return null;

            return (
              <section key={g.key}>
                <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
                  {g.label} ({rows.length})
                </h3>
                {g.note && <p className="mt-1 text-xs text-muted">{g.note}</p>}
                <ul className="mt-3 space-y-2">
                  {rows.map((row) => {
                    const key = `${g.key}:${row.slug}`;
                    const title = rowTitle(row);

                    return (
                      <li key={key}>
                        <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border border-hairline bg-surface p-3">
                          <input
                            type="checkbox"
                            checked={selected[key] ?? false}
                            onChange={(e) =>
                              setSelected((s) => ({ ...s, [key]: e.target.checked }))
                            }
                            className="mt-1 h-4 w-4 accent-[var(--accent)]"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm">{title}</span>
                            <span className="block truncate font-mono text-xs text-muted">
                              {rowDetail(row)}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          <button
            onClick={commit}
            disabled={phase === "saving" || totalSelected === 0}
            className="rounded-[var(--radius)] bg-accent px-5 py-2.5 font-mono text-xs uppercase tracking-widest text-accent-ink disabled:opacity-50"
          >
            {phase === "saving" ? "Importing…" : `Import ${totalSelected} selected`}
          </button>
        </div>
      )}
    </div>
  );
}
