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
import type { UIMessage } from "ai";

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

console.log(failures === 0 ? "\nAll chat render checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
