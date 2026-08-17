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
// Static import: tsx compiles these scripts to CJS, where top-level await is a
// syntax error. chunkText is pure, so importing the module costs nothing.
import { chunkText } from "../lib/chat/embeddings";
import { splitProse } from "../components/blocks/block-renderer";
import { findPassage, normalise } from "../lib/content/find-passage";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { BlockRenderer } from "../components/blocks/block-renderer";

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

console.log("\n── retrieval chunking ──");
{
  const short = chunkText("One paragraph.");
  check("short text stays one chunk", short.length === 1);

  const paras = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ` + "word ".repeat(40)).join("\n\n");
  const chunks = chunkText(paras, 900);
  check("long text splits into several chunks", chunks.length > 1, `${chunks.length} chunks`);
  check("no chunk wildly exceeds the target", chunks.every((c) => c.length < 1400),
    `max ${Math.max(...chunks.map((c) => c.length))}`);
  check("nothing is lost", chunks.join(" ").includes("Paragraph 11"));

  const giant = chunkText("x".repeat(50) + ". " + "sentence here. ".repeat(200), 900);
  check("an oversized single paragraph still splits", giant.length > 1, `${giant.length} chunks`);
  check("no empty chunks", giant.every((c) => c.trim().length > 0));
}

/*
  A text block is a document, not a sentence.

  It rendered as a single <p> with inline markdown, so a full write-up — which
  is how these are actually authored, one block holding the whole thing —
  arrived as one unbroken wall with every paragraph break discarded. A bullet
  list fared worse: "- " rendered as a hyphen mid-sentence.
*/
console.log("\n── prose inside a text block ──");
{
  const paras = splitProse("First paragraph.\n\nSecond paragraph.");
  check("blank lines separate paragraphs", paras.length === 2, `${paras.length}`);
  check("both are paragraphs", paras.every((c) => c.kind === "p"));

  // A hard-wrapped paragraph is still one paragraph. Treating each line as its
  // own would shred anything pasted from an editor that wraps at 80 columns.
  const wrapped = splitProse("A sentence that was\nhard wrapped by an editor.");
  check("single newlines do not split a paragraph", wrapped.length === 1);
  check("and the line break becomes a space", wrapped[0].kind === "p" && wrapped[0].text.includes("was hard"));

  const bullets = splitProse("Intro line.\n\n- first\n- second\n- third");
  check("a bulleted block becomes a list", bullets[1]?.kind === "list");
  check("with every item", bullets[1]?.kind === "list" && bullets[1].items.length === 3);
  check("and the markers stripped", bullets[1]?.kind === "list" && bullets[1].items[0] === "first");
  check("unordered stays unordered", bullets[1]?.kind === "list" && !bullets[1].ordered);

  const numbered = splitProse("1. one\n2. two");
  check("a numbered block becomes an ordered list", numbered[0]?.kind === "list" && numbered[0].ordered);

  /*
    A line that merely starts with a dash mid-paragraph is not a list. Getting
    this wrong turns an em-dash aside into a one-item bullet.
  */
  const notAList = splitProse("- a bullet\nbut this line is not");
  check("a mixed block is not a list", notAList[0]?.kind === "p");

  const quoted = splitProse("> something someone said");
  check("a quote is a quote", quoted[0]?.kind === "quote");
  check("and loses its marker", quoted[0]?.kind === "quote" && quoted[0].text === "something someone said");

  /*
    Nobody drafting a paragraph stops to create a heading block, so a ### in
    prose is a sub-heading. Rendering the hashes literally is the worse outcome.
  */
  const sub = splitProse("### A sub-heading");
  check("hashes in prose become a sub-heading", sub[0]?.kind === "sub");
  check("without the hashes", sub[0]?.kind === "sub" && sub[0].text === "A sub-heading");

  // The real entry that prompted all of this: one heading, one enormous text
  // block with four paragraphs inside it.
  const real = splitProse(
    "As one of the top-performing students in the **Java** course, I was selected.\n\n" +
      "My primary responsibility was to help students.\n\n" +
      "In addition to teaching, I collaborated with a team of three.\n\n" +
      "This experience strengthened my technical knowledge.",
  );
  check("the entry that started this now has four paragraphs", real.length === 4, `${real.length}`);
  check("and its bold survives for the inline renderer", real[0].kind === "p" && real[0].text.includes("**Java**"));

  check("empty input yields nothing rather than a blank paragraph", splitProse("").length === 0);
}

/*
  Fenced blocks, and why they come out first.

  A mermaid diagram or a code sample contains blank lines of its own. Splitting
  prose on blank lines before extracting fences tears a diagram into fragments
  that then parse as paragraphs — which is exactly how a flowchart reached the
  Axtria page as several lines of literal "A[Prescription Data] --> B[...]".
*/
console.log("\n── fenced blocks ──");
{
  const withDiagram = splitProse(
    "Here is the pipeline.\n\n```mermaid\nflowchart LR\n\nA[Data] --> B[More]\n```\n\nAnd afterwards.",
  );
  check("a fence survives the blank lines inside it", withDiagram.length === 3, `${withDiagram.length} chunks`);
  check("mermaid is recognised as a diagram", withDiagram[1]?.kind === "mermaid");
  check(
    "with its blank lines intact",
    withDiagram[1]?.kind === "mermaid" && withDiagram[1].code.includes("flowchart LR\n\nA[Data]"),
  );
  check("and the prose around it survives", withDiagram[0]?.kind === "p" && withDiagram[2]?.kind === "p");

  const code = splitProse("```python\nprint('hi')\n```");
  check("another language is a code block, not a diagram", code[0]?.kind === "code");
  check("and keeps its language", code[0]?.kind === "code" && code[0].language === "python");

  const untagged = splitProse("```\nplain\n```");
  check("an untagged fence still renders as code", untagged[0]?.kind === "code");

  /*
    Backticks inside a paragraph are inline code, not a fence. Treating them as
    one would swallow the rest of the page from that point.
  */
  const inline = splitProse("Use `npm run build` to check.");
  check("inline backticks are left to the inline renderer", inline[0]?.kind === "p");

  const two = splitProse("```mermaid\ngraph TD\nA-->B\n```\n\ntext\n\n```mermaid\ngraph LR\nC-->D\n```");
  check("two diagrams in one block both render", two.filter((c) => c.kind === "mermaid").length === 2);
}

/*
  Locating the sentence an answer came from.

  The assistant quotes what it used and the page finds it. This is the half
  that fails invisibly: a wrong offset highlights the wrong sentence, which is
  worse than no highlight, and nothing in a build would notice.

  The cases below are the two real gaps. What the model quotes from is the
  INDEXED copy — blocksToPlainText strips inline markdown before embedding — so
  a quote says "Java" where the source says "**Java**". And that same flattening
  invents sentences for code, video and embed blocks, and indexes mermaid source
  as text, none of which exist in the rendered page at all.
*/
console.log("\n── finding the passage a quote came from ──");
{
  const body =
    "When people hear the term Data Scientist, they usually imagine neural networks.\n\n" +
    "The pipeline ran weekly, cutting call-plan generation from two days to 3.5 hours.";

  const exact = findPassage(body, "cutting call-plan generation from two days to 3.5 hours");
  check("an exact quote is found", exact !== null);
  check(
    "and points at the real text",
    exact !== null && body.slice(exact.start, exact.end) === "cutting call-plan generation from two days to 3.5 hours",
    exact ? JSON.stringify(body.slice(exact.start, exact.end)) : "",
  );
  check("a whole match is not marked partial", exact?.partial === false);

  check("case is not a difference", findPassage(body, "CUTTING CALL-PLAN GENERATION FROM TWO DAYS") !== null);
  check(
    "nor is wrapping",
    findPassage(body, "cutting  call-plan\n  generation   from two days to 3.5 hours") !== null,
  );

  /*
    The markdown gap. The source is bolded, the indexed copy is not, and the
    rendered page has no asterisks either — so normalising them away is what
    lets the one form the model saw match the one the reader sees.
  */
  const bolded = "He worked mostly in **Java** and Python across the pipeline.";
  check(
    "markdown in the source doesn't block a quote that lost it",
    findPassage(bolded, "He worked mostly in Java and Python across") !== null,
  );

  // Curly quotes and em dashes, in either direction.
  const typeset = "It wasn\u2019t simple \u2014 three sources, three shapes, one deadline.";
  check("smart punctuation in the body matches plain in the quote",
    findPassage(typeset, "It wasn't simple - three sources, three shapes") !== null);
  check("and the other way round",
    findPassage("It wasn't simple - three sources, three shapes, one deadline.",
      "It wasn\u2019t simple \u2014 three sources, three shapes") !== null);

  /*
    A model that trails off or paraphrases the tail should still land on the
    right sentence rather than nothing.
  */
  const trailed = findPassage(body, "cutting call-plan generation from two days to about three and a half hours or so");
  check("a quote that drifts still finds its opening", trailed !== null);
  check("and says it only matched part", trailed?.partial === true);

  console.log("\n── and refusing to guess ──");
  check("a quote that appears nowhere finds nothing", findPassage(body, "he rewrote the scheduler in Rust") === null);
  /*
    Mermaid source is indexed as text and rendered as an SVG, so a quote drawn
    from a diagram exists in what the model read and nowhere in what the reader
    sees. It has to miss rather than half-match something adjacent.
  */
  check(
    "diagram source is not found in prose",
    findPassage(body, "A[Prescription Data] --> B[Physician Data] --> E[Data Processing]") === null,
  );
  // blocksToPlainText writes these; they exist in no rendered page.
  check(
    "an invented sentence for a code block is not found",
    findPassage(body, "Code sample (rerank.py) in python.") === null,
  );
  /*
    Too short to be distinctive. "the data" appears in almost any article, and
    a highlighter landing on the wrong sentence is worse than one that never
    appears.
  */
  check("a fragment too short to be distinctive is refused", findPassage(body, "two days") === null);

  const twice = "the pipeline ran weekly and then the pipeline ran weekly again, at scale";
  const first = findPassage(twice, "the pipeline ran weekly and then");
  check("a repeated phrase takes the first", first?.start === 0, `${first?.start}`);
}

/*
  The locator against what actually reaches the page.

  Everything above tests it on a string I wrote. This runs a real body through
  the real renderer, strips the tags, and locates a quote in what comes out —
  so splitProse, InlineMarkdown and the matcher are exercised together, which
  is where a mismatch would actually live.

  Text and heading blocks only: GitHubCard is async and Mermaid is a client
  component, so neither renders in this harness.
*/
console.log("\n── against the rendered page ──");
{
  const blocks = parseBlocks([
    { type: "heading", level: 3, text: "The Challenge: 100+ GB of Data" },
    {
      type: "text",
      markdown:
        "The project focused on automating **AstraZeneca's Q2 2024 call planning process**.\n\n" +
        "The existing workflow was manual and slow. A pipeline that ran weekly cut call-plan " +
        "generation from two days to 3.5 hours.\n\n" +
        "- Which doctors should be visited.\n- Which products should be promoted.",
    },
  ]);

  const html = renderToStaticMarkup(createElement(BlockRenderer, { blocks }));

  /*
    What a reader sees, which is what the browser walker will search.

    The entities have to be decoded or this harness tests a string no browser
    ever produces: renderToStaticMarkup escapes an apostrophe to &#x27;, while
    textContent gives back the character. Getting this wrong makes a working
    matcher look broken on exactly the quotes that contain punctuation.
  */
  const rendered = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  check("the body rendered", rendered.includes("call-plan"), `${rendered.length} chars`);

  const hit = findPassage(rendered, "A pipeline that ran weekly cut call-plan generation from two days to 3.5 hours");
  check("a quote is found in the rendered output", hit !== null);
  check(
    "and lands on the sentence, not near it",
    hit !== null && normalise(rendered.slice(hit.start, hit.end)).text.startsWith("a pipeline that ran weekly"),
    hit ? JSON.stringify(rendered.slice(hit.start, hit.end).trim().slice(0, 60)) : "",
  );

  /*
    The bold survives as an element, so the paragraph's text is a tree rather
    than one node — and the quote the model has lost the asterisks. Both sides
    normalise to the same thing, which is the whole reason this works.
  */
  check(
    "a quote spanning a bold run still matches",
    findPassage(rendered, "automating AstraZeneca's Q2 2024 call planning process") !== null,
  );

  // A list item is prose too, and the renderer puts each in its own <li>.
  check(
    "a quote from a list item matches",
    findPassage(rendered, "Which products should be promoted") !== null,
  );
}

console.log(failures === 0 ? "\nAll block checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
