/*
  Renders chat replies the way the dock does and checks the HTML.

  The bug this was written after: the model had been writing markdown all
  along and the dock printed it raw, so answers arrived full of asterisks and
  hyphens. Nothing failed — it just looked like the model couldn't format.
  A type checker can't see that, and neither can a screenshot of a reply that
  happens not to use a list.

  It also has to survive streaming, where every render sees a half-finished
  document: an unclosed "**", a bullet with nothing after it yet.

  Run: npx tsx scripts/verify-chat-render.ts
*/

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ChatMarkdown } from "../components/chat/chat-markdown";
import { statusMessage } from "../components/chat/activity";
import { describeScreen, idForPath, sanitizePageContext } from "../lib/chat/page-context";
import { looksUnanswered } from "../lib/chat/analytics";
import type { UIMessage } from "ai";
import { dwellFor } from "../components/chat/tour-card";
import { readFileSync } from "node:fs";
import { classifyReply } from "../lib/chat/analytics";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const html = (text: string) => renderToStaticMarkup(createElement(ChatMarkdown, { text }));

console.log("\n── markdown actually renders ──");
check("bold becomes <strong>", html("that was **fast**").includes("<strong>fast</strong>"));
check("italic becomes <em>", html("that was *fast*").includes("<em>fast</em>"));
check("inline code becomes <code>", html("run `npm test`").includes("<code"));
check("a link becomes an anchor", html("see [docs](https://x.dev)").includes('href="https://x.dev"'));
check("asterisks don't survive as literal text", !html("**bold**").includes("**"));

console.log("\n── lists ──");
{
  const ul = html("Reasons:\n- first\n- second\n- third");
  check("a dash list becomes <ul>", ul.includes("<ul"));
  check("every item is an <li>", (ul.match(/<li/g) ?? []).length === 3);
  check("the lead-in stays its own paragraph", ul.includes("Reasons:"));
  check("markers are not printed", !ul.includes("- first"));

  const ol = html("Steps:\n1. one\n2. two");
  check("a numbered list becomes <ol>", ol.includes("<ol"));
  check("numbers are rendered by the list, not the text",
    (ol.match(/<li/g) ?? []).length === 2 && !ol.includes("1. one"));

  const star = html("* alpha\n* beta");
  check("asterisk bullets work too", star.includes("<ul") && (star.match(/<li/g) ?? []).length === 2);
}

console.log("\n── paragraphs ──");
{
  const wrapped = html("one line\ncontinues here\n\na second paragraph");
  check("consecutive lines join into one paragraph",
    wrapped.includes("one line continues here"), "model output wraps mid-sentence");
  check("a blank line starts a new one", (wrapped.match(/<p/g) ?? []).length === 2);
  check("a heading renders as text, not a marker", !html("## Summary").includes("##"));
}

/*
  A work answer has a shape, and the shape depends on one keystroke.

  Signed in, the assistant wrote long structured answers; to a visitor it wrote
  one summary paragraph. That was a single line of prompt capping visitors at
  ninety words — about one paragraph — not the model treating people
  differently. The cap is gone and the answer now walks the situation, the
  brief, what he did and what came of it.

  Which only works if the beats are separated by BLANK lines. The renderer
  merges consecutive lines into one paragraph on purpose, because the model
  wraps mid-sentence — so the same four beats written with single newlines
  arrive as exactly the block of text this replaced. The instruction is
  load-bearing, and this is what proves it.
*/
console.log("\n── a work answer keeps its shape ──");
{
  const beats = [
    "AstraZeneca's Q2 2024 call planning ran on a manual weekly process — 100+ GB across three systems.",
    "He had to automate it end to end without losing the business rules.",
    "He reconciled physician identifiers across the three sources, then built a configurable pipeline over SQL Server and Spark.",
    "**Two days of work became 3.5 hours.**",
  ];

  const shaped = html(beats.join("\n\n"));
  check("each beat is its own paragraph", (shaped.match(/<p/g) ?? []).length === 4, `${(shaped.match(/<p/g) ?? []).length}`);
  check("and the outcome lands in bold", shaped.includes("<strong>Two days of work became 3.5 hours.</strong>"));

  // The trap, demonstrated rather than asserted about.
  const collapsed = html(beats.join("\n"));
  check(
    "the same beats on single lines collapse to one",
    (collapsed.match(/<p/g) ?? []).length === 1,
    `${(collapsed.match(/<p/g) ?? []).length} paragraph(s) — which is why the prompt insists on blank lines`,
  );

  /*
    Things the renderer cannot do, which the prompt now tells the model not to
    reach for. Each renders as literal junk rather than failing, so nothing
    would ever report it.
  */
  check("a table would render as literal pipes", html("| a | b |\n| - | - |").includes("|"));
  check("a blockquote would keep its marker", html("> quoted").includes("&gt;"));
  check("a divider would print as text", html("---").includes("---"));
}

console.log("\n── mid-stream fragments ──");
{
  // Every one of these is what the text looks like partway through a stream.
  for (const partial of ["**bo", "- ", "1.", "see [docs](htt", "`npm", "###", "*"]) {
    let threw = false;
    try {
      html(partial);
    } catch {
      threw = true;
    }
    check(`"${partial.replace(/\n/g, "\\n")}" renders without throwing`, !threw);
  }
  check("an unclosed bold shows its text rather than vanishing",
    html("**bo").includes("bo"), html("**bo"));
  check("empty input renders nothing rather than an empty bullet",
    !html("").includes("<li"));
}

console.log("\n── what the assistant says it's doing ──");
{
  const withTool = (name: string, state: string): UIMessage =>
    ({
      id: "1",
      role: "assistant",
      parts: [{ type: `tool-${name}`, toolCallId: "c1", state, input: {} }],
    }) as unknown as UIMessage;

  const running = withTool("researchTopic", "input-available");

  check("a running search says so", statusMessage(running, true, 0) === "Searching the web",
    String(statusMessage(running, true, 0)));

  /*
    The message has to move. A frozen line looks identical at one second and at
    twenty, so a slow turn is indistinguishable from a dead one — which is the
    whole reason this exists rather than three dots.
  */
  check("it moves on as the call runs",
    statusMessage(running, true, 2500) === "Reading the results",
    String(statusMessage(running, true, 2500)));
  check("and again", statusMessage(running, true, 5000) === "Comparing sources");

  // Cycling back to "Searching" would read as a retry that never happened.
  check("it holds on the last phase rather than looping",
    statusMessage(running, true, 30000) === "Comparing sources",
    String(statusMessage(running, true, 30000)));

  check("a finished tool no longer claims to be running",
    statusMessage(withTool("researchTopic", "output-available"), true, 0) !== "Searching the web");
  check("an unknown tool still says something",
    statusMessage(withTool("somethingNew", "input-available"), true, 0) === "Working on it");

  console.log("\n── before the model answers ──");
  check("it opens on connecting", statusMessage(undefined, false, 0) === "Connecting");
  check("connecting gives way to thinking",
    statusMessage(undefined, false, 3000) !== "Connecting",
    String(statusMessage(undefined, false, 3000)));
  check("streaming never says connecting",
    statusMessage(undefined, true, 0) !== "Connecting",
    String(statusMessage(undefined, true, 0)));

  // Somebody twenty seconds in is wondering whether it broke. Cheerful
  // rotation at that point is worse than saying so.
  check("a long wait is acknowledged rather than dressed up",
    /longer than usual/.test(statusMessage(undefined, true, 25000) ?? ""),
    String(statusMessage(undefined, true, 25000)));

  const seen = new Set<string>();
  for (let t = 1500; t < 20000; t += 900) seen.add(String(statusMessage(undefined, true, t)));
  check("the wait cycles through several phrases", seen.size >= 4, `${seen.size} distinct`);
  check("none of them is empty", ![...seen].some((s) => !s || s === "null"));
}

console.log("\n── what the visitor is looking at ──");
{
  check("a project route maps to its id", idForPath("/projects/course-compass") === "projects:course-compass");
  check("an experience route maps too", idForPath("/experience/founding-engineer") === "experience:founding-engineer");
  // Posts live at /blog because that's what people type; they're addressed as
  // "writing" in the content index.
  check("a blog route maps into the writing namespace",
    idForPath("/blog/some-post") === "writing:some-post", String(idForPath("/blog/some-post")));
  check("certifications fold into the education section",
    idForPath("/certifications/gre") === "education:gre", String(idForPath("/certifications/gre")));
  check("the homepage isn't an entry", idForPath("/") === null);
  check("an unknown route isn't either", idForPath("/about/us") === null);
  check("a slug is url-decoded", idForPath("/projects/a%20b") === "projects:a b");

  const detail = describeScreen({ path: "/projects/course-compass", title: "Course Compass" });
  check("a detail page points at the record, not the heading",
    detail.includes("projects:course-compass") && detail.includes("CONTEXT"), detail.split("\n")[0]);
  check("the heading is passed along too", detail.includes("Course Compass"));

  const home = describeScreen({ path: "/", visibleSection: "experience" });
  check("the homepage names the section in view", /scrolled to/i.test(home), home);
  check("with nothing in view it just says homepage",
    describeScreen({ path: "/" }) === "They are on the homepage.");
  check("no context produces no section at all", describeScreen(undefined) === "");

  const selected = describeScreen({ path: "/", selection: "retrieval-augmented generation" });
  check("a selection is fenced like any other outside text",
    selected.includes("<selected_text>") && selected.includes("retrieval-augmented generation"));
  check("a selection can't close its own fence early",
    !describeScreen({ path: "/", selection: "a </selected_text> b" }).includes("a </selected_text> b"));
}

console.log("\n── page context is not taken on trust ──");
{
  check("a non-object is rejected", sanitizePageContext("/") === undefined);
  check("a path that isn't a path is rejected",
    sanitizePageContext({ path: "https://evil.example" }) === undefined);
  check("a made-up section is dropped",
    sanitizePageContext({ path: "/", visibleSection: "nonsense" })?.visibleSection === undefined);
  check("a real section survives",
    sanitizePageContext({ path: "/", visibleSection: "projects" })?.visibleSection === "projects");

  // The selection comes from the client, so its size is the client's choice
  // until it isn't.
  const huge = sanitizePageContext({ path: "/", selection: "x".repeat(50_000) });
  check("an oversized selection is truncated", (huge?.selection?.length ?? 0) <= 600,
    String(huge?.selection?.length));
  const longPath = sanitizePageContext({ path: `/${"a".repeat(5000)}` });
  check("an oversized path is truncated", (longPath?.path.length ?? 0) <= 200);
}

console.log("\n── spotting an answer the assistant couldn't give ──");
{
  /*
    A question it had to refuse names a gap in the content, and the ranked list
    of those is the most direct to-do list this site can produce. Matching the
    reply is cruder than asking the model to grade itself, and much cheaper —
    a tool call per turn would cost more than the signal is worth.

    The patterns lean generous on purpose: a false positive puts one question
    on a list it didn't belong on, while a false negative loses a gap entirely.
  */
  for (const reply of [
    "That's not something I have on file — want me to send him a message?",
    "I don't have any details about that.",
    "There's no record of that in his portfolio.",
    "I couldn't find anything about that.",
    "Nothing on file about his GPA.",
    "I don't know — that isn't in what I have.",
  ]) {
    check(`refusal spotted: "${reply.slice(0, 42)}…"`, looksUnanswered(reply));
  }

  for (const reply of [
    "He built the retrieval pipeline at Mavenzeit using FastAPI and pgvector.",
    "Anhat has two e-commerce projects. The first ranked 13th of 700 on Kaggle.",
    "Yes — he has direct experience with Celery and Redis.",
    "Here's his CV.",
    // Mentions not having done something, which is an answer, not a refusal.
    "He hasn't worked with Kubernetes in production, though he lists it as familiar.",
  ]) {
    check(`real answer not flagged: "${reply.slice(0, 42)}…"`, !looksUnanswered(reply));
  }
}

/*
  The pace of an auto-playing tour.

  The complaint that produced the stepper was that nothing could be read before
  the page moved on, so the floor is the assertion that matters: every stop
  holds long enough to read its narration AND look at what the page scrolled
  to. Anything under a few seconds is the bug coming back.
*/
console.log("\n── a tour stop holds long enough to read ──");
{
  const shortest = dwellFor("Short.");
  check("even the shortest stop holds a few seconds", shortest >= 4_000, `${shortest}ms`);

  const long = dwellFor(
    "He builds retrieval pipelines and the services around them, which is most of what this role is asking for, and the work below is where that shows.",
  );
  check("a longer note buys more time", long > shortest, `${long}ms vs ${shortest}ms`);
  /*
    The ceiling matters as much as the floor. The first pass capped at 24s,
    tuned against a tour that moved too fast, and turned reading into waiting.
  */
  check("but never becomes waiting", long <= 13_000, `${long}ms`);

  // Roughly reading speed with room to look up from the text. Below this it is
  // a slideshow again.
  const words = 25;
  const perWord = (dwellFor(Array(words).fill("word").join(" ")) - 4_000) / words;
  check("each word buys real reading time", perWord >= 250, `${Math.round(perWord)}ms/word`);
}

/*
  The offer at the end of the tour.

  Someone walked through the whole case is as close to getting in touch as they
  will be, and at that moment the contact form is below the fold while the chat
  is right there. The card says so itself rather than trusting the model to
  phrase it, so what's assertable is that the text is in the component and not
  merely in the prompt.
*/
console.log("\n── the tour ends on an offer ──");
{
  const card = readFileSync("components/chat/tour-card.tsx", "utf8");
  check("the contact stop offers the chat as the way to write", /step\.section === "contact"/.test(card));
  check("and names what to send", /name, email and message/.test(card));
}

/*
  Two things the tour has to do without being asked.

  Someone who says "show me around" asked to be shown, not handed a stepper to
  operate — starting paused waited for a second decision they had already made.
  And the graph is a landmark rather than a content row, so it can't take a
  callout; without a ring, the stop scrolled to it and said nothing visible
  about it, which read as the scroll overshooting.
*/
console.log("\n── the tour shows itself ──");
{
  const card = readFileSync("components/chat/tour-card.tsx", "utf8");
  check("auto-play starts on", /const \[playing, setPlaying\] = useState\(true\)/.test(card));
  check(
    "a stop with nothing to pin doesn't burn a cooldown",
    /if \(target\.items\.length\) setHighlights/.test(card),
  );
  check(
    "landing on a landmark is one scroll, not two",
    /focusSection\(target\.section, undefined, \{ landmark:/.test(card),
  );

  const graph = readFileSync("components/sections/life-graph.tsx", "utf8");
  check('the graph rings when the page is sent to it', /activeLandmark === "life-graph"/.test(graph));
}

/*
  Telling a decline apart from a gap.

  Both are the assistant not answering, and only one is a to-do. "Couldn't
  answer" is meant to be the list of things to write next, so a question it can
  never answer — how to handle a former president — belongs somewhere else or
  the list stops being a to-do list.

  Order is the subtle part: a scope decline often borrows the wording of a
  content gap, so off-topic has to be tested first.
*/
console.log("\n── a decline is not a gap ──");
{
  const declines = [
    "I can only help with Anhat, his work, or role fit — though \u201chandle Barack Obama\u201d is certainly a memorable job description.",
    "I only talk about Anhat and his work, but nice try.",
    "That's a bit outside what I'm here for — ask me about his projects instead.",
    "I'll stick to his portfolio, but happy to take any question about the work.",
  ];
  for (const reply of declines) {
    const verdict = classifyReply(reply);
    check(
      `off-topic: "${reply.slice(0, 44)}…"`,
      verdict.kind === "off_topic" && !verdict.answered,
      verdict.kind,
    );
  }

  const gaps = [
    "That's not something I have on file.",
    "There's no record of that in his portfolio.",
  ];
  for (const reply of gaps) {
    const verdict = classifyReply(reply);
    check(`still a gap: "${reply.slice(0, 40)}…"`, verdict.kind === "question" && !verdict.answered);
  }

  const answers = [
    "He built the retrieval pipeline at Mavenzeit, which is the closest match here.",
    "Yes — he has direct experience with Celery and Redis.",
  ];
  for (const reply of answers) {
    const verdict = classifyReply(reply);
    check(`still an answer: "${reply.slice(0, 40)}…"`, verdict.kind === "question" && verdict.answered);
  }

  /*
    The case that motivates the ordering: a decline that also sounds like a gap
    must not land on the to-do list.
  */
  const both = "I don't have anything on that — I can only help with Anhat and his work.";
  check("a decline worded like a gap is still a decline", classifyReply(both).kind === "off_topic");

  const admin = readFileSync("app/admin/(protected)/page.tsx", "utf8");
  check("the to-do list holds questions only", /kind === "question"/.test(admin));
  check("declines get their own panel", /Declined as off-topic/.test(admin));
}

/*
  The first-visit nudge.

  The tour is the one thing on this site nobody knows is there, so the button
  catches the eye once — and only once. The properties worth pinning down are
  the ones that keep it a suggestion rather than a nag: it stops on its own, it
  doesn't fire at someone already in a conversation, and it remembers.
*/
console.log("\n── the nudge knows when to stop ──");
{
  const btn = readFileSync("components/chat/tour-button.tsx", "utf8");
  check("it arrives after the page settles, not at first paint", /NUDGE_DELAY_MS = \d/.test(btn));
  check("it stops on its own", /NUDGE_DURATION_MS = 30_000/.test(btn));
  check("nobody mid-conversation is pointed at the chat", /messages\.length > 0\) return/.test(btn));
  /*
    Every visit, not once per person. The tour walks whatever the site
    currently says, so it is worth taking more than once, and somebody who
    ignored it in January has not decided anything.
  */
  check("it isn't suppressed after the first visit", !btn.includes("localStorage"));

  /*
    The moving edge is a layer behind a 1px inset, not a border — a border
    can't carry a gradient that moves. Two things make it work: the sweeping
    layer takes no pointer events, and the button's own fill is opaque, since a
    translucent one would let the arc show through the middle.
  */
  check("the arc can't swallow a click", /pointer-events-none/.test(btn));
  check(
    "the button's fill is opaque, so the arc shows only at the edge",
    /bg-\[color-mix\(in_srgb,var\(--invite\)_10%,var\(--bg\)\)\]/.test(btn),
  );
  check("the arrow is gone", !btn.includes("start here") && !btn.includes("<svg"));

  const css = readFileSync("app/globals.css", "utf8");
  check("the sweep is defined", /@keyframes border-sweep/.test(css));
  /*
    An animation's transform replaces the property rather than composing with
    it, so the centring has to live in the keyframes. Left to a utility class it
    was thrown half its own width off-centre and span about a point outside the
    button — which, behind an overflow-hidden edge, showed as nothing moving.
  */
  check(
    "the keyframes carry the centring, not just the rotation",
    /@keyframes border-sweep \{[\s\S]{0,220}?from \{[\s\S]{0,80}?translate\(-50%, -50%\) rotate\(0turn\)/.test(css),
  );
  /*
    Hidden outright under reduced motion rather than slowed. The global rule
    collapses animations to one instant run, which would leave the arc frozen
    as a bright patch on one side — a decoration that reads as a fault.
  */
  const reduced = css.slice(css.indexOf(".animate-border-sweep"));
  check(
    "it is hidden under reduced motion, not frozen mid-sweep",
    /prefers-reduced-motion: reduce\)\s*\{\s*\.animate-border-sweep\s*\{\s*display: none/.test(reduced),
  );
  check("nothing still references the removed pulse", !css.includes("invite-pulse") && !css.includes("point-at"));
}

/*
  The vote from the person who asked.

  Everything else the site knows about answer quality is inferred from the
  assistant's own wording, which catches refusals and nothing else — a
  confident, complete, wrong answer is invisible to it. So the properties worth
  pinning are the ones that keep this signal honest: it appears only on a
  finished reply that actually said something, and it stores no more than the
  other analytics do.
*/
console.log("\n── asking whether the answer was any good ──");
{
  const rating = readFileSync("components/chat/answer-rating.tsx", "utf8");
  const dock = readFileSync("components/chat/chat-dock.tsx", "utf8");

  check("nothing is asked while the reply is still streaming", /!busy && hasProse/.test(dock));
  /*
    A turn that only drove the page has nothing to be right or wrong about, and
    a thumbs prompt under it asks about something never said.
  */
  check("a page-driving turn gets no rating", /function hasProse/.test(dock));
  check("the vote attaches to the question, not the reply", /askedBefore\(messages, i\)/.test(dock));
  check("it disappears once cast", /if \(rated\)/.test(rating));

  const action = readFileSync("app/rate-answer.ts", "utf8");
  check("only a thumb up or down is accepted", /rating !== 1 && rating !== -1/.test(action));

  const schema = readFileSync("lib/db/schema.sql", "utf8");
  check("the column exists and is nullable", /rating\s+smallint,/.test(schema));
  check("and is added for databases that predate it", /add column if not exists rating/.test(schema));
}

/*
  The fit check, made findable.

  It is the strongest thing the assistant does — a verdict with gaps against a
  real role — and it was reachable only by thinking to paste a job description
  into a chat box unprompted, which almost nobody does.
*/
console.log("\n── checking the fit against a real role ──");
{
  const fit = readFileSync("components/chat/fit-button.tsx", "utf8");
  const hero = readFileSync("components/sections/hero.tsx", "utf8");

  check("it has an entry point where a recruiter lands", /<FitButton/.test(hero));
  /*
    The CV download stays the one filled control. A recruiter came for the
    file, and two solid buttons side by side make neither the primary.
  */
  check(
    "and doesn't outrank the CV",
    /FitButton className="inline-flex items-center gap-2 rounded-\[var\(--radius\)\] border/.test(hero),
  );
  /*
    A JD is several hundred words. A one-line composer that grows as you paste
    into it reads as the wrong place to put one.
  */
  check("it takes the description in a sized field", /<textarea/.test(fit));
  check("a couple of words isn't a job description", /MIN_LENGTH/.test(fit));
  check("Enter still inserts a newline", /e\.metaKey \|\| e\.ctrlKey/.test(fit));
  /*
    Sent as a visitor turn like every other entry point, so the transcript
    stays honest about who said what and the verdict can be asked about
    afterwards rather than vanishing with a modal.
  */
  check("the assessment lands in the conversation", /send\(`Here's a job description/.test(fit));
  check("the dialog escapes the dock's containing block", /createPortal/.test(fit));
}

/*
  The working, folded away.

  Three readings printed above the answer make somebody read the same thing
  twice; hiding them entirely asks a recruiter to take "his backend depth is
  unproven" on trust. Closed-by-default is both — so the property that matters
  is that it is genuinely closed, and genuinely there.
*/
console.log("\n── the reasoning is visible but not in the way ──");
{
  const card = readFileSync("components/chat/investigation-card.tsx", "utf8");
  const dock = readFileSync("components/chat/chat-dock.tsx", "utf8");

  check("the findings are rendered, not dropped", /<InvestigationCard/.test(dock));
  /*
    A native <details> without `open`. It discloses without JavaScript, it is
    keyboard-operable for free, and a div-and-useState version would have to
    reimplement semantics the browser already has.
  */
  check("as a real disclosure element", /<details/.test(card));
  check("closed to begin with", !/<details[^>]*\sopen/.test(card));
  check("and each reading names what it looked at", /setHighlights\(\[\{ itemId: id/.test(card));

  const tools = readFileSync("lib/chat/tools.ts", "utf8");
  /*
    Both audiences, from one call: `content` is the fenced block the model
    answers from, `findings` is the same work shown to the visitor. The ids are
    filtered against the real index first — a lens naming something it
    half-remembered would otherwise render as a button to nothing.
  */
  check("the model still gets its fenced block", /content: formatFindings\(/.test(tools));
  check("and invented ids never reach the card", /itemIds: f\.itemIds\.filter\(\(id\) => known\.has\(id\)\)/.test(tools));

  const css = readFileSync("app/globals.css", "utf8");
  check("the marker turns when it opens", /details\[open\] > summary \[data-caret\]/.test(css));
  check("and Safari's own marker is hidden", /summary::-webkit-details-marker/.test(css));
}

/*
  Thinking where it can be seen.

  The assistant went from question to answer with a spinner between, which on
  anything taking ten seconds is the worst moment to show nothing — the visitor
  cannot tell whether it understood them, so cannot tell whether waiting is
  worth it. Two things now fill that gap, and both stream.
*/
/*
  Working-out has to look like working-out.

  The plan first rendered as a left-ruled paragraph in muted text — which is to
  say it looked exactly like something the assistant had said, sitting above
  the actual answer. The investigation was a bordered box. Two things doing the
  same job in two visual languages is most of why neither read as what it was.

  One shell now, and it deliberately is not prose: a dashed tinted panel, a
  mono label, a live dot while it works.
*/
console.log("\n── working-out looks like working-out ──");
{
  const plan = readFileSync("components/chat/plan-card.tsx", "utf8");
  const investigation = readFileSync("components/chat/investigation-card.tsx", "utf8");
  const shell = readFileSync("components/chat/thinking-block.tsx", "utf8");

  check("the plan wears the shared shell", /<ThinkingBlock/.test(plan));
  check("and does not style itself as prose", !/border-l-2/.test(plan));
  check(
    "both use the same dashed panel",
    /border-dashed border-hairline bg-elevated\/40/.test(shell) &&
      /border-dashed border-hairline bg-elevated\/40/.test(investigation),
  );
  /*
    The dot is what separates "still going" from "this is what it did", which a
    label alone cannot say.
  */
  check("a live dot while it works", /animate-ping/.test(shell) && /animate-ping/.test(investigation));
  check("and the label changes when it stops", /working \? "Working out/.test(plan));

  // Scaffolding is the first thing that should go when an answer is printed.
  check(
    "neither is printed on paper",
    /data-screen-only/.test(shell) && /data-screen-only/.test(investigation),
  );
}

console.log("\n── the thinking is visible as it happens ──");
{
  const dock = readFileSync("components/chat/chat-dock.tsx", "utf8");
  const tools = readFileSync("lib/chat/tools.ts", "utf8");
  const investigate = readFileSync("lib/chat/investigate.ts", "utf8");
  const card = readFileSync("components/chat/investigation-card.tsx", "utf8");

  /*
    The plan renders from tool INPUT, not output. Every other card waits for
    output-available, which is right when a tool computes something; this one
    computes nothing — the model writing the plan is the work — so waiting for
    output would show it only after the thinking it describes had finished.
  */
  check("the plan renders from streaming input", /getToolName\(part\) === "think"/.test(dock));
  check("and shows it is still being written", /part\.state === "input-streaming"/.test(dock));
  check("the tool itself computes nothing", /action: "plan",\n\s+reading,\n\s+steps,/.test(tools));

  /*
    The readings are yielded as each lands. Holding the first until the slowest
    returns means watching a spinner through work that is already done.
  */
  check("investigate is a generator", /execute: async function\* /.test(tools));
  check("and yields each reading as it settles", /export async function\* investigateStream/.test(investigate));
  check(
    "racing stable promises, not fresh ones each pass",
    /const remaining = new Map\(tasks\.map/.test(investigate),
  );
  check("only the last carry the block the model reads", /content: formatFindings\(\{ ok: true/.test(tools));
  check("partials say who is still out", /pending: waiting\(\)/.test(tools));

  // Open while working, closed after — a closed box streaming into itself
  // shows nothing, and once the answer lands the answer is what matters.
  check("the card opens itself while reading", /ref\.current\.open = working/.test(card));
  check("but a visitor's own toggle wins", /if \(touched \|\| !ref\.current\) return/.test(card));
}

/*
  Painting the passage without touching the DOM.

  The body is server-rendered React. A <mark> wrapped around the text is DOM
  React owns, so it either gets reconciled away or kept and lost track of, and
  the next answer would have to unpick the first. A Highlight paints a Range
  and leaves the tree alone.
*/
console.log("\n── the highlighter marks without mutating ──");
{
  const hl = readFileSync("components/detail/passage-highlight.tsx", "utf8");
  check("it paints a range", /CSS\.highlights\.set/.test(hl));
  /*
    The calls that would actually mutate, rather than the word "mark" — the
    first version of this check matched the comment explaining why there is no
    <mark>, which is a test asserting its own documentation.
  */
  check(
    "and never mutates the tree",
    !/appendChild|insertBefore|innerHTML|surroundContents|replaceWith|removeChild/.test(hl),
  );
  check("it clears the previous one first", /CSS\.highlights\.delete/.test(hl));
  /*
    A diagram's <svg> carries text nodes that read like sentences, and mermaid
    source is indexed as text — so a quote from a diagram would otherwise land
    on a label inside the picture rather than missing cleanly.
  */
  check("diagrams and code are not searched", /closest\("svg, pre, code, figcaption"\)/.test(hl));
  check("there is a fallback where ranges can't be painted", /data-passage/.test(hl));

  /*
    Comments stripped first. Twice now an assertion here has matched the
    comment explaining why the thing it forbids is absent — a test asserting
    its own documentation passes for the wrong reason, or fails for one.
  */
  const css = readFileSync("app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  check("the wash is declared", /::highlight\(passage\)/.test(css));
  /*
    ::selection is already a full-strength accent fill. Two teals a shade apart
    would read as a rendering fault the moment somebody dragged a cursor over a
    marked sentence, so the wash has to be much lighter.
  */
  const wash = Number(/::highlight\(passage\) \{[^}]*rgba\([^)]*?([\d.]+)\)/.exec(css)?.[1] ?? 1);
  check("and is far lighter than a text selection", wash <= 0.3, `${wash}`);
  /*
    Not color-mix. It compiles with an automatic fallback at FULL strength —
    an opaque block over the words for any browser without it, which is worse
    than no highlight. Caught by reading the shipped stylesheet, not the source.
  */
  check(
    "and cannot fall back to an opaque block",
    !/::highlight\(passage\) \{[^}]*color-mix/.test(css),
  );
  check("with its own value on the dark ground", /data-theme="dark"\] ::highlight\(passage\)/.test(css));
}

console.log(failures === 0 ? "\nAll chat render checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
