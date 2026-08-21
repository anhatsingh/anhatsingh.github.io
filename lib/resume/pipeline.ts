import { getPortfolio } from "@/lib/content";
import { confirmFidelity, reviseResume } from "@/lib/ai/resume";
import { auditExtractionDetailed, hasErrors, type AuditFinding, type AuditStep } from "@/lib/resume/audit";
import { compileTex, type CompileTrace } from "@/lib/resume/compile";
import { renderResume } from "@/lib/resume/render";
import { saveResume } from "@/lib/resume/store";
import { uploadResumePdf } from "@/lib/storage";
import type { Resume, ResumeMeta } from "@/lib/resume/schema";

/*
  The resume pipeline, as something you can watch.

  It used to be one server action that returned everything at the end. That is
  the wrong shape for work that takes half a minute: two compiles and up to two
  model calls happen behind a button that says "Compiling and checking…", and
  a visitor cannot tell a slow fidelity check from a hung request.

  So it is a generator. Each stage announces itself before it starts and
  reports when it finishes, and the caller decides what to do with that — the
  route streams it, and nothing here knows about HTTP.

  The ATS checks are the reason this was worth doing beyond a progress bar. An
  audit that only reports failures is silent when it passes, which is
  indistinguishable from an audit that never ran — and it never running is
  exactly the bug that was in here. Now every check reports itself.
*/

export type PipelineEvent =
  /** A stage starting. The message is written to be read by a human, live. */
  | { type: "stage"; stage: string; message: string }
  | { type: "compiled"; trace: CompileTrace; ok: boolean }
  | {
      type: "audited";
      /** Which pass — the second only exists when a revision happened. */
      pass: number;
      steps: AuditStep[];
      findings: AuditFinding[];
    }
  | { type: "fidelity"; ok: boolean; findings: AuditFinding[]; note: string }
  | { type: "note"; message: string }
  | { type: "checked"; result: CheckOutcome }
  | { type: "saved"; slug: string; pdfUrl: string }
  | { type: "failed"; error: string; blockedBy?: AuditFinding[] };

export interface CheckOutcome {
  resume: Resume;
  findings: AuditFinding[];
  revised: boolean;
  pages: number;
  /** Data URL, so the draft can be previewed before anything is stored. */
  previewPdf: string;
}

/** Base64 data URL, so a preview needs no storage and leaves nothing behind. */
function toDataUrl(pdf: Uint8Array): string {
  return `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`;
}

function summarise(steps: AuditStep[]): string {
  const problems = steps.reduce((n, s) => n + s.problems, 0);
  const examined = steps.reduce((n, s) => n + s.examined, 0);
  return problems
    ? `${steps.length} checks over ${examined} items — ${problems} problem${problems === 1 ? "" : "s"}`
    : `${steps.length} checks over ${examined} items — all clean`;
}

/**
 * Compiles a draft, reads the PDF back, and fixes what is wrong.
 *
 * The order matters. Deterministic checks run first because they are cheap and
 * never disagree with themselves — they catch missing content, mangled
 * headings, leaked escapes. Only then is the model asked to judge fidelity,
 * which is the part no rule can decide.
 *
 * One revision round, not a loop. A second pass that still fails usually means
 * the source data is thin rather than the wording wrong, and a human reading
 * the findings will get further than another attempt.
 *
 * Nothing is written here. The result is a proposal and a preview.
 */
export async function* runCheck(input: {
  resume: Resume;
  jobDescription: string;
}): AsyncGenerator<PipelineEvent> {
  yield { type: "stage", stage: "render", message: "Rendering LaTeX from the draft" };
  const tex = renderResume(input.resume);
  yield { type: "note", message: `${(tex.length / 1024).toFixed(1)}KB of LaTeX` };

  yield { type: "stage", stage: "compile", message: "Compiling — two passes, then extracting the text" };
  const compiled = await compileTex(tex);
  yield { type: "compiled", trace: compiled.trace, ok: compiled.ok };

  if (!compiled.ok) {
    yield { type: "failed", error: `LaTeX: ${compiled.error}` };
    return;
  }

  yield { type: "stage", stage: "audit", message: "Checking what an ATS would read back" };
  const first = auditExtractionDetailed(input.resume, compiled.text, compiled.pages);
  yield { type: "audited", pass: 1, steps: first.steps, findings: first.findings };
  yield { type: "note", message: summarise(first.steps) };

  /*
    The model's judgement, and the slowest thing here — which is most of why
    this streams at all. Announced before it starts so the wait is explained
    rather than merely endured.
  */
  yield { type: "stage", stage: "fidelity", message: "Asking the model whether the PDF still says what the record says" };
  const fidelity = await confirmFidelity(input.resume, compiled.text);
  let findings = fidelity.ok ? [...first.findings, ...fidelity.findings] : first.findings;
  yield {
    type: "fidelity",
    ok: fidelity.ok,
    findings: fidelity.ok ? fidelity.findings : [],
    note: fidelity.ok
      ? fidelity.findings.length
        ? `${fidelity.findings.length} thing${fidelity.findings.length === 1 ? "" : "s"} the model flagged`
        : "nothing overstated"
      : "the fidelity check didn't complete — the deterministic checks still stand",
  };

  // Warnings are for a human to weigh; only errors are worth spending a
  // revision round and another compile on.
  if (!hasErrors(findings)) {
    yield {
      type: "checked",
      result: {
        resume: input.resume,
        findings,
        revised: false,
        pages: compiled.pages,
        previewPdf: toDataUrl(compiled.pdf),
      },
    };
    return;
  }

  yield { type: "stage", stage: "revise", message: "Rewriting what failed, then compiling again" };
  const revision = await reviseResume(input.resume, findings, input.jobDescription, await getPortfolio());

  if (!revision.ok) {
    yield { type: "note", message: "The revision didn't come back; the original stands." };
    yield {
      type: "checked",
      result: {
        resume: input.resume,
        findings,
        revised: false,
        pages: compiled.pages,
        previewPdf: toDataUrl(compiled.pdf),
      },
    };
    return;
  }

  const recompiled = await compileTex(renderResume(revision.resume));
  yield { type: "compiled", trace: recompiled.trace, ok: recompiled.ok };

  if (!recompiled.ok) {
    // The revision broke the build, so the original stands — better a document
    // with known flaws than none at all. Both traces have been emitted, which
    // is what makes it possible to see what the revision did to break it.
    yield { type: "note", message: "The revision broke the build, so the original stands." };
    yield {
      type: "checked",
      result: {
        resume: input.resume,
        findings,
        revised: false,
        pages: compiled.pages,
        previewPdf: toDataUrl(compiled.pdf),
      },
    };
    return;
  }

  yield { type: "stage", stage: "audit", message: "Re-checking the revised document" };
  const second = auditExtractionDetailed(revision.resume, recompiled.text, recompiled.pages);
  yield { type: "audited", pass: 2, steps: second.steps, findings: second.findings };
  yield { type: "note", message: summarise(second.steps) };

  const afterFidelity = await confirmFidelity(revision.resume, recompiled.text);
  findings = afterFidelity.ok ? [...second.findings, ...afterFidelity.findings] : second.findings;

  yield {
    type: "checked",
    result: {
      resume: revision.resume,
      findings,
      revised: true,
      pages: recompiled.pages,
      previewPdf: toDataUrl(recompiled.pdf),
    },
  };
}

/**
 * Renders, compiles, audits, stores the PDF, and saves the row.
 *
 * The audit here is not a duplicate of runCheck's. runCheck audits a draft;
 * this audits the bytes actually being published, and they are not always the
 * same document — bullets can be unticked, or the text edited, after a check
 * passed. Without this the audit was advisory: everything the ATS pipeline
 * exists to catch could be checked, then edited, then saved.
 *
 * `override` is the deliberate way past it, and it is the caller's to set
 * after showing a human what is wrong.
 */
export async function* runSave(input: {
  resume: Resume;
  meta: ResumeMeta;
  jobDescription: string;
  isDefault: boolean;
  isPublished: boolean;
  override?: boolean;
}): AsyncGenerator<PipelineEvent> {
  if (!input.meta.slug.trim() || !input.meta.label.trim()) {
    yield { type: "failed", error: "Give it a label and a slug first." };
    return;
  }

  yield { type: "stage", stage: "compile", message: "Compiling the document that will be published" };
  const compiled = await compileTex(renderResume(input.resume));
  yield { type: "compiled", trace: compiled.trace, ok: compiled.ok };

  if (!compiled.ok) {
    // The first line of a TeX log beginning with "!" is the only useful part of
    // several thousand; compile.ts pulls it out so this can be acted on.
    yield { type: "failed", error: `LaTeX: ${compiled.error}` };
    return;
  }

  /*
    Deterministic checks only. confirmFidelity costs a model call and belongs
    to the review step — this is the gate that stops a mechanically broken PDF
    becoming the resume people download, and it has to be cheap enough to run
    on every save.
  */
  yield { type: "stage", stage: "audit", message: "Checking the PDF being published, not the one you checked earlier" };
  const audit = auditExtractionDetailed(input.resume, compiled.text, compiled.pages);
  yield { type: "audited", pass: 1, steps: audit.steps, findings: audit.findings };
  yield { type: "note", message: summarise(audit.steps) };

  if (hasErrors(audit.findings) && !input.override) {
    yield {
      type: "failed",
      error: "This PDF doesn't read cleanly through an ATS, so it wasn't saved.",
      blockedBy: audit.findings.filter((f) => f.severity === "error"),
    };
    return;
  }

  if (input.override) {
    yield { type: "note", message: "Saving despite the problems above, because you said so." };
  }

  yield { type: "stage", stage: "upload", message: "Uploading the PDF" };
  const upload = await uploadResumePdf(compiled.pdf, input.meta.slug);
  if (!upload.ok || !upload.url) {
    yield { type: "failed", error: upload.error ?? "Upload failed." };
    return;
  }

  yield { type: "stage", stage: "store", message: "Saving the row" };
  const saved = await saveResume({
    meta: input.meta,
    resume: input.resume,
    pdfUrl: upload.url,
    jobDescription: input.jobDescription,
    isDefault: input.isDefault,
    isPublished: input.isPublished,
  });
  if (!saved.ok) {
    yield { type: "failed", error: saved.error };
    return;
  }

  yield { type: "saved", slug: saved.slug, pdfUrl: upload.url };
}
