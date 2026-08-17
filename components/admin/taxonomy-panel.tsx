"use client";

import { useMemo, useState } from "react";
import { applyTaxonomy, requestTaxonomy, type TaxonomyProposal } from "@/app/admin/actions";
import { planRegroup, type Taxonomy } from "@/lib/admin/regroup";

/*
  Approving a taxonomy.

  The model proposes headings and the human decides. Which means this screen's
  job is not to look tidy — it is to make the consequences visible before Apply,
  because two of them are irreversible in the ways that matter: a merge edits
  what an entry card says, and unpublishing a skill takes its page down.

  So it leads with the counts, then merges, then retirements, then the
  assignments. Anything destructive is off unless ticked, the default
  components/admin/ai-draft-panel.tsx sets.
*/

type Phase = "idle" | "asking" | "review" | "applying" | "done";

export function TaxonomyPanel({ vocabularySize, unabsorbedCount }: { vocabularySize: number; unabsorbedCount: number }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState("");
  const [proposal, setProposal] = useState<TaxonomyProposal | null>(null);
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [rewriteTech, setRewriteTech] = useState(false);
  const [result, setResult] = useState("");

  /*
    The plan is recomputed from the edited taxonomy on every change, by the
    same pure function the server will run. So what the panel shows is what
    Apply does — not a summary of it written twice and drifting.
  */
  const plan = useMemo(() => {
    if (!proposal || !taxonomy) return null;
    return planRegroup(taxonomy, proposal.vocabulary, proposal.current, proposal.entries);
  }, [proposal, taxonomy]);

  async function ask() {
    setPhase("asking");
    setProblem("");
    const res = await requestTaxonomy();
    if (!res.ok) {
      setProblem(res.error);
      setPhase("idle");
      return;
    }
    setProposal(res.proposal);
    setTaxonomy(res.proposal.taxonomy);
    setPhase("review");
  }

  async function apply() {
    if (!taxonomy) return;
    setPhase("applying");
    const res = await applyTaxonomy(taxonomy, { rewriteTech });
    if (!res.ok) {
      setProblem(res.error);
      setPhase("review");
      return;
    }
    setResult(
      res.noop
        ? "Nothing to change — the section already matches this."
        : `${res.upserted} skills grouped, ${res.unpublished} retired, ${res.rewritten} entries rewritten.`,
    );
    setPhase("done");
  }

  const rename = (index: number, name: string) => {
    if (!taxonomy) return;
    const before = taxonomy.headings[index].name;
    setTaxonomy({
      headings: taxonomy.headings.map((h, i) => (i === index ? { ...h, name } : h)),
      // Terms point at headings by name, so a rename has to carry.
      terms: taxonomy.terms.map((t) => (t.heading === before ? { ...t, heading: name } : t)),
    });
  };

  const move = (index: number, by: number) => {
    if (!taxonomy) return;
    const next = [...taxonomy.headings];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setTaxonomy({ ...taxonomy, headings: next });
  };

  /*
    Moves a badge by its displayed name, which is the canonical one — and moves
    every term folded into it along with it. Matching on `term` instead would
    miss: the badge reads "Spark", while the rows behind it are "Spark" and
    "Apache Spark", and leaving the alias under the old heading would put the
    same skill in two places.
  */
  const reassign = (name: string, heading: string) => {
    if (!taxonomy) return;
    const key = name.trim().toLowerCase();
    setTaxonomy({
      ...taxonomy,
      terms: taxonomy.terms.map((t) =>
        t.canonical.trim().toLowerCase() === key ? { ...t, heading } : t,
      ),
    });
  };

  /*
    Dropping a badge outright, which merging cannot express.

    The model has to place every term somewhere, so it cannot decide that
    "Local Storage" is not a skill — only a person can. Removing it from the
    taxonomy leaves it uncreated if it was only ever a tech value, or retires
    it if it was already a badge, and the retirement shows up in the list of
    pages this will take down.
  */
  const drop = (name: string) => {
    if (!taxonomy) return;
    const key = name.trim().toLowerCase();
    setTaxonomy({
      ...taxonomy,
      terms: taxonomy.terms.filter((t) => t.canonical.trim().toLowerCase() !== key),
    });
  };

  const unmerge = (term: string) => {
    if (!taxonomy) return;
    // Undoing a merge is the one edit worth a dedicated control: it is the
    // decision that edits content, and it should be one click to refuse.
    setTaxonomy({
      ...taxonomy,
      terms: taxonomy.terms.map((t) => (t.term === term ? { ...t, canonical: t.term } : t)),
    });
  };

  if (phase === "done") {
    return (
      <div className="rounded-[var(--radius)] border border-success/40 bg-success/5 p-4">
        <p className="text-sm text-text">{result}</p>
        <a href="/" className="mt-2 inline-block font-mono text-xs uppercase tracking-widest text-accent hover:underline">
          see the section →
        </a>
      </div>
    );
  }

  /*
    "applying" belongs on this side of the guard. Excluding it sent the panel
    back to its opening screen the instant Apply was pressed, so the work
    disappeared behind the button that started it.
  */
  const reviewing = phase === "review" || phase === "applying";
  if (!reviewing || !taxonomy || !plan) {
    return (
      <div className="rounded-[var(--radius)] border border-hairline bg-surface p-4">
        <p className="text-sm text-muted">
          {vocabularySize} terms across skills and the tech listed on entries.{" "}
          {unabsorbedCount > 0 && (
            <strong className="text-text">
              {unabsorbedCount} of them are named on an entry but missing from the Skills section.
            </strong>
          )}
        </p>
        <button
          type="button"
          onClick={ask}
          disabled={phase === "asking"}
          className="mt-3 rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {phase === "asking" ? "Thinking…" : "Propose headings"}
        </button>
        {problem && <p className="mt-2 text-sm text-danger">{problem}</p>}
      </div>
    );
  }

  const merges = taxonomy.terms.filter((t) => t.canonical.toLowerCase() !== t.term.toLowerCase());
  const total = plan.upserts.length;

  return (
    <div className="space-y-6">
      {/*
        The count first. tidy-skills.ts argued that a hundred badges reads as
        "I ticked every box on LinkedIn", and absorbing tech is exactly how a
        section drifts back there without anyone deciding to.
      */}
      <p className="text-sm text-muted">
        <strong className={total > 60 ? "text-warn" : "text-text"}>{total} badges</strong> across{" "}
        {taxonomy.headings.length} headings.
        {plan.unpublish.length > 0 && ` ${plan.unpublish.length} retired.`}
      </p>

      <section className="space-y-2">
        {taxonomy.headings.map((heading, i) => {
          const count = plan.upserts.filter((u) => u.category === heading.name).length;
          return (
            <div key={i} className="rounded-[var(--radius)] border border-hairline bg-surface p-3">
              <div className="flex items-center gap-2">
                <input
                  value={heading.name}
                  onChange={(e) => rename(i, e.target.value)}
                  className="min-w-0 flex-1 rounded border border-hairline bg-bg px-2 py-1 text-sm outline-none focus:border-accent/50"
                />
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">{count}</span>
                <button type="button" onClick={() => move(i, -1)} aria-label="Move up" className="px-1 text-muted hover:text-text">
                  ↑
                </button>
                <button type="button" onClick={() => move(i, 1)} aria-label="Move down" className="px-1 text-muted hover:text-text">
                  ↓
                </button>
              </div>
              <p className="mt-1 text-xs text-muted">{heading.rationale}</p>

              <ul className="mt-2 flex flex-wrap gap-1">
                {plan.upserts
                  .filter((u) => u.category === heading.name)
                  .map((u) => (
                    <li key={u.slug} className="inline-flex items-center rounded-full border border-hairline">
                      <select
                        value={heading.name}
                        onChange={(e) => reassign(u.name, e.target.value)}
                        aria-label={`Heading for ${u.name}`}
                        className="max-w-[15rem] truncate bg-transparent px-2 py-0.5 text-xs text-muted"
                      >
                        <option value={heading.name}>{u.name}</option>
                        {taxonomy.headings
                          .filter((h) => h.name !== heading.name)
                          .map((h) => (
                            <option key={h.name} value={h.name}>
                              → {h.name}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => drop(u.name)}
                        aria-label={`Drop ${u.name}`}
                        title="Not a skill — leave it off"
                        className="px-1.5 text-[10px] text-muted hover:text-danger"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          );
        })}
      </section>

      {merges.length > 0 && (
        <section>
          <h3 className="font-mono text-xs uppercase tracking-widest text-muted">Merges ({merges.length})</h3>
          <p className="mt-1 text-xs text-muted">
            The name on the left disappears. Tick the rewrite below and the entries that used it say the
            right-hand name instead — leave it off and those entries keep their wording, but the surviving
            skill&apos;s page won&apos;t count them as evidence.
          </p>
          <ul className="mt-2 space-y-1">
            {merges.map((m) => (
              <li key={m.term} className="flex items-center gap-2 text-sm">
                <span className="text-muted line-through">{m.term}</span>
                <span aria-hidden="true" className="text-muted">→</span>
                <span className="text-text">{m.canonical}</span>
                <button
                  type="button"
                  onClick={() => unmerge(m.term)}
                  className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-danger"
                >
                  keep separate
                </button>
              </li>
            ))}
          </ul>

          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={rewriteTech}
              onChange={(e) => setRewriteTech(e.target.checked)}
              className="mt-1"
            />
            <span className="text-muted">
              Also rewrite the tech lists on {plan.rewrites.length} entries. This edits what those cards say.
            </span>
          </label>
        </section>
      )}

      {plan.conflicts.length > 0 && (
        <section>
          <h3 className="font-mono text-xs uppercase tracking-widest text-warn">Kept anyway ({plan.conflicts.length})</h3>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {plan.conflicts.map((c, i) => (
              <li key={i}>
                <span className="text-text">{c.term}</span> — {c.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan.retiredUrls.length > 0 && (
        <section>
          {/*
            Named explicitly. Unpublishing does not hide a skill, it removes the
            page — and Search Console has only just been straightened out.
          */}
          <h3 className="font-mono text-xs uppercase tracking-widest text-danger">
            Pages that will stop existing ({plan.retiredUrls.length})
          </h3>
          <p className="mt-1 font-mono text-xs text-muted">{plan.retiredUrls.join("  ·  ")}</p>
        </section>
      )}

      {problem && <p className="text-sm text-danger">{problem}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={phase === "applying"}
          className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {phase === "applying" ? "Applying…" : "Apply"}
        </button>
        <button
          type="button"
          onClick={() => setPhase("idle")}
          className="rounded border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:text-text"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
