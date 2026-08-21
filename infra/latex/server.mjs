import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
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
const LOG_TAIL = 4000;

// Cloud Run sets these; empty when running under plain docker.
const REVISION = process.env.K_REVISION ?? null;
const SERVICE = process.env.K_SERVICE ?? null;

/*
  The instance id isn't an environment variable — it comes from the metadata
  server, which only exists on Cloud Run. Fetched once and cached, and a
  failure is not worth reporting: locally there is simply no such thing.
*/
let instanceId = null;
let instanceLookedUp = false;
async function instance() {
  if (instanceLookedUp) return instanceId;
  instanceLookedUp = true;
  try {
    const res = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/id", {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) instanceId = (await res.text()).trim();
  } catch {
    /* not on Cloud Run */
  }
  return instanceId;
}

async function compile(tex) {
  const dir = await mkdtemp(join(tmpdir(), "tex-"));
  const texPath = join(dir, "doc.tex");

  /*
    Timings per stage, because "the compile is slow" and "the extraction is
    slow" have completely different causes and the caller cannot tell them
    apart from a single total.
  */
  const timings = {};
  let stdout = "";

  try {
    await writeFile(texPath, tex, "utf8");

    for (let pass = 0; pass < PASSES; pass++) {
      const started = Date.now();
      const result = await run(
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
      timings[`pass${pass + 1}Ms`] = Date.now() - started;
      stdout += `── pass ${pass + 1} ──\n${result.stdout ?? ""}${result.stderr ?? ""}`;
    }

    const pdfPath = join(dir, "doc.pdf");
    const pdf = await readFile(pdfPath);

    /*
      Extract the text here rather than shipping the PDF somewhere to be read.
      What an ATS sees is the only thing worth checking, and pdftotext is
      already in this image — the caller has no PDF toolchain at all.
    */
    let text = "";
    const extractStarted = Date.now();
    try {
      await run("pdftotext", ["-layout", pdfPath, join(dir, "doc.txt")], { timeout: 15_000 });
      text = await readFile(join(dir, "doc.txt"), "utf8");
    } catch {
      // A failed extraction is worth reporting as empty, not as a failed
      // compile — the PDF is fine and the caller can decide.
    }
    timings.extractMs = Date.now() - extractStarted;

    /*
      The log is read on success too. A compile that worked can still say
      something worth seeing — an overfull box, a substituted font, a missing
      glyph — and none of that is visible from the PDF.
    */
    const log = await readFile(join(dir, "doc.log"), "utf8").catch(() => "");

    return { ok: true, pdf, text, texLog: log.slice(-LOG_TAIL), stdout, timings };
  } catch (err) {
    // The useful part of a several-thousand-line log is the first line
    // beginning with "!". Return the tail so a failure is actionable.
    const log = await readFile(join(dir, "doc.log"), "utf8").catch(() => "");
    const first = log.split("\n").find((l) => l.startsWith("!"));
    return {
      ok: false,
      error: first ?? String(err?.message ?? err),
      texLog: log.slice(-LOG_TAIL),
      stdout,
      timings,
    };
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
  /*
    Echoed back and written into this request's log line. Cloud Logging parses
    a JSON line on stdout into jsonPayload, so the id becomes a field the
    caller can filter on rather than a string to grep for — which is what lets
    the admin panel pull the platform's record of one specific compile.
  */
  const requestId = req.headers["x-request-id"] ?? randomUUID();
  const receivedAt = Date.now();

  /** One JSON line per request. Structured, so it is queryable. */
  const emit = (fields) => {
    console.log(
      JSON.stringify({
        requestId,
        service: SERVICE,
        revision: REVISION,
        totalMs: Date.now() - receivedAt,
        ...fields,
      }),
    );
  };

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
    // Logged at warning so a misconfigured caller is findable, but without the
    // presented value — that would put a near-miss credential in the log.
    emit({ severity: "WARNING", event: "unauthorised" });
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
  const instanceIdValue = await instance();

  /*
    Identity on the response headers as well as in the JSON body. The raw-PDF
    path below has nowhere to put them, and a caller talking to an older or
    newer deployment than it expects should still be able to say which
    revision answered it.
  */
  const identity = {
    "X-Request-Id": requestId,
    ...(REVISION ? { "X-Cloud-Run-Revision": REVISION } : {}),
    ...(instanceIdValue ? { "X-Cloud-Run-Instance": instanceIdValue } : {}),
  };

  if (!result.ok) {
    emit({ severity: "ERROR", event: "compile_failed", error: result.error, timings: result.timings });
    res.writeHead(422, { "Content-Type": "text/plain", ...identity });
    res.end(`${result.error}\n\n${result.texLog ?? ""}`);
    return;
  }

  const pages = result.text.split("\f").filter((p) => p.trim()).length;
  emit({ severity: "INFO", event: "compile_ok", pages, bytes: result.pdf.length, timings: result.timings });

  // JSON carries the extracted text as well; the default stays raw bytes so an
  // existing caller keeps working.
  if ((req.headers.accept ?? "").includes("application/json")) {
    const body = JSON.stringify({
      pdfBase64: result.pdf.toString("base64"),
      text: result.text,
      pages,
      texLog: result.texLog,
      stdout: result.stdout,
      timings: result.timings,
      revision: REVISION,
      instance: instanceIdValue,
    });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      ...identity,
    });
    res.end(body);
    return;
  }

  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Length": result.pdf.length,
    ...identity,
  });
  res.end(result.pdf);
}).listen(PORT, () => {
  console.log(`latex compiler listening on ${PORT}`);
});
