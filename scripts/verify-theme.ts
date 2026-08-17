/*
  Guards two properties of the theme system that are easy to break by accident
  and invisible until someone loads the site in the wrong mode:

   1. TOKEN PARITY — every token must have a value on bare `:root`, and the
      `[data-theme="dark"]` block must match the `prefers-color-scheme` block
      exactly. A token defined only inside a media query is undefined for anyone
      who has explicitly toggled themes; a token in one dark path but not the
      other means the toggle and the OS setting disagree.

   2. CONTRAST — every foreground/background pair the UI actually uses must
      clear WCAG AA (4.5:1) in BOTH modes.

  Reads the real globals.css, so it can't drift from what ships.
  Run: npx tsx scripts/verify-theme.ts
*/

import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Extracts the body of the block whose selector starts at `marker`. */
function block(marker: string): string {
  const start = CSS.indexOf(marker);
  if (start === -1) throw new Error(`Block not found in globals.css: ${marker}`);
  let depth = 0;
  const open = CSS.indexOf("{", start);
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}") {
      depth--;
      if (depth === 0) return CSS.slice(open + 1, i);
    }
  }
  throw new Error(`Unbalanced braces after ${marker}`);
}

function tokens(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of body.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

/* --- colour maths ----------------------------------------------------- */

function parseHex(h: string): [number, number, number, number] {
  let s = h.replace("#", "").trim();
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  // 8-digit hex carries alpha; used for grid/glow/border tints.
  const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
  return [r, g, b, a];
}

const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* --- 1. token parity -------------------------------------------------- */

console.log("\n── token parity ──");

const base = tokens(block(":root {"));
const dark = tokens(block(':root[data-theme="dark"] {'));
const media = tokens(block("@media (prefers-color-scheme: dark)"));

const missingBase = [...dark.keys()].filter((t) => !base.has(t));
check("every dark token has a light base value", missingBase.length === 0, missingBase.join(", "));

const mediaMissingBase = [...media.keys()].filter((t) => !base.has(t));
check("every media-query token has a light base value", mediaMissingBase.length === 0, mediaMissingBase.join(", "));

const darkOnly = [...dark.keys()].filter((t) => !media.has(t));
const mediaOnly = [...media.keys()].filter((t) => !dark.has(t));
check("toggle and OS-preference define the same token set", darkOnly.length === 0 && mediaOnly.length === 0,
  [...darkOnly.map((t) => `${t} missing from @media`), ...mediaOnly.map((t) => `${t} missing from [data-theme]`)].join(", "));

const divergent = [...dark.entries()].filter(([t, v]) => media.get(t) !== v);
check("toggle and OS-preference agree on every value", divergent.length === 0,
  divergent.map(([t]) => t).join(", "));

/* --- 2. contrast ------------------------------------------------------ */

const AA = 4.5;

/** Pairs the UI genuinely renders. Keep in sync when adding surfaces. */
const PAIRS: Array<[fg: string, bg: string, label: string]> = [
  ["--text", "--bg", "body text on page"],
  ["--text", "--surface", "text on card"],
  ["--text", "--elevated", "text on raised surface"],
  ["--muted", "--bg", "muted text on page"],
  ["--muted", "--surface", "muted text on card"],
  ["--accent", "--bg", "accent text/links on page"],
  ["--accent", "--surface", "accent on card"],
  ["--accent-ink", "--accent", "button label on accent fill"],
  ["--accent-soft", "--bg", "accent-soft as text"],
  ["--invite", "--bg", "tour invitation on page"],
  ["--success", "--bg", "success text"],
  ["--warn", "--bg", "warning text"],
  ["--danger", "--bg", "error text"],
  ["--text", "--callout-bg", "callout text"],
  ["--accent", "--callout-bg", "callout icon"],
];

for (const [mode, overrides] of [["LIGHT", new Map()], ["DARK", dark]] as const) {
  console.log(`\n── contrast · ${mode} ──`);
  const resolve = (name: string) => overrides.get(name) ?? base.get(name)!;

  for (const [fgToken, bgToken, label] of PAIRS) {
    const fg = resolve(fgToken);
    const bg = resolve(bgToken);
    if (!fg || !bg) {
      check(label, false, `unresolved token ${!fg ? fgToken : bgToken}`);
      continue;
    }
    if (!fg.startsWith("#") || !bg.startsWith("#")) continue;

    const ratio = contrast(fg, bg);
    check(`${label} (${fgToken} on ${bgToken})`, ratio >= AA, `${ratio.toFixed(2)}:1`);
  }
}

/*
  The reading surface.

  Four preferences, defaulted in CSS so the styles hold before anything
  hydrates and for anyone who never opens the panel. The measure has to apply
  to running text only — a diagram or a code sample cropped to sixty-eight
  characters is worse than one that scrolls.
*/
console.log("\n── reading preferences ──");
{
  const reading = CSS.slice(CSS.indexOf(".reading {"));
  for (const token of ["--reading-font", "--reading-size", "--reading-measure", "--reading-leading"]) {
    check(`${token} has a default`, new RegExp(`${token}:\\s*\\S`).test(reading.slice(0, 400)));
  }
  check(
    "the measure constrains prose, not the column",
    /\.reading p,[\s\S]{0,120}max-width: var\(--reading-measure\)/.test(reading),
  );
  /*
    Headings stay in the display face whatever the body is set to. The contrast
    between the two is what makes a page scannable, and setting both in one
    serif collapses it.
  */
  check(
    "headings keep the display face",
    /\.reading h2,[\s\S]{0,120}font-family: var\(--font-display\)/.test(reading),
  );
  check("a reading face is registered", /--font-reading:/.test(CSS));
}

console.log(
  failures === 0
    ? "\nTheme system verified: parity holds and every pair clears AA in both modes.\n"
    : `\n${failures} theme check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
