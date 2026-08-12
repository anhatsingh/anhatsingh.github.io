"use client";

import { useState } from "react";
import { checkResume, compileAndSaveResume, requestResumeDraft } from "@/app/admin/actions";
import type { AuditFinding } from "@/lib/resume/audit";
import type { Resume, ResumeMeta } from "@/lib/resume/schema";

/*
  Generate a resume for a job description, check it, then save.

  Three steps on purpose. Draft is a proposal; check compiles it and reads the
  PDF back the way a parser would, fixing what it finds; only then is anything
  stored. Nothing is written until it has been read by a human — the same
  discipline as the AI draft panel, and it matters more here, because a resume
  that overstates gets its owner rejected at interview rather than screened out
  at CV stage.

  The check can rewrite bullets, which is exactly why it is separate from
  saving: an automatic rewrite that went straight to storage is the kind of
  quiet change this flow exists to prevent.

  Bullets can be unticked but not rewritten. Editing prose in a form is a worse
  experience than regenerating, and every bullet is already tied to a real
  database row — if a bullet is wrong, the row behind it usually is too, and
  that is where the fix belongs.
*/

type Phase = "idle" | "drafting" | "review" | "checking" | "checked" | "saving" | "done" | "error";

export default function AdminResumePage() {
  const [jd, setJd] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState("");

  const [resume, setResume] = useState<Resume | null>(null);
  const [meta, setMeta] = useState<ResumeMeta | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const [findings, setFindings] = useState<AuditFinding[]>([]);
  const [revised, setRevised] = useState(false);
  const [pages, setPages] = useState(0);
  const [preview, setPreview] = useState("");

  const [isDefault, setIsDefault] = useState(false);
  const [isPublished, setIsPublished] = useState(true);
  const [savedUrl, setSavedUrl] = useState("");

  async function draft() {
    setPhase("drafting");
    setProblem("");
    setSavedUrl("");

    const result = await requestResumeDraft(jd);
    if (!result.ok) {
      setProblem(result.error);
      setPhase("error");
      return;
    }

    setResume(result.resume);
    setMeta(result.meta);
    setDropped(result.dropped);
    setExcluded(new Set());
    setFindings([]);
    setRevised(false);
    setPreview("");
    setPhase("review");
  }

  /*
    Compile, read the PDF back, and fix what is wrong before anything is saved.

    Separate from saving on purpose: the check can rewrite bullets, and an
    automatic rewrite that goes straight to storage is exactly the kind of
    quiet change this flow exists to prevent.
  */
  async function check() {
    if (!resume) return;
    setPhase("checking");
    setProblem("");

    const result = await checkResume({
      resume: applyExclusions(resume),
      jobDescription: jd,
    });

    if (!result.ok) {
      setProblem(result.error);
      setPhase("error");
      return;
    }

    // Exclusions are baked in by now, so the ticks reset with the new content.
    setResume(result.resume);
    setExcluded(new Set());
    setFindings(result.findings);
    setRevised(result.revised);
    setPages(result.pages);
    setPreview(result.previewPdf);
    setPhase("checked");
  }

  /** Strips unticked bullets, then drops any entry left with none. */
  function applyExclusions(source: Resume): Resume {
    const keep = <T extends { bullets: Array<{ text: string }> }>(entry: T, prefix: string): T => ({
      ...entry,
      bullets: entry.bullets.filter((b, i) => !excluded.has(`${prefix}:${i}`)),
    });

    return {
      ...source,
      experience: source.experience
        .map((e, i) => keep(e, `exp${i}`))
        .filter((e) => e.bullets.length > 0),
      projects: source.projects.map((p, i) => keep(p, `proj${i}`)).filter((p) => p.bullets.length > 0),
    };
  }

  async function save() {
    if (!resume || !meta) return;
    setPhase("saving");
    setProblem("");

    const result = await compileAndSaveResume({
      resume: applyExclusions(resume),
      meta,
      jobDescription: jd,
      isDefault,
      isPublished,
    });

    if (!result.ok) {
      setProblem(result.error);
      setPhase("error");
      return;
    }

    setSavedUrl(result.pdfUrl);
    setPhase("done");
  }

  function toggle(key: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const busy = phase === "drafting" || phase === "saving" || phase === "checking";
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");

  return (
    <div>
      <h2 className="font-display text-3xl">Generate a resume</h2>

      <div className="mt-4 rounded-[var(--radius)] border border-hairline bg-surface p-4 text-sm text-muted">
        <p>
          Paste a job description. The draft is built only from what&apos;s in your database — every
          bullet has to name the row it came from, and any that don&apos;t are dropped before you see
          them.
        </p>
        <p className="mt-2">
          Saved variants are what the chatbot picks between. It asks a visitor what role they&apos;re
          hiring for and matches their answer against the keywords below — it never sees the list, so
          it can&apos;t offer them a menu.
        </p>
      </div>

      <label className="mt-6 block font-mono text-[11px] uppercase tracking-widest text-muted">
        Job description
      </label>
      <textarea
        value={jd}
        onChange={(e) => setJd(e.target.value)}
        rows={10}
        placeholder="Paste the full posting…"
        className="mt-1.5 w-full resize-y rounded-[var(--radius)] border border-hairline bg-bg px-3 py-2 text-sm"
      />

      <button
        onClick={draft}
        disabled={busy || jd.trim().length < 80}
        className="mt-3 rounded-[var(--radius)] bg-accent px-5 py-2.5 font-mono text-xs uppercase tracking-widest text-accent-ink disabled:opacity-50"
      >
        {phase === "drafting" ? "Drafting…" : "Generate draft"}
      </button>

      {problem && <p className="mt-4 text-sm text-danger">{problem}</p>}

      {phase === "done" && savedUrl && (
        <div className="mt-6 rounded-[var(--radius)] border border-success/40 bg-success/10 p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-success">Saved</p>
          <a
            href={savedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-sm text-accent hover:underline"
          >
            Open the PDF →
          </a>
          <p className="mt-2 text-sm text-muted">
            Manage it, or turn it off, under <span className="text-text">Resumes</span>.
          </p>
        </div>
      )}

      {resume && meta && (phase === "review" || phase === "checking" || phase === "checked" || phase === "saving" || phase === "error") && (
        <div className="mt-8 space-y-6">
          {dropped.length > 0 && (
            <section className="rounded-[var(--radius)] border border-warn/40 bg-warn/10 p-4">
              <h3 className="font-mono text-xs uppercase tracking-widest text-warn">
                {dropped.length} bullet{dropped.length === 1 ? "" : "s"} dropped
              </h3>
              <p className="mt-1 text-sm text-muted">
                These cited a row that doesn&apos;t exist, which is what a fabricated bullet usually
                looks like. They were removed before you saw them.
              </p>
              <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
                {dropped.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </section>
          )}

          {phase === "checked" && (
            <section
              className={`rounded-[var(--radius)] border p-4 ${
                errors.length ? "border-danger/40 bg-danger/10" : "border-success/40 bg-success/10"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3
                  className={`font-mono text-xs uppercase tracking-widest ${
                    errors.length ? "text-danger" : "text-success"
                  }`}
                >
                  {errors.length
                    ? `${errors.length} problem${errors.length === 1 ? "" : "s"} left`
                    : "Reads cleanly through an ATS"}
                </h3>
                <span className="font-mono text-[11px] text-muted">
                  {pages} page{pages === 1 ? "" : "s"}
                  {revised && " · content was revised"}
                </span>
              </div>

              <p className="mt-1 text-sm text-muted">
                Compiled, then read back out of the PDF the way a parser would. Everything below is
                measured against that text, not the draft.
              </p>

              {findings.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {[...errors, ...warnings].map((f, i) => (
                    <li key={i} className="flex gap-2">
                      <span
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                          f.severity === "error" ? "bg-danger" : "bg-warn"
                        }`}
                        aria-hidden="true"
                      />
                      <span>
                        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
                          {f.check}
                        </span>
                        <span className="ml-2">{f.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {preview && (
                <a
                  href={preview}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block font-mono text-[11px] uppercase tracking-widest text-accent hover:underline"
                >
                  Preview the PDF →
                </a>
              )}
            </section>
          )}

          <section className="rounded-[var(--radius)] border border-hairline bg-surface p-4">
            <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Summary</h3>
            <p className="mt-2 text-sm leading-relaxed">{resume.summary.text}</p>
          </section>

          <Group title="Experience">
            {resume.experience.map((e, i) => (
              <Entry key={`${e.company}-${i}`} heading={`${e.title} · ${e.company}`} meta={e.dates}>
                {e.bullets.map((b, j) => (
                  <BulletRow
                    key={j}
                    text={b.text}
                    source={b.sourceId}
                    checked={!excluded.has(`exp${i}:${j}`)}
                    onToggle={() => toggle(`exp${i}:${j}`)}
                  />
                ))}
              </Entry>
            ))}
          </Group>

          <Group title="Projects">
            {resume.projects.map((p, i) => (
              <Entry key={`${p.name}-${i}`} heading={p.name} meta={p.dates ?? ""}>
                {p.bullets.map((b, j) => (
                  <BulletRow
                    key={j}
                    text={b.text}
                    source={b.sourceId}
                    checked={!excluded.has(`proj${i}:${j}`)}
                    onToggle={() => toggle(`proj${i}:${j}`)}
                  />
                ))}
              </Entry>
            ))}
          </Group>

          <section className="rounded-[var(--radius)] border border-hairline bg-surface p-4">
            <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
              How the chatbot finds this one
            </h3>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Label" help="Shown when a visitor asks to see every version.">
                <input
                  value={meta.label}
                  onChange={(e) => setMeta({ ...meta, label: e.target.value })}
                  className="w-full rounded-[var(--radius)] border border-hairline bg-bg px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Slug" help="Also the PDF filename. Re-saving replaces that file.">
                <input
                  value={meta.slug}
                  onChange={(e) => setMeta({ ...meta, slug: e.target.value })}
                  className="w-full rounded-[var(--radius)] border border-hairline bg-bg px-3 py-2 font-mono text-sm"
                />
              </Field>
            </div>

            <Field
              label="Keywords"
              help="One per line. Matched against what a visitor says they're hiring for, so include the spellings people actually use — ML, machine learning and MLE are three."
            >
              <textarea
                value={meta.keywords.join("\n")}
                onChange={(e) =>
                  setMeta({ ...meta, keywords: e.target.value.split("\n").map((k) => k.trim()).filter(Boolean) })
                }
                rows={6}
                className="w-full resize-y rounded-[var(--radius)] border border-hairline bg-bg px-3 py-2 font-mono text-sm"
              />
            </Field>

            <div className="mt-3 flex flex-wrap gap-5">
              <Toggle checked={isPublished} onChange={setIsPublished} label="Active" />
              <Toggle
                checked={isDefault}
                onChange={setIsDefault}
                label="Use as the fallback"
                help="Served when nothing matches well enough. Only one can hold this."
              />
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={check}
              disabled={busy}
              className="rounded-[var(--radius)] border border-accent px-5 py-2.5 font-mono text-xs uppercase tracking-widest text-accent transition-colors hover:bg-accent hover:text-accent-ink disabled:opacity-50"
            >
              {phase === "checking" ? "Compiling and checking…" : "Compile and check"}
            </button>

            {/* Saving is only offered once the document has actually been
                built and read back — there is nothing to judge before that. */}
            <button
              onClick={save}
              disabled={busy || phase !== "checked"}
              title={phase === "checked" ? undefined : "Run the check first"}
              className="rounded-[var(--radius)] bg-accent px-5 py-2.5 font-mono text-xs uppercase tracking-widest text-accent-ink disabled:opacity-50"
            >
              {phase === "saving" ? "Saving…" : "Save this version"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  if (Array.isArray(items) && items.length === 0) return null;
  return (
    <section>
      <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">{title}</h3>
      <div className="mt-2 space-y-3">{items}</div>
    </section>
  );
}

function Entry({
  heading,
  meta,
  children,
}: {
  heading: string;
  meta: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-hairline bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{heading}</span>
        <span className="font-mono text-[11px] text-muted">{meta}</span>
      </div>
      <ul className="mt-2 space-y-1.5">{children}</ul>
    </div>
  );
}

function BulletRow({
  text,
  source,
  checked,
  onToggle,
}: {
  text: string;
  source: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
        />
        <span className={`min-w-0 ${checked ? "" : "line-through opacity-50"}`}>
          <span className="block text-sm leading-relaxed">{text}</span>
          <span className="block font-mono text-[10px] text-muted">{source}</span>
        </span>
      </label>
    </li>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <label className="block font-mono text-[11px] uppercase tracking-widest text-muted">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {help && <p className="mt-1 text-xs text-muted">{help}</p>}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  help,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  help?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
      />
      <span>
        <span className="block font-mono text-[11px] uppercase tracking-widest text-muted">
          {label}
        </span>
        {help && <span className="block text-xs text-muted">{help}</span>}
      </span>
    </label>
  );
}
