/*
  Guards the block model.

  Two failure modes it exists for:

   1. `parseBlocks` throwing. Bodies are jsonb — written by the admin form, by
      the AI, and occasionally by hand. One malformed block must cost one block,
      not a 500 on an otherwise fine page.

   2. `blocksToPlainText` silently missing a case. Four things read it —
      reading time, SEO descriptions, chatbot context and RAG chunking — so a
      forgotten `case` shrinks all four at once with nothing failing. The test
      below asserts EVERY block type contributes text.

  Run: npx tsx scripts/verify-blocks.ts
*/

import {
  BLOCK_TYPES,
  blockSchema,
  blocksToPlainText,
  normalizeVideoUrl,
  parseBlocks,
  readingMinutes,
  type Block,
} from "../lib/content/blocks";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

/** One valid instance of every block type. */
const SAMPLES: Record<Block["type"], Block> = {
  text: { type: "text", markdown: "Rebuilt the **retrieval** layer with a [reranker](https://x.com)." },
  heading: { type: "heading", level: 2, text: "How the pipeline works" },
  code: { type: "code", language: "python", code: "def rerank(x):\n    return x", filename: "rerank.py" },
  image: { type: "image", url: "https://example.com/a.png", alt: "Architecture diagram", caption: "The pipeline" },
  video: { type: "video", url: "https://youtu.be/dQw4w9WgXcQ", caption: "Two-minute demo" },
  github: { type: "github", repo: "anhatsingh/rag-eval", note: "The eval harness" },
  link: { type: "link", url: "https://example.com", title: "Paper: ColBERT", description: "Late interaction" },
  callout: { type: "callout", tone: "warning", text: "Below 10k documents this is slower." },
  steps: { type: "steps", steps: [{ title: "Install", body: "pip install ragkit" }, { title: "Index", body: "Point it at a folder" }] },
  embed: { type: "embed", url: "https://huggingface.co/spaces/x/y", title: "Live demo", height: 500 },
};

console.log("\n── every declared type has a sample and a schema ──");
const declared = BLOCK_TYPES.map((b) => b.type).sort();
const sampled = Object.keys(SAMPLES).sort();
check("BLOCK_TYPES matches the sample set", JSON.stringify(declared) === JSON.stringify(sampled),
  declared.join(", "));
check("every sample validates", Object.values(SAMPLES).every((b) => blockSchema.safeParse(b).success));

console.log("\n── round-trip ──");
const all = Object.values(SAMPLES);
const roundTripped = parseBlocks(JSON.parse(JSON.stringify(all)));
check("all blocks survive a JSON round-trip", roundTripped.length === all.length,
  `${roundTripped.length}/${all.length}`);

console.log("\n── malformed input degrades, never throws ──");
for (const [label, input] of [
  ["null", null],
  ["a string", "not blocks"],
  ["an object", { type: "text" }],
  ["undefined", undefined],
] as Array<[string, unknown]>) {
  let threw = false;
  let result: Block[] = [];
  try { result = parseBlocks(input); } catch { threw = true; }
  check(`${label} → [] without throwing`, !threw && result.length === 0);
}

const mixed = parseBlocks([
  SAMPLES.text,
  { type: "text" },                       // missing markdown
  { type: "nonsense", foo: 1 },           // unknown type
  SAMPLES.code,
  { type: "heading", level: 7, text: "x" }, // level out of range
]);
check("a mixed array keeps only the valid blocks", mixed.length === 2, `kept ${mixed.length} of 5`);
check("kept blocks are the right ones", mixed[0].type === "text" && mixed[1].type === "code");

console.log("\n── blocksToPlainText covers EVERY type ──");
for (const [type, block] of Object.entries(SAMPLES)) {
  const text = blocksToPlainText([block as Block]);
  check(`${type} contributes text`, text.trim().length > 0, `"${text.slice(0, 46)}${text.length > 46 ? "…" : ""}"`);
}

console.log("\n── plain text is prose, not markup ──");
const prose = blocksToPlainText([SAMPLES.text]);
check("markdown link syntax stripped, label kept", prose.includes("reranker") && !prose.includes("]("));
check("emphasis markers stripped", !prose.includes("**"));
const codeText = blocksToPlainText([SAMPLES.code]);
check("code body is summarised, not dumped", !codeText.includes("def rerank"), codeText);
check("code summary names the language", codeText.includes("python"));

console.log("\n── reading time ──");
check("empty body still reads as 1 min", readingMinutes([]) === 1);
const long: Block[] = [{ type: "text", markdown: "word ".repeat(600) }];
check("600 words ≈ 3 min", readingMinutes(long) === 3, `${readingMinutes(long)} min`);

console.log("\n── video URL normalisation ──");
const cases: Array<[string, string, "iframe" | "direct" | "null"]> = [
  ["youtu.be short", "https://youtu.be/dQw4w9WgXcQ", "iframe"],
  ["watch?v=", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "iframe"],
  ["shorts", "https://youtube.com/shorts/dQw4w9WgXcQ", "iframe"],
  ["vimeo", "https://vimeo.com/76979871", "iframe"],
  ["direct mp4", "https://example.com/demo.mp4", "direct"],
  ["empty", "", "null"],
  ["not a url", "demo.mp4", "null"],
  ["javascript:", "javascript:alert(1)", "null"],
];
for (const [label, url, expected] of cases) {
  const result = normalizeVideoUrl(url);
  const kind = result ? result.kind : "null";
  check(`${label} → ${expected}`, kind === expected, result?.src ?? "null");
}
const yt = normalizeVideoUrl("https://www.youtube.com/watch?v=abc123");
check("YouTube uses the no-cookie host", yt?.src.includes("youtube-nocookie.com") ?? false, yt?.src);

console.log(failures === 0 ? "\nAll block checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
