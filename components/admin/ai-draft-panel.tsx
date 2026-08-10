"use client";

import { useState, useTransition } from "react";
import { applyDraft, requestDraft } from "@/app/admin/actions";
import { DEFAULT_AUTHOR_PROMPT, type Draft } from "@/lib/ai/author";
import type { EntityType } from "@/lib/content/types";

/*
  Paste a paragraph, get a proposal, tick what you want.

  Everything is opt-in. Nothing reaches the database until Apply is pressed, and
  each piece — summary, each highlight, each skill, the body — is accepted
  independently.

  That's not caution for its own sake. A CV that overstates gets its owner
  rejected at interview rather than filtered at screening, which costs more than
  a thinner page ever would. The model is told not to invent; this panel is what
  makes that verifiable instead of a hope.
*/

type Phase = "idle" | "drafting" | "review" | "applying" | "done";

export function AiDraftPanel({
  entityType,
  tableKey,
  rowId,
  title,
  currentSummary,
}: {
  entityType: EntityType;
  tableKey: string;
  rowId: string;
  title: string;
  currentSummary: string;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [paragraph, setParagraph] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_AUTHOR_PROMPT);
  const [showPrompt, setShowPrompt] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problem, setProblem] = useState("");
  const [pending, startTransition] = useTransition();

  // Selection state — everything starts ticked EXCEPT new skills, which are
  // the only irreversible-ish action here (they add rows to a shared taxonomy).
  const [useSummary, setUseSummary] = useState(true);
  const [useBody, setUseBody] = useState(true);
  const [chosenHighlights, setChosenHighlights] = useState<Set<number>>(new Set());
  const [chosenSkills, setChosenSkills] = useState<Set<string>>(new Set());

  function generate() {
    setProblem("");
    setPhase("drafting");
    startTransition(async () => {
      const result = await requestDraft({ entityType, title, paragraph, prompt });
      if (!result.ok) {
        setProblem(result.error);
        setPhase("idle");
        return;
      }
      setDraft(result.draft);
      setChosenHighlights(new Set(result.draft.highlights.map((_, i) => i)));
      setChosenSkills(new Set(result.draft.skills.filter((s) => !s.isNew).map((s) => s.slug)));
      setPhase("review");
    });
  }

  function apply() {
    if (!draft) return;
    setProblem("");
    setPhase("applying");

    const picked = draft.skills.filter((s) => chosenSkills.has(s.slug));

    startTransition(async () => {
      const result = await applyDraft({
        tableKey,
        rowId,
        summary: useSummary ? draft.summary : undefined,
        highlights: chosenHighlights.size
          ? draft.highlights.filter((_, i) => chosenHighlights.has(i))
          : undefined,
        body: useBody && draft.blocks.length ? draft.blocks : undefined,
        // tech[] is what skill evidence pages match on, so accepted skills go
        // there as well as into the skills table.
        tech: picked.length ? picked.map((s) => s.name) : undefined,
        newSkills: picked
          .filter((s) => s.isNew)
          .map((s) => ({ name: s.name, slug: s.slug, category: "Other" })),
      });

      if (!result.ok) {
        setProblem(result.error);
        setPhase("review");
        return;
      }
      setPhase("done");
    });
  }

  const label = "block font-mono text-[10px] uppercase tracking-widest text-muted";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-[var(--radius)] border border-dashed border-accent/40 px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-accent transition-colors hover:bg-accent/5"
      >
        ⌁ draft this with AI
      </button>
    );
  }

  return (
    <div className="rounded-[var(--radius)] border border-accent/40 bg-accent/5 p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-widest text-accent">
          ⌁ AI draft
        </span>
        <button
          type="button"
          onClick={() => { setOpen(false); setPhase("idle"); setDraft(null); }}
          className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text"
        >
          close
        </button>
      </div>

      {phase === "done" ? (
        <div className="mt-3">
          <p className="text-sm text-success">Applied. Reload the row to see it.</p>
        </div>
      ) : (phase === "review" || phase === "applying") && draft ? (
        <div className="mt-4 space-y-5 text-sm">
          <div>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={useSummary}
                onChange={(e) => setUseSummary(e.target.checked)}
                className="mt-1 h-3.5 w-3.5 accent-[var(--accent)]"
              />
              <span className="min-w-0 flex-1">
                <span className={label}>Summary</span>
                {currentSummary && (
                  <span className="mt-1 block text-xs text-muted line-through">{currentSummary}</span>
                )}
                <span className="mt-1 block">{draft.summary}</span>
              </span>
            </label>
          </div>

          {draft.highlights.length > 0 && (
            <div>
              <span className={label}>Highlights ({chosenHighlights.size}/{draft.highlights.length})</span>
              <ul className="mt-1.5 space-y-1.5">
                {draft.highlights.map((h, i) => (
                  <li key={i}>
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        checked={chosenHighlights.has(i)}
                        onChange={(e) =>
                          setChosenHighlights((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(i);
                            else next.delete(i);
                            return next;
                          })
                        }
                        className="mt-1 h-3.5 w-3.5 accent-[var(--accent)]"
                      />
                      <span>{h}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {draft.skills.length > 0 && (
            <div>
              <span className={label}>
                Skills ({chosenSkills.size}/{draft.skills.length}) — new ones are unticked by default
              </span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {draft.skills.map((s) => (
                  <label
                    key={s.slug}
                    title={s.evidence}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 text-xs ${
                      chosenSkills.has(s.slug) ? "border-accent text-accent" : "border-hairline text-muted"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={chosenSkills.has(s.slug)}
                      onChange={(e) =>
                        setChosenSkills((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(s.slug);
                          else next.delete(s.slug);
                          return next;
                        })
                      }
                      className="h-3 w-3 accent-[var(--accent)]"
                    />
                    {s.name}
                    {s.isNew && (
                      <span className="font-mono text-[9px] uppercase tracking-widest text-[var(--warn)]">
                        new
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {draft.blocks.length > 0 && (
            <div>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={useBody}
                  onChange={(e) => setUseBody(e.target.checked)}
                  className="mt-1 h-3.5 w-3.5 accent-[var(--accent)]"
                />
                <span>
                  <span className={label}>Page body ({draft.blocks.length} blocks)</span>
                  <span className="mt-1 block text-xs text-muted">
                    {draft.blocks.map((b) => b.type).join(" · ")}
                  </span>
                  <span className="mt-1 block text-xs text-[var(--warn)]">
                    Replaces the current body entirely.
                  </span>
                </span>
              </label>
            </div>
          )}

          {draft.keywords.length > 0 && (
            <div>
              <span className={label}>Keywords — for your reference, not saved</span>
              <p className="mt-1 text-xs text-muted">{draft.keywords.join(" · ")}</p>
            </div>
          )}

          {problem && <p className="text-sm text-danger">{problem}</p>}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={apply}
              disabled={pending}
              className="rounded-[var(--radius)] bg-accent px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-accent-ink disabled:opacity-50"
            >
              {phase === "applying" ? "Applying…" : "Apply selected"}
            </button>
            <button
              type="button"
              onClick={() => { setPhase("idle"); setDraft(null); }}
              className="font-mono text-[11px] uppercase tracking-widest text-muted hover:text-text"
            >
              discard
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <label className={label}>What did you do? A paragraph is plenty.</label>
            <textarea
              rows={5}
              value={paragraph}
              onChange={(e) => setParagraph(e.target.value)}
              placeholder="Owned the retrieval stack. Rebuilt it around hybrid search with a cross-encoder reranker, which took answer groundedness from 71% to 92% on our eval set…"
              className="mt-1 w-full resize-y rounded-[var(--radius)] border border-hairline bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowPrompt((v) => !v)}
            className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-accent"
          >
            {showPrompt ? "hide" : "edit"} instructions
          </button>

          {showPrompt && (
            <textarea
              rows={8}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full resize-y rounded-[var(--radius)] border border-hairline bg-bg px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent"
            />
          )}

          {problem && <p className="text-sm text-danger">{problem}</p>}

          <button
            type="button"
            onClick={generate}
            disabled={pending || paragraph.trim().length < 40}
            className="rounded-[var(--radius)] bg-accent px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-accent-ink disabled:opacity-50"
          >
            {phase === "drafting" ? "Drafting…" : "Draft"}
          </button>

          <p className="text-xs text-muted">
            Nothing is saved until you review and apply. The model is instructed not to invent
            numbers — check anyway.
          </p>
        </div>
      )}
    </div>
  );
}
