/*
  Verifies Google Drive share links get converted into direct-download links.

  This is the part most likely to silently not work: a Drive "Copy link" URL
  opens a preview page, and the `download` attribute is ignored cross-origin, so
  a Download button wired to the raw URL looks fine and simply doesn't download.

  Run: npx tsx scripts/verify-resume.ts
*/

import { resumeLinks } from "../lib/resume";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const ID = "1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv";

console.log("\n── Drive URL shapes ──");

const shapes: Array<[label: string, url: string]> = [
  ["Copy link (the common one)", `https://drive.google.com/file/d/${ID}/view?usp=sharing`],
  ["Copy link, no query", `https://drive.google.com/file/d/${ID}/view`],
  ["usp=drive_link variant", `https://drive.google.com/file/d/${ID}/view?usp=drive_link`],
  ["legacy open?id=", `https://drive.google.com/open?id=${ID}`],
  ["already a uc download link", `https://drive.google.com/uc?export=download&id=${ID}`],
  ["Google Docs document", `https://docs.google.com/document/d/${ID}/edit`],
];

for (const [label, url] of shapes) {
  const links = resumeLinks(url);
  const ok =
    !!links &&
    links.isGoogleDrive &&
    links.downloadUrl === `https://drive.google.com/uc?export=download&id=${ID}` &&
    links.viewUrl === `https://drive.google.com/file/d/${ID}/view`;
  check(label, ok, links ? links.downloadUrl : "returned null");
}

console.log("\n── non-Drive URLs pass through ──");
const selfHosted = resumeLinks("https://anhatsingh.com/cv.pdf");
check("self-hosted PDF untouched", selfHosted?.downloadUrl === "https://anhatsingh.com/cv.pdf");
check("not flagged as Drive", selfHosted?.isGoogleDrive === false);

const dropbox = resumeLinks("https://www.dropbox.com/s/abc/cv.pdf?dl=1");
check("dropbox untouched", dropbox?.downloadUrl === "https://www.dropbox.com/s/abc/cv.pdf?dl=1");

console.log("\n── invalid input returns null (button hides) ──");
for (const [label, value] of [
  ["empty string", ""],
  ["whitespace only", "   "],
  ["undefined", undefined],
  ["not a URL", "my-resume.pdf"],
  ["javascript: scheme", "javascript:alert(1)"],
  ["data: scheme", "data:text/html,<script>alert(1)</script>"],
] as Array<[string, string | undefined]>) {
  check(label, resumeLinks(value) === null);
}

console.log("\n── hostname matching is not substring-based ──");
// A lookalike domain must NOT be treated as Drive, or we'd rewrite an
// attacker-controlled URL into something that looks first-party.
const lookalike = resumeLinks(`https://drive.google.com.evil.test/file/d/${ID}/view`);
check("drive.google.com.evil.test is not treated as Drive", lookalike?.isGoogleDrive === false);
check("lookalike URL is left exactly as pasted",
  lookalike?.downloadUrl === `https://drive.google.com.evil.test/file/d/${ID}/view`);

console.log(failures === 0 ? "\nAll resume-link checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
