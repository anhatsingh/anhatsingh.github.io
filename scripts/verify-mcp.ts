/*
  Checks the MCP server's shape without needing a database.

  The token behaviour — that a token matches itself and nothing else, that
  revoking stops it, that the plaintext is never stored — is exercised against
  a real Postgres in verify-schema.ts, because those are properties of the SQL
  and not of this code. What is left here is everything an agent sees: the tool
  list, the argument schemas, and the header parsing that decides whether a
  request gets in at all.

  Run: npx tsx scripts/verify-mcp.ts
*/

import { z } from "zod";
import { MCP_TOOLS } from "../lib/mcp/tools";
import { bearerFrom } from "../lib/mcp/tokens";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function req(headers: Record<string, string>): Request {
  return new Request("https://example.com/api/mcp", { headers });
}

console.log("\n── the tool list ──");

check("there are tools at all", MCP_TOOLS.length > 0, `${MCP_TOOLS.length} of them`);

check(
  "every name is unique",
  new Set(MCP_TOOLS.map((t) => t.name)).size === MCP_TOOLS.length,
);

/*
  MCP names are referenced by string from a client's config and from a model's
  tool call. Anything outside this set is a name that some client will mangle.
*/
check(
  "names are snake_case",
  MCP_TOOLS.every((t) => /^[a-z][a-z0-9_]*$/.test(t.name)),
  MCP_TOOLS.filter((t) => !/^[a-z][a-z0-9_]*$/.test(t.name)).map((t) => t.name).join(", "),
);

/*
  The description is the entire basis on which a model decides whether to call
  a tool. A thin one is not a style problem — it is a tool that never gets used
  or gets used for the wrong question.
*/
check(
  "every tool describes itself properly",
  MCP_TOOLS.every((t) => t.description.length >= 40),
  MCP_TOOLS.filter((t) => t.description.length < 40).map((t) => t.name).join(", "),
);

/*
  The SDK reads ~standard off the schema to advertise arguments and to validate
  an incoming call. A schema missing it would register a tool whose arguments
  are never checked.
*/
check(
  "every schema is a zod object the SDK can read",
  MCP_TOOLS.every(
    (t) => t.inputSchema instanceof z.ZodObject && "~standard" in t.inputSchema,
  ),
);

console.log("\n── what the plan promised ──");
for (const name of [
  "get_profile",
  "list_experience",
  "list_projects",
  "list_education",
  "list_skills",
  "list_certifications",
  "list_writing",
  "get_entry",
  "search",
  "skill_duration",
  "assess_fit",
  "list_resumes",
]) {
  check(name, MCP_TOOLS.some((t) => t.name === name));
}

console.log("\n── argument validation ──");

const getEntry = MCP_TOOLS.find((t) => t.name === "get_entry")!;
check("get_entry requires an id", !getEntry.inputSchema.safeParse({}).success);

const search = MCP_TOOLS.find((t) => t.name === "search")!;
check("search requires a query", !search.inputSchema.safeParse({}).success);
check(
  "search caps limit so one call can't pull the corpus",
  !search.inputSchema.safeParse({ query: "python", limit: 500 }).success,
);
check(
  "search defaults limit when it's left out",
  search.inputSchema.safeParse({ query: "python" }).success,
);

const fit = MCP_TOOLS.find((t) => t.name === "assess_fit")!;
check(
  "assess_fit rejects a job description too short to judge",
  !fit.inputSchema.safeParse({ jobDescription: "senior engineer" }).success,
);

console.log("\n── the Authorization header ──");
check("a bearer token is read", bearerFrom(req({ authorization: "Bearer abc123" })) === "abc123");
check("the scheme is case-insensitive", bearerFrom(req({ authorization: "bearer abc123" })) === "abc123");
check("no header means no token", bearerFrom(req({})) === null);
check("Basic auth is not a bearer token", bearerFrom(req({ authorization: "Basic abc123" })) === null);
check("a bare token with no scheme is refused", bearerFrom(req({ authorization: "abc123" })) === null);
check("an empty bearer is null, not an empty string", bearerFrom(req({ authorization: "Bearer " })) === null);
check("whitespace is trimmed", bearerFrom(req({ authorization: "Bearer   abc123  " })) === "abc123");

/*
  A bad id must come back as an answer, not an exception — an agent can read
  "that isn't an id" and correct itself; a 500 tells it nothing.

  In a main() because this file is transformed to CJS, where top-level await
  isn't available.
*/
async function main() {
  console.log("\n── a tool that's handed nonsense ──");

  const bad = await getEntry.run({ id: "not-an-id" } as never);
  check("an unparseable id is answered, not thrown", bad.content[0].text.includes("Not an id"));

  const missing = await getEntry.run({ id: "projects:nothing-by-this-name" } as never);
  check(
    "an id for something unpublished says so",
    missing.content[0].text.includes("Nothing published"),
  );

  console.log(failures === 0 ? "\nAll MCP checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
