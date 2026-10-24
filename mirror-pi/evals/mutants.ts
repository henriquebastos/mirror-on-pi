// Negative controls: break one guarantee at a time and require the evals to fail.
// Each mutant edits one source or vault file in place and always restores it.
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
    name: "a journey's marker project is ignored",
    file: "mirror-pi/src/journey.ts",
    from: "scope: { workspace, project } });",
    to: 'scope: { workspace, project: "health" } });',
    suite: CONTRACTS,
  },
  {
    name: "a nested directory does not find its journey marker",
    file: "mirror-pi/src/journey.ts",
    from: "    const parent = dirname(dir);\n    if (parent === dir) return ok(undefined);",
    to: "    const parent = dirname(dir);\n    if (parent !== dir) return ok(undefined);",
    suite: CONTRACTS,
  },
  {
    name: "a journey's marker names another journey's project",
    file: "content/journeys/career/.ai-memory.toml",
    from: 'project = "career"',
    to: 'project = "health"',
    suite: INTEGRATION,
  },
  {
    name: "journal overwrites an existing entry",
    file: "mirror-pi/src/records.ts",
    from: 'await writeFile(path, text, { flag: "wx" });',
    to: 'await writeFile(path.replace(/-\\d+\\.md$/, ".md"), text);',
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
    name: "an identity integration replaces the file instead of appending",
    file: "mirror-pi/src/identity.ts",
    from: "appendIntegration(current, target.section, target.bullet)",
    to: "appendIntegration(\"\", target.section, target.bullet)",
    suite: CONTRACTS,
  },
  {
    name: "a self integration goes to another layer's section",
    file: "mirror-pi/src/identity.ts",
    from: "self: \"New Incorporated Principles\",",
    to: "self: \"New Operational Patterns Identified\",",
    suite: CONTRACTS,
  },
  {
    name: "an identity integration is written although the user declined",
    file: "mirror-pi/extensions/identity.ts",
    from: "if (!confirmed) {",
    to: "if (confirmed && !confirmed) {",
    suite: INTEGRATION,
  },
  {
    name: "recalled memory is not given to the model",
    file: "mirror-pi/extensions/recall.ts",
    from: "return content === undefined ? undefined : { message: { customType: MEMORY_CONTEXT_TYPE, content, display: false } };",
    to: "return content === undefined ? undefined : undefined;",
    suite: INTEGRATION,
  },
  {
    name: "unavailable memory is hidden from the model",
    file: "mirror-pi/src/memory-context.ts",
    from: "  if (input.failure !== undefined) {",
    to: "  if (false) {",
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
