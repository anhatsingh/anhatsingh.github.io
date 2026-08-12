import { execFile } from "node:child_process";
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
*/

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
    }
  | { ok: false; error: string; log?: string };

/** Compiles twice: the first pass has no page count, so \fancyhf settles on the second. */
const PASSES = 2;

const TIMEOUT_MS = 45_000;

async function compileLocal(tex: string): Promise<CompileResult> {
  const dir = await mkdtemp(join(tmpdir(), "resume-"));
  const texPath = join(dir, "resume.tex");

  try {
    await writeFile(texPath, tex, "utf8");

    for (let pass = 0; pass < PASSES; pass++) {
      try {
        await run(
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
      } catch (err) {
        // pdflatex exits non-zero on error but still writes a .log worth reading.
        const log = await readFile(join(dir, "resume.log"), "utf8").catch(() => "");
        return {
          ok: false,
          error: firstTexError(log) ?? (err as Error).message,
          log: log.slice(-4000),
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

    return { ok: true, pdf: new Uint8Array(pdf), text, pages: countPages(text) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function compileRemote(tex: string, url: string): Promise<CompileResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-tex",
        // Asks for the extracted text alongside the bytes.
        Accept: "application/json",
        ...(process.env.LATEX_SERVICE_TOKEN
          ? { Authorization: `Bearer ${process.env.LATEX_SERVICE_TOKEN}` }
          : {}),
      },
      body: tex,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Compiler returned ${res.status}.`, log: detail.slice(-4000) };
    }

    if (res.headers.get("content-type")?.includes("application/json")) {
      const body = (await res.json()) as { pdfBase64: string; text: string; pages: number };
      return {
        ok: true,
        pdf: Uint8Array.from(Buffer.from(body.pdfBase64, "base64")),
        text: body.text ?? "",
        pages: body.pages ?? countPages(body.text ?? ""),
      };
    }

    // An older deployment that only speaks PDF still works, without an audit.
    const pdf = new Uint8Array(await res.arrayBuffer());
    return { ok: true, pdf, text: "", pages: 0 };
  } catch (err) {
    return { ok: false, error: `Couldn't reach the compiler: ${(err as Error).message}` };
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
  return url ? compileRemote(tex, url) : compileLocal(tex);
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
