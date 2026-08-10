/*
  Checks how a logo plate sizes itself against the real logos in use.

  The complaint this was written for: a 200x60 wordmark rendered inside a fixed
  60x60 square came out about 18px tall, surrounded by white on all sides. The
  numbers below are the actual dimensions of the files on the site, so a
  regression in the sizing maths shows up as a logo that stops filling its
  plate rather than as a test that merely passes in the abstract.

  Run: npx tsx scripts/verify-logos.ts
*/

import { plateSize } from "../components/ui/logo-plate";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const SIZE = 60;
const SLOT = Math.round(SIZE * 1.75); // 105

/** The logos actually stored on the site, after trimming. */
const REAL: Array<[string, number, number]> = [
  ["Dom Ventas (wordmark)", 200, 60],
  ["Axtria (wordmark)", 182, 63],
  ["IIT Madras", 200, 164],
  ["Busineswise (square)", 200, 200],
  ["Mavenzeit (tall-ish)", 161, 175],
];

console.log("\n── plate hugs each real logo ──");
for (const [name, w, h] of REAL) {
  const aspect = w / h;
  const { width, height } = plateSize(SIZE, SLOT, aspect);

  // The whole point: the plate's shape matches the logo's, so object-contain
  // has nothing left to letterbox.
  const plateAspect = width / height;
  const drift = Math.abs(plateAspect - aspect) / aspect;
  check(
    `${name} — plate ${width}x${height} matches the logo's shape`,
    drift < 0.03,
    `logo ${aspect.toFixed(2)} vs plate ${plateAspect.toFixed(2)}`,
  );

  check(`${name} — fits inside the slot`, width <= SLOT && height <= SIZE, `${width}x${height}`);

  // Guards the actual bug: a wordmark rendering as a sliver in a tall box.
  const fill = (width * height) / (SLOT * SIZE);
  check(`${name} — plate is not mostly empty slot`, fill > 0.28, `${(fill * 100).toFixed(0)}% of slot`);
}

console.log("\n── the bug this replaced ──");
{
  // What the old fixed-square plate did to a 200x60 wordmark: contain-fit it
  // into 60x60, leaving it 18px tall with 21px of white above and below.
  const oldHeight = Math.round(SIZE / (200 / 60));
  check("a wordmark used to render under 20px tall in a 60px box", oldHeight < 20, `${oldHeight}px`);
  const now = plateSize(SIZE, SLOT, 200 / 60);
  check("it now gets a plate its own shape", now.height === Math.round(now.width / (200 / 60)),
    `${now.width}x${now.height}`);
  check("and is materially taller than before", now.height > oldHeight, `${now.height}px vs ${oldHeight}px`);
}

console.log("\n── degenerate input ──");
check("no aspect yet renders square", plateSize(60, 105, null).width === 60);
check("zero aspect renders square, not zero-width", plateSize(60, 105, 0).width === 60);
check("NaN renders square", plateSize(60, 105, Number.NaN).width === 60);
check("Infinity renders square rather than a giant bar",
  plateSize(60, 105, Number.POSITIVE_INFINITY).width === 60);
check("negative renders square", plateSize(60, 105, -2).width === 60);

console.log("\n── clamping ──");
{
  // An extreme banner can't be allowed to push the heading off the row.
  const wide = plateSize(60, 105, 12);
  check("an extreme banner is capped at the slot width", wide.width === 105, `${wide.width}`);
  check("and keeps its aspect rather than being squashed",
    Math.abs(wide.width / wide.height - 12) / 12 < 0.05, `${wide.width}x${wide.height}`);

  const tall = plateSize(60, 105, 0.4);
  check("a tall logo is bounded by height", tall.height === 60, `${tall.width}x${tall.height}`);
  check("a perfect square stays square", plateSize(60, 105, 1).width === plateSize(60, 105, 1).height);
}

console.log(failures === 0 ? "\nAll logo checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
