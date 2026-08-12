import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/*
  POST a LaTeX document, get a PDF back.

  Deliberately tiny and deliberately dumb: it takes a complete .tex, runs
  pdflatex on it, and returns the bytes. It has no template, no database and no
  opinion about resumes — lib/resume/render.ts owns all of that, so this can be
  redeployed without touching the content pipeline and vice versa.

  Node's stdlib only, so there is nothing to npm install and nothing to keep
  patched.
*/

const PORT = Number(process.env.PORT ?? 8080);
const TOKEN = process.env.LATEX_SERVICE_TOKEN ?? "";
const MAX_BODY = 512 * 1024;
const TIMEOUT_MS = 40_000;
// Two passes: the first has no page count, so \fancyhf settles on the second.
const PASSES = 2;

async function compile(tex) {
  const dir = await mkdtemp(join(tmpdir(), "tex-"));
  const texPath = join(dir, "doc.tex");

  try {
    await writeFile(texPath, tex, "utf8");

    for (let pass = 0; pass < PASSES; pass++) {
      await run(
        "pdflatex",
        [
          // A generated document should never be able to run a shell command.
          "-no-shell-escape",
          "-interaction=nonstopmode",
          "-halt-on-error",
          "-output-directory",
          dir,
          texPath,
        ],
        { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, cwd: dir },
      );
    }

    const pdfPath = join(dir, "doc.pdf");
    const pdf = await readFile(pdfPath);

    /*
      Extract the text here rather than shipping the PDF somewhere to be read.
      What an ATS sees is the only thing worth checking, and pdftotext is
      already in this image — the caller has no PDF toolchain at all.
    */
    let text = "";
    try {
      await run("pdftotext", ["-layout", pdfPath, join(dir, "doc.txt")], { timeout: 15_000 });
      text = await readFile(join(dir, "doc.txt"), "utf8");
    } catch {
      // A failed extraction is worth reporting as empty, not as a failed
      // compile — the PDF is fine and the caller can decide.
    }

    return { ok: true, pdf, text };
  } catch (err) {
    // The useful part of a several-thousand-line log is the first line
    // beginning with "!". Return the tail so a failure is actionable.
    const log = await readFile(join(dir, "doc.log"), "utf8").catch(() => "");
    const first = log.split("\n").find((l) => l.startsWith("!"));
    return { ok: false, error: first ?? String(err?.message ?? err), log: log.slice(-4000) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      // Refuse oversized bodies rather than buffering them: a resume is a few
      // kilobytes, and anything near this cap is not one.
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

createServer(async (req, res) => {
  // Cloud Run pings this; keeping it free of auth means a health check needs no
  // secret.
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("POST a .tex document");
    return;
  }

  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.writeHead(401, { "Content-Type": "text/plain" });
    res.end("unauthorised");
    return;
  }

  let tex;
  try {
    tex = await readBody(req);
  } catch {
    res.writeHead(413, { "Content-Type": "text/plain" });
    res.end("document too large");
    return;
  }

  if (!tex.includes("\\documentclass")) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("that doesn't look like a LaTeX document");
    return;
  }

  const result = await compile(tex);

  if (!result.ok) {
    res.writeHead(422, { "Content-Type": "text/plain" });
    res.end(`${result.error}\n\n${result.log ?? ""}`);
    return;
  }

  // JSON carries the extracted text as well; the default stays raw bytes so an
  // existing caller keeps working.
  if ((req.headers.accept ?? "").includes("application/json")) {
    const body = JSON.stringify({
      pdfBase64: result.pdf.toString("base64"),
      text: result.text,
      pages: result.text.split("\f").filter((p) => p.trim()).length,
    });
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
    return;
  }

  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Length": result.pdf.length,
  });
  res.end(result.pdf);
}).listen(PORT, () => {
  console.log(`latex compiler listening on ${PORT}`);
});
