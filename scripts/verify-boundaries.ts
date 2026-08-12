/*
  Catches a server file calling a client function.

  A "use client" module doesn't export functions to the server — it exports
  *references* to them. Importing a plain helper from one into a server
  component compiles, type-checks and builds without complaint, then throws
  "Attempted to call X() from the server" the first time a page renders. That
  shipped: buildPaletteEntries lived beside the palette component, app/layout.tsx
  imported it, and every page returned 500 in production while `next build` had
  been perfectly happy.

  The rule this enforces: a server file may import components and types across
  the boundary, never values. Components are fine because React never calls them
  on the server — it serialises the reference and the browser does the calling.
  Types vanish at compile time. Anything else is a call across a wire.

  Heuristic, deliberately: an uppercase name is treated as a component. That's
  the convention React itself requires, so it holds wherever it matters.

  Run: npx tsx scripts/verify-boundaries.ts
*/

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** A module is a client module if its first meaningful line says so. */
function isClientModule(path: string): boolean {
  const head = readFileSync(path, "utf8").slice(0, 400);
  return /^\s*(\/\*[\s\S]*?\*\/\s*)?["']use client["']/.test(head);
}

/** Resolves an import specifier to a file, or null if it isn't ours. */
function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = resolve(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // a package

  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;

console.log("\n── nothing calls a client function from the server ──");

const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components")), ...walk(join(ROOT, "lib"))];
let crossings = 0;

for (const file of files) {
  if (isClientModule(file)) continue; // client → client is fine

  const source = readFileSync(file, "utf8");
  for (const [, typeOnly, names, spec] of source.matchAll(IMPORT)) {
    if (typeOnly) continue;

    const target = resolveImport(file, spec);
    if (!target || !isClientModule(target)) continue;

    for (const raw of names.split(",")) {
      const name = raw.trim();
      if (!name) continue;
      // `import { type Foo }` — erased, harmless.
      if (name.startsWith("type ")) continue;

      const local = (name.split(/\s+as\s+/).pop() ?? name).trim();
      crossings++;
      check(
        `${file.slice(ROOT.length + 1)} imports ${local} from a client module`,
        /^[A-Z]/.test(local),
        /^[A-Z]/.test(local) ? "component" : "lowercase name — a server render would call it across the boundary",
      );
    }
  }
}

check("some server→client imports were actually inspected", crossings > 0, `${crossings} found`);

console.log(failures === 0 ? "\nAll boundary checks passed.\n" : `\n${failures} boundary check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
