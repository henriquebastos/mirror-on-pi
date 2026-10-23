// Negative controls: break one guarantee at a time and require the evals to fail.
// Each mutant edits one source file in place and always restores it.
// Usage: node mirror-pi/evals/mutants.ts [--integration]
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CONTRACTS = "mirror-pi/evals/contracts/";
const INTEGRATION = "mirror-pi/evals/integration/";

type Mutant = {
  readonly name: string;
  readonly file: string;
  readonly from: string;
  readonly to: string;
  readonly suite: string;
};

const MUTANTS: readonly Mutant[] = [
  {
    name: "journey binding ignores a different journey",
    file: "mirror-pi/src/binding.ts",
    from: 'return sameBinding(first, requested) ? { kind: "bound", binding: first } : { kind: "mismatch", existing: first, requested };',
    to: 'return { kind: "bound", binding: first };',
    suite: CONTRACTS,
  },
  {
    name: "vault guard accepts any path",
    file: "mirror-pi/src/paths.ts",
    from: "return isWithin(realRoot, realCandidate) ? ok(realCandidate)",
    to: "return true ? ok(realCandidate)",
    suite: CONTRACTS,
  },
  {
    name: "Pi's @ prefix is not stripped before the vault check",
    file: "mirror-pi/src/paths.ts",
    from: 'const path = spaced.startsWith("@") ? spaced.slice(1) : spaced;',
    to: "const path = spaced;",
    suite: CONTRACTS,
  },
  {
    name: "file:// URLs pass the vault check",
    file: "mirror-pi/src/paths.ts",
    from: 'if (path.startsWith("~") || /^file:/i.test(path))',
    to: 'if (path.startsWith("~"))',
    suite: CONTRACTS,
  },
  {
    name: "reads of missing files reach Pi's look-alike fallback",
    file: "mirror-pi/src/extension.ts",
    from: 'if (toolName === "read" && !(await existsExactly(resolved.value)))',
    to: "if (false)",
    suite: CONTRACTS,
  },
  {
    name: "tools outside the Mirror list are allowed",
    file: "mirror-pi/src/extension.ts",
    from: "if (!ALLOWED_TOOLS.includes(toolName)) return",
    to: "if (false) return",
    suite: CONTRACTS,
  },
  {
    name: "a failing extension factory leaves Pi unguarded",
    file: "mirror-pi/extension/index.ts",
    from: "blockAll(pi, `Mirror failed to start",
    to: "void (pi, `Mirror failed to start",
    suite: CONTRACTS,
  },
  {
    name: "a blocked session still allows tool calls",
    file: "mirror-pi/extension/index.ts",
    from: '  pi.on("tool_call", () => ({ block: true,',
    to: '  pi.on("tool_call", () => ({ block: false,',
    suite: CONTRACTS,
  },
  {
    name: "a page-name conflict leaves the record unpublished",
    file: "mirror-pi/src/records.ts",
    from: 'memory.error.reason === "precondition_failed"',
    to: 'memory.error.reason === "never"',
    suite: CONTRACTS,
  },
  {
    name: "journeys sharing a project go unreported",
    file: "mirror-pi/src/content.ts",
    from: ".filter(([, slugs]) => slugs.length > 1)",
    to: ".filter(() => false)",
    suite: CONTRACTS,
  },
  {
    name: "unavailable memory is hidden from the model",
    file: "mirror-pi/src/memory-context.ts",
    from: "  if (input.failure !== undefined) {",
    to: "  if (false) {",
    suite: INTEGRATION,
  },
  {
    name: "find globs may climb out of the vault",
    file: "mirror-pi/src/paths.ts",
    from: 'return !glob.split(/[\\\\/]/).includes("..");',
    to: "return true;",
    suite: CONTRACTS,
  },
  {
    name: "composition puts the journey before identity",
    file: "mirror-pi/src/compose.ts",
    from: 'add("⛔ HARD CONSTRAINTS", identity.constraints);',
    to: 'add(`journey/${options.journey.slug}`, renderJourney(options.journey));\n  add("⛔ HARD CONSTRAINTS", identity.constraints);',
    suite: CONTRACTS,
  },
  {
    name: "capture forgets unacknowledged events",
    file: "mirror-pi/src/capture.ts",
    from: "this.#pending.splice(0, batch.length, ...remaining);",
    to: "this.#pending.splice(0, batch.length);",
    suite: CONTRACTS,
  },
  {
    name: "journal overwrites an existing entry",
    file: "mirror-pi/src/records.ts",
    from: 'await writeFile(path, text, { flag: "wx" });',
    to: 'await writeFile(path.replace(/-\\d+\\.md$/, ".md"), text);',
    suite: CONTRACTS,
  },
  {
    name: "capture sends every journey to one project",
    file: "mirror-pi/src/extension.ts",
    from: "const scope = { workspace: options.workspace, project: journey.value.memoryProject };",
    to: 'const scope = { workspace: options.workspace, project: "health" };',
    suite: INTEGRATION,
  },
  {
    name: "recalled memory is not given to the model",
    file: "mirror-pi/src/extension.ts",
    from: "return content === undefined ? undefined : { message: { customType: MEMORY_CONTEXT_TYPE, content, display: false } };",
    to: "return content === undefined ? undefined : undefined;",
    suite: INTEGRATION,
  },
  {
    name: "a blocked session still runs the model",
    file: "mirror-pi/src/extension.ts",
    from: '      notify(ctx, `Mirror is blocked: ${state.reason}`, "error");\n      return { action: "handled" as const };',
    to: '      notify(ctx, `Mirror is blocked: ${state.reason}`, "error");\n      return { action: "continue" as const };',
    suite: INTEGRATION,
  },
];

async function run(includeIntegration: boolean): Promise<number> {
  let survivors = 0;
  for (const mutant of MUTANTS) {
    if (mutant.suite === INTEGRATION && !includeIntegration) {
      console.log(`skip   ${mutant.name} (needs --integration)`);
      continue;
    }
    const path = join(ROOT, mutant.file);
    const original = await readFile(path, "utf8");
    if (!original.includes(mutant.from)) throw new Error(`Mutant "${mutant.name}" no longer matches ${mutant.file}`);
    try {
      await writeFile(path, original.replace(mutant.from, mutant.to));
      const result = spawnSync("node", ["--test", "--test-concurrency=1", mutant.suite], { cwd: ROOT, encoding: "utf8", timeout: 300_000 });
      const killed = result.status !== 0;
      if (!killed) survivors++;
      console.log(`${killed ? "killed" : "SURVIVED"} ${mutant.name}`);
    } finally {
      await writeFile(path, original);
    }
  }
  return survivors === 0 ? 0 : 1;
}

process.exitCode = await run(process.argv.includes("--integration"));
