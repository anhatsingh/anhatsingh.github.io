/*
  The reply cache, and the reason it is as narrow as it is.

  Caching a chatbot is a good way to serve somebody an answer to a question
  they didn't ask. What makes it safe here is that exactly one question is
  eligible — "show me around" — and it is eligible because the prompt fixes the
  route, so the reply genuinely does not depend on the conversation.

  So the assertions are mostly about what does NOT get cached, and about the
  two independent expiries: a deploy, because the prompt and tool schema ship
  in the bundle, and 24 hours, for content edited without one.

  Run: npx tsx scripts/verify-cache.ts
*/

import { readFileSync } from "node:fs";
import { cacheKey, deployId, freshenIds, isTourRequest } from "../lib/chat/cache";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log("\n── what counts as asking for the tour ──");
for (const asked of [
  "Show me around",
  "show me around please",
  "Can you give me a tour?",
  "walk me round the site",
  "just the short version",
  "show me the highlights",
]) {
  check(`"${asked}"`, isTourRequest(asked));
}

/*
  Everything else pays for itself. These are the near misses that matter —
  questions that mention the same words but want a different answer.
*/
console.log("\n── what must never be served from cache ──");
for (const asked of [
  "What did he do at Mavenzeit?",
  "Show me his best project",
  "Is he a good fit for this role?",
  "show me his resume",
  "What's around the corner for him?",
]) {
  check(`"${asked}"`, !isTourRequest(asked));
}

console.log("\n── the key ──");
check(
  "case and punctuation don't split the cache",
  cacheKey("Show me around!") === cacheKey("show me around"),
);
check("a different question is a different key", cacheKey("show me around") !== cacheKey("show me his cv"));
check("the key is a hash, not the question", !cacheKey("show me around").includes("show"));

console.log("\n── expiry ──");
check("a build always has an id to scope by", deployId().length > 0, deployId());
{
  const sql = readFileSync("lib/db/schema.sql", "utf8");
  check("rows are scoped to the build that made them", /deploy_id\s+text not null/.test(sql));
  check(
    "one cached reply per question per build",
    /unique \(question_hash, deploy_id\)/.test(sql),
  );
  const route = readFileSync("app/api/chat/route.ts", "utf8");
  check("the owner is never served a cached reply", /!isOwner && isTourRequest/.test(route));
  check("a truncated stream is not stored", /payload\.includes\("finish"\)/.test(route));
}

/*
  Ids are rewritten on replay. Across visitors the stored ones would be
  harmless, but somebody who asks twice in one session would end up with two
  messages sharing a React key, and only one would render.
*/
console.log("\n── replaying the same stream twice ──");
{
  const payload =
    '{"type":"start","messageId":"m1"}\n' +
    '{"type":"text","id":"abc","text":"hi"}\n' +
    '{"type":"tool-output","toolCallId":"call_1","output":{"itemId":"experience:x"}}\n' +
    '{"type":"text-end","id":"abc"}';

  const a = freshenIds(payload);
  const b = freshenIds(payload);

  check("the same id doesn't come back twice", a !== b);
  check("nothing from the original survives", !a.includes('"id":"abc"') && !a.includes("call_1"));
  check(
    "an id used twice in one payload stays consistent",
    (() => {
      const ids = [...a.matchAll(/[{,]"id":"([^"]+)"/g)].map((m) => m[1]);
      return ids.length === 2 && ids[0] === ids[1];
    })(),
  );
  // itemId is content, not a stream identifier. Rewriting it would point a
  // callout at a row that doesn't exist.
  check("content ids are left alone", a.includes('"itemId":"experience:x"'));
}

console.log(failures === 0 ? "\nAll cache checks passed.\n" : `\n${failures} cache check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
