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
import { activityLabel } from "../components/chat/activity";
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

  check("a running search says so",
    activityLabel(withTool("researchTopic", "input-available"), true) === "Searching the web",
    String(activityLabel(withTool("researchTopic", "input-available"), true)));
  check("a finished tool no longer claims to be running",
    activityLabel(withTool("researchTopic", "output-available"), true) === "Thinking");
  check("an unknown tool still says something",
    activityLabel(withTool("somethingNew", "input-available"), true) === "Working on it");
  check("no tool and no stream says nothing at all",
    activityLabel(undefined, false) === null);
  check("waiting on the first token is thinking",
    activityLabel(undefined, true) === "Thinking");
}

console.log(failures === 0 ? "\nAll chat render checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
