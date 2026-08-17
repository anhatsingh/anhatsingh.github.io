/*
  Scores the assistant's judgment against the real model.

  Everything under `npm run verify` tests mechanics and runs without an API
  key. This does the opposite: it asks the live model the questions visitors
  actually ask and checks what it decided to do. Whether it pins the right
  entry, refuses to search for its own subject, declines a question about a
  former president, admits a gap instead of overselling one.

  Not part of verify, on purpose. It costs money, it needs a key, and it is
  non-deterministic — wiring it into a build would make the build flaky and
  teach everyone to ignore it. Run it deliberately: before a prompt or model
  change, and again after.

  A single failure often means nothing. A score that drops five points after a
  prompt edit means the edit was worse.

    npx tsx --env-file=.env.local scripts/eval-chat.ts
    npx tsx --env-file=.env.local scripts/eval-chat.ts --group safety
    npx tsx --env-file=.env.local scripts/eval-chat.ts --case declines-off-topic
    npx tsx --env-file=.env.local scripts/eval-chat.ts --runs 3     # same case N times
    npx tsx --env-file=.env.local scripts/eval-chat.ts --baseline   # write the score to disk
*/

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs } from "ai";
import { getPortfolio } from "../lib/content";
import { buildSystemPrompt, wrapVisitorMessage } from "../lib/chat/prompt";
import { RetrievalContextProvider } from "../lib/chat/context";
import { buildTools } from "../lib/chat/tools";
import { looksOffTopic, looksUnanswered } from "../lib/chat/analytics";
import { EVAL_CASES, GROUPS, type EvalCase, type Expectation } from "../lib/chat/evals";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const BASELINE_FILE = ".eval-baseline.json";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : null;
}
const has = (name: string) => process.argv.includes(`--${name}`);

interface Result {
  id: string;
  passed: boolean;
  failures: string[];
  tools: string[];
  text: string;
}

/** Runs one case and reports which expectations it missed. */
async function runCase(
  test: EvalCase,
  ctx: { system: string; tools: ReturnType<typeof buildTools> },
): Promise<Result> {
  /*
    Priming turns are replayed as plain user messages rather than a
    reconstructed transcript. The assistant's own previous replies are exactly
    what varies between runs, and feeding a remembered one back would score
    this run against a different conversation than the one it is in.
  */
  const messages = [...(test.priming ?? []), test.ask].map((text) => ({
    role: "user" as const,
    content: wrapVisitorMessage(text),
  }));

  const result = await generateText({
    model: openai(MODEL),
    system: ctx.system,
    messages,
    tools: ctx.tools,
    stopWhen: stepCountIs(8),
    /*
      No temperature. The model in use is a reasoning model, which rejects the
      setting outright — it was being silently dropped, so the 0.7 that sat
      here described nothing and invited the belief that variability had been
      tuned. A setting that does nothing is worse than no setting.
    */
    maxRetries: 2,
  });

  const tools = result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
  /*
    Every step's prose, not just the final one. A turn that ends on a tool call
    leaves result.text empty, so scoring against it would report an assistant
    that said nothing when it had in fact answered and then attached follow-ups.
  */
  const text = result.steps
    .map((s) => s.text)
    .filter(Boolean)
    .join("\n")
    .trim();
  const failures: string[] = [];

  for (const expectation of test.expect) {
    const missed = check(expectation, tools, text);
    if (missed) failures.push(missed);
  }

  return { id: test.id, passed: failures.length === 0, failures, tools, text };
}

function check(expectation: Expectation, tools: string[], text: string): string | null {
  const lower = text.toLowerCase();

  switch (expectation.kind) {
    case "calls": {
      const missing = expectation.tools.filter((t) => !tools.includes(t));
      return missing.length ? `never called ${missing.join(", ")}` : null;
    }
    case "avoids": {
      const called = expectation.tools.filter((t) => tools.includes(t));
      return called.length ? `should not have called ${called.join(", ")}` : null;
    }
    case "declines": {
      /*
        Scored with the same classifier the admin uses, deliberately. If a
        decline doesn't register here it won't register in the dashboard
        either, and the whole point of that panel is that it is accurate.
      */
      if (expectation.reason === "off_topic") {
        return looksOffTopic(text) ? null : "did not read as a scope decline";
      }
      return looksUnanswered(text) ? null : "did not read as a content gap";
    }
    case "mentionsAny": {
      return expectation.phrases.some((p) => lower.includes(p.toLowerCase()))
        ? null
        : `mentioned none of ${expectation.phrases.join(", ")}`;
    }
    case "mentions": {
      const missing = expectation.phrases.filter((p) => !lower.includes(p.toLowerCase()));
      return missing.length ? `never mentioned ${missing.join(", ")}` : null;
    }
    case "never": {
      const present = expectation.phrases.filter((p) => lower.includes(p.toLowerCase()));
      return present.length ? `said ${present.map((p) => JSON.stringify(p)).join(", ")}` : null;
    }
  }
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.log("\n  Needs OPENAI_API_KEY. Try: npx tsx --env-file=.env.local scripts/eval-chat.ts\n");
    process.exit(1);
  }

  const only = arg("case");
  const group = arg("group");
  const runs = Number(arg("runs") ?? 1);

  let cases = EVAL_CASES;
  if (only) cases = cases.filter((c) => c.id === only);
  else if (group) {
    const filter = GROUPS[group];
    if (!filter) {
      console.log(`\n  Unknown group. Try one of: ${Object.keys(GROUPS).join(", ")}\n`);
      process.exit(1);
    }
    cases = cases.filter(filter);
  }

  if (!cases.length) {
    console.log("\n  Nothing matched.\n");
    process.exit(1);
  }

  const portfolio = await getPortfolio();
  const context = await new RetrievalContextProvider(portfolio, {}).getContext("");
  const ctx = {
    system: buildSystemPrompt(portfolio, context),
    /*
      Search is allowed but the subject guard stays on, exactly as a visitor
      gets it. Evaluating a configuration nobody is served would score the
      wrong assistant.
    */
    tools: buildTools(portfolio, { canSearch: () => true, allowSubjectSearch: false }),
  };

  console.log(`\n── ${cases.length} case(s) × ${runs} run(s) · ${MODEL} ──\n`);

  const scores = new Map<string, number>();
  const seen: Result[] = [];

  for (const test of cases) {
    for (let run = 0; run < runs; run++) {
      const result = await runCase(test, ctx).catch(
        (err): Result => ({
          id: test.id,
          passed: false,
          failures: [`threw: ${String(err).slice(0, 120)}`],
          tools: [],
          text: "",
        }),
      );

      seen.push(result);
      scores.set(test.id, (scores.get(test.id) ?? 0) + (result.passed ? 1 : 0));

      const mark = result.passed ? "PASS" : "FAIL";
      const suffix = runs > 1 ? ` (run ${run + 1})` : "";
      console.log(`  [${mark}] ${test.id}${suffix}`);

      if (!result.passed) {
        // The reason the case exists, printed where it is needed rather than
        // left in a file nobody opens when something goes red.
        console.log(`         why it matters: ${test.why}`);
        for (const failure of result.failures) console.log(`         → ${failure}`);
        console.log(`         tools: ${result.tools.join(", ") || "none"}`);
        console.log(`         said: ${JSON.stringify(result.text.slice(0, 400))}`);
      }
    }
  }

  const total = seen.length;
  const passed = seen.filter((r) => r.passed).length;
  const score = Math.round((passed / total) * 100);

  console.log(`\n  ${passed}/${total} — ${score}%`);

  /*
    Flaky cases are worth naming separately. A case that passes two runs in
    three is not a pass, and averaging it into the score hides the one
    behaviour a visitor is most likely to hit at the wrong moment.
  */
  if (runs > 1) {
    const flaky = [...scores.entries()].filter(([, n]) => n > 0 && n < runs);
    if (flaky.length) {
      console.log(`\n  Inconsistent across runs — these decide differently each time:`);
      for (const [id, n] of flaky) console.log(`    ${id}: ${n}/${runs}`);
    }
  }

  /*
    The comparison is the product, not the number. A score alone says nothing;
    a score against the one recorded before a prompt change says whether the
    change was an improvement.
  */
  if (existsSync(BASELINE_FILE)) {
    const prev = JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as { score: number; model: string; at: string };
    const delta = score - prev.score;
    const direction = delta > 0 ? "better" : delta < 0 ? "WORSE" : "unchanged";
    console.log(`  baseline ${prev.score}% (${prev.model}, ${prev.at}) → ${direction} by ${Math.abs(delta)}`);
  } else {
    console.log(`  no baseline yet — run with --baseline to record this one`);
  }

  if (has("baseline")) {
    writeFileSync(
      BASELINE_FILE,
      JSON.stringify({ score, model: MODEL, at: new Date().toISOString().slice(0, 10) }, null, 2),
    );
    console.log(`  recorded as the baseline`);
  }

  console.log("");
  // Never a non-zero exit. This is a benchmark, and a red build for a model
  // having an off day is how a benchmark gets deleted.
}

main();
