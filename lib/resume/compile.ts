import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/*
  LaTeX -> PDF.

  Two backends, chosen by whether LATEX_SERVICE_URL is set:

    local   pdflatex on PATH. What runs during development and in the verify
            script, so escaping bugs surface on a laptop rather than in prod.
    remote  POST to a container running the same toolchain. Vercel functions
            cannot host a TeX installation.

  It must be pdflatex specifically. The template's \pdfgentounicode=1 — the
  line that makes the PDF's text extractable, and therefore the line the whole
  ATS story rests on — is a pdfTeX primitive that xelatex, lualatex and
  tectonic do not have.

  Every compile carries a trace back, success or failure. Until recently the
  TeX log was captured on failure and then dropped by the caller, so a broken
  compile in production showed one red line in the admin and nothing else. The
  log is the only thing that explains a TeX failure, and a duration is the only
  thing that explains a slow one.
*/

/*
  What the compiler did, for the click that asked.

  Shared by both backends so the admin panel has no branch in it: a compile on
  a laptop and a compile on Cloud Run produce the same shape, and only the
  fields the remote service knows about (revision, instance) come back null
  locally.

  startedAt/finishedAt are ISO on purpose — they become the time window for
  the Cloud Logging query in lib/gcp/logs.ts, which is how a request here is
  matched to the platform's own record of it.
*/
export interface CompileTrace {
  requestId: string;
  backend: "local" | "remote";
  /** HTTP status from the service. 0 for a local compile, which has none. */
  status: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  /** Cloud Run's K_REVISION and instance id, when the service reports them. */
  revision: string | null;
  instance: string | null;
  /** The tail of the TeX log — the only thing that explains a TeX failure. */
  texLog: string;
  /** pdflatex's own stdout/stderr across both passes. */
  stdout: string;
  /** Per-stage milliseconds the service measured, when it reports them. */
  timings: Record<string, number> | null;
}

export type CompileResult =
  | {
      ok: true;
      pdf: Uint8Array;
      /*
        What a text extractor reads out of the PDF — the only thing an ATS ever
        sees. Returned alongside the bytes so the audit can compare it against
        the resume it was built from without a PDF toolchain of its own.
        Empty when extraction wasn't available.
      */
      text: string;
      pages: number;
      trace: CompileTrace;
    }
  | { ok: false; error: string; trace: CompileTrace };

/** Compiles twice: the first pass has no page count, so \fancyhf settles on the second. */
const PASSES = 2;

const TIMEOUT_MS = 45_000;

/** How much of a TeX log is worth carrying. The useful part is near the end. */
const LOG_TAIL = 4000;

function blankTrace(backend: "local" | "remote", requestId: string, startedAt: number): CompileTrace {
  return {
    requestId,
    backend,
    status: 0,
    durationMs: Date.now() - startedAt,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    revision: null,
    instance: null,
    texLog: "",
    stdout: "",
    timings: null,
  };
}

async function compileLocal(tex: string, requestId: string): Promise<CompileResult> {
  const startedAt = Date.now();
  const dir = await mkdtemp(join(tmpdir(), "resume-"));
  const texPath = join(dir, "resume.tex");
  let stdout = "";

  try {
    await writeFile(texPath, tex, "utf8");

    for (let pass = 0; pass < PASSES; pass++) {
      try {
        const result = await run(
          "pdflatex",
          [
            // Never let a document run shell commands, even one we generated.
            "-no-shell-escape",
            // Don't stop for input on an error — fail and hand back the log.
            "-interaction=nonstopmode",
            "-halt-on-error",
            "-output-directory",
            dir,
            texPath,
          ],
          { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
        );
        stdout += `── pass ${pass + 1} ──\n${result.stdout}${result.stderr}`;
      } catch (err) {
        // pdflatex exits non-zero on error but still writes a .log worth reading.
        const log = await readFile(join(dir, "resume.log"), "utf8").catch(() => "");
        return {
          ok: false,
          error: firstTexError(log) ?? (err as Error).message,
          trace: {
            ...blankTrace("local", requestId, startedAt),
            texLog: log.slice(-LOG_TAIL),
            stdout,
          },
        };
      }
    }

    const pdfPath = join(dir, "resume.pdf");
    const pdf = await readFile(pdfPath);

    // Optional locally: a machine without poppler still compiles, it just
    // can't be audited, and the caller degrades rather than failing.
    let text = "";
    try {
      await run("pdftotext", ["-layout", pdfPath, join(dir, "resume.txt")], { timeout: 15_000 });
      text = await readFile(join(dir, "resume.txt"), "utf8");
    } catch {
      /* no extractor on PATH */
    }

    /*
      The log is read on success too. A compile that worked can still say
      something worth seeing — an overfull box, a substituted font, a missing
      character — and none of that is visible from the PDF alone.
    */
    const log = await readFile(join(dir, "resume.log"), "utf8").catch(() => "");

    return {
      ok: true,
      pdf: new Uint8Array(pdf),
      text,
      pages: countPages(text),
      trace: { ...blankTrace("local", requestId, startedAt), texLog: log.slice(-LOG_TAIL), stdout },
    };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message,
      trace: { ...blankTrace("local", requestId, startedAt), stdout },
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function compileRemote(tex: string, url: string, requestId: string): Promise<CompileResult> {
  const startedAt = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-tex",
        // Asks for the extracted text alongside the bytes.
        Accept: "application/json",
        /*
          Echoed by the service into its own stdout, which Cloud Logging turns
          into a queryable jsonPayload field. Without it, matching this compile
          to its platform log means guessing from timestamps.
        */
        "X-Request-Id": requestId,
        ...(process.env.LATEX_SERVICE_TOKEN
          ? { Authorization: `Bearer ${process.env.LATEX_SERVICE_TOKEN}` }
          : {}),
      },
      body: tex,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const base: CompileTrace = {
      ...blankTrace("remote", requestId, startedAt),
      status: res.status,
      /*
        Read off the response rather than the body, so they survive even when
        the body is an error string from a service too old to report them.
      */
      revision: res.headers.get("x-cloud-run-revision") ?? null,
      instance: res.headers.get("x-cloud-run-instance") ?? null,
    };

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      /*
        The service puts the offending TeX line at the top of a 422 body, so
        pull it out the same way the local backend does. Without this the two
        backends report the same failure differently — "Undefined control
        sequence" on a laptop and "Compiler returned 422" in production, which
        is the environment where it is harder to investigate.
      */
      return {
        ok: false,
        error: firstTexError(detail) ?? `Compiler returned ${res.status}.`,
        trace: { ...base, texLog: detail.slice(-LOG_TAIL) },
      };
    }

    if (res.headers.get("content-type")?.includes("application/json")) {
      const body = (await res.json()) as {
        pdfBase64: string;
        text?: string;
        pages?: number;
        texLog?: string;
        stdout?: string;
        timings?: Record<string, number>;
        revision?: string;
        instance?: string;
      };
      return {
        ok: true,
        pdf: Uint8Array.from(Buffer.from(body.pdfBase64, "base64")),
        text: body.text ?? "",
        pages: body.pages ?? countPages(body.text ?? ""),
        trace: {
          ...base,
          revision: body.revision ?? base.revision,
          instance: body.instance ?? base.instance,
          texLog: body.texLog ?? "",
          stdout: body.stdout ?? "",
          timings: body.timings ?? null,
        },
      };
    }

    // An older deployment that only speaks PDF still works, without an audit.
    const pdf = new Uint8Array(await res.arrayBuffer());
    return { ok: true, pdf, text: "", pages: 0, trace: base };
  } catch (err) {
    return {
      ok: false,
      error: `Couldn't reach the compiler: ${(err as Error).message}`,
      trace: blankTrace("remote", requestId, startedAt),
    };
  }
}

/**
 * Pages, from extracted text.
 *
 * pdftotext writes a form feed after every page including the last, so a bare
 * split reports one page too many — which reads as a spurious blank page.
 */
function countPages(text: string): number {
  return text.split("\f").filter((p) => p.trim()).length;
}

export async function compileTex(tex: string): Promise<CompileResult> {
  const url = process.env.LATEX_SERVICE_URL;
  const requestId = randomUUID();
  return url ? compileRemote(tex, url, requestId) : compileLocal(tex, requestId);
}

/**
 * Pulls the first real error out of a TeX log.
 *
 * A log is thousands of lines and the useful part is one line beginning with
 * `!`. Surfacing that instead of "Command failed with exit code 1" is the
 * difference between a fixable report and a shrug.
 */
export function firstTexError(log: string): string | null {
  const line = log.split("\n").find((l) => l.startsWith("!"));
  if (!line) return null;
  return line.replace(/^!\s*/, "").trim() || null;
}
