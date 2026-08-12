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
  check("it stops on its own", /NUDGE_DURATION_MS = /.test(btn));
  check("nobody mid-conversation is pointed at the chat", /messages\.length > 0\) return/.test(btn));
  check("it is remembered across visits", /localStorage\.setItem\(SEEN_KEY/.test(btn));
  check("storage being unavailable doesn't break the button", /catch \{/.test(btn));

  /*
    The arrow hangs below the header, over the page. It must never take a click
    — swallowing one on whatever sits underneath would be worse than no arrow —
    and it must not be read out, since the button already says what it does.
  */
  check("the arrow only exists during the nudge", /\{nudge && \(/.test(btn));
  check("it can't swallow a click", /pointer-events-none/.test(btn));
  check("screen readers skip it", /aria-hidden="true"\n\s*className="animate-point/.test(btn));

  const css = readFileSync("app/globals.css", "utf8");
  check("the pulse is defined", /@keyframes invite-pulse/.test(css));
  check("the arrow's motion is defined", /@keyframes point-at/.test(css));
  /*
    Both ends of the cycle are the resting state, so the global reduced-motion
    rule — which collapses animations to one 0.01ms run — leaves the button
    quiet rather than frozen mid-glow.
  */
  const frames = css.slice(css.indexOf("@keyframes invite-pulse"));
  check(
    "its start and end are the resting state, for reduced motion",
    /0%,\s*\n\s*100% \{/.test(frames.slice(0, 200)),
  );
}

console.log(failures === 0 ? "\nAll chat render checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
