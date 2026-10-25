// Negative controls: break one guarantee at a time and require the evals to fail.
// Each mutant edits one source or Mirror-owned vault file in place and always restores it.
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
    name: "a nested directory does not find its journey",
    file: "mirror-pi/src/journey.ts",
    from: "dirname(dir) !== dir; dir = dirname(dir)) {",
    to: "dirname(dir) !== dir; dir = \"/\") {",
    suite: CONTRACTS,
  },
  {
    name: "a directory outside the journeys directory counts as a journey",
    file: "mirror-pi/src/journey.ts",
    from: 'if (basename(dirname(dir)) === "journeys")',
    to: 'if (basename(dirname(dir)) !== "")',
    suite: CONTRACTS,
  },
  {
    name: "journal overwrites an existing entry",
    file: "mirror-pi/src/records.ts",
    from: 'await writeFile(path, text, { flag: "wx" });',
    to: "await writeFile(path, text);",
    suite: CONTRACTS,
  },
  {
    name: "a record is saved outside a journey",
    file: "mirror-pi/src/pi.ts",
    from: "if (journey === undefined) throw",
    to: "if (journey === null) throw",
    suite: INTEGRATION,
  },
  {
    name: "the session search looks in another directory",
    file: "vault/AGENTS.md",
    from: "s|[/:]|-|g",
    to: "s|[/:]|_|g",
    suite: INTEGRATION,
  },
  {
    name: "the session search returns tool output",
    file: "vault/AGENTS.md",
    from: '(.message.role == "user" or .message.role == "assistant")',
    to: '(.message.role != "system")',
    suite: INTEGRATION,
  },
  {
    name: "the session search leaves out the mirror's replies",
    file: "vault/AGENTS.md",
    from: '(.message.role == "user" or .message.role == "assistant")',
    to: '(.message.role == "user")',
    suite: INTEGRATION,
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
    name: "the launcher starts another Pi version",
    file: "scripts/mirror.sh",
    from: 'if [ "$installed" != "$pinned" ]; then',
    to: "if false; then",
    suite: CONTRACTS,
  },
  {
    name: "the launcher uses the personal agent directory",
    file: "scripts/mirror.sh",
    from: 'export PI_CODING_AGENT_DIR="$agent_dir"',
    to: "",
    suite: CONTRACTS,
  },
  {
    name: "the launcher replaces settings the user changed",
    file: "scripts/mirror.sh",
    from: '[ -e "$agent_dir/settings.json" ] || cp',
    to: "cp",
    suite: CONTRACTS,
  },
  {
    name: "the launcher starts pi outside the vault",
    file: "scripts/mirror.sh",
    from: 'cd "$MIRROR_VAULT"',
    to: "",
    suite: CONTRACTS,
  },
  {
    name: "a journey is entered without the user's confirmation",
    file: "mirror-pi/extensions/journeys.ts",
    from: "if (!confirmed) {",
    to: "if (confirmed && !confirmed) {",
    suite: INTEGRATION,
  },
  {
    name: "a session without a user asks an absent user",
    file: "mirror-pi/extensions/journeys.ts",
    from: "if (!ctx.hasUI) {",
    to: "if (ctx.hasUI && !ctx.hasUI) {",
    suite: INTEGRATION,
  },
  {
    name: "a declined proposal is recorded as confirmed",
    file: "mirror-pi/extensions/journeys.ts",
    from: 'record(confirmed ? "confirmed" : "declined");',
    to: 'record("confirmed");',
    suite: INTEGRATION,
  },
  {
    name: "the journey's context does not reach the model",
    file: "mirror-pi/extensions/journeys.ts",
    from: "journeySection(vault, boundSlug(ctx.sessionManager.getBranch()))",
    to: "journeySection(vault, undefined)",
    suite: INTEGRATION,
  },
  {
    name: "records go to the first journey after a switch",
    file: "mirror-pi/src/journey.ts",
    from: "branch.findLast(",
    to: "branch.find(",
    suite: INTEGRATION,
  },
  {
    name: "the session search skips sessions stored under journey directories",
    file: "vault/AGENTS.md",
    from: ' "$base"-journeys-*--/*.jsonl',
    to: "",
    suite: INTEGRATION,
  },
  {
    name: "the package leaves out the journeys extension",
    file: "package.json",
    from: '"./mirror-pi/extensions/journeys.ts",',
    to: "",
    suite: INTEGRATION,
  },
  {
    name: "the vault does not declare Mirror's package",
    file: "mirror-pi/src/projection.ts",
    from: "packages: [resolve(repo)]",
    to: "packages: []",
    suite: INTEGRATION,
  },
  {
    name: "the projection overwrites uncommitted edits of Mirror files",
    file: "mirror-pi/src/projection.ts",
    from: "if (conflicts.length > 0) {",
    to: "if (conflicts.length > 999) {",
    suite: CONTRACTS,
  },
  {
    name: "starter content replaces the user's files",
    file: "mirror-pi/src/projection.ts",
    from: ".filter((file) => file.current === undefined)",
    to: ".filter((file) => file.current !== null)",
    suite: CONTRACTS,
  },
  {
    name: "starter content is copied again into an existing vault",
    file: "mirror-pi/src/projection.ts",
    from: "const starter = fresh ?",
    to: "const starter = true ?",
    suite: CONTRACTS,
  },
  {
    name: "the projection commits the user's staged work",
    file: "mirror-pi/src/projection.ts",
    from: '"--only", "--", ...paths]',
    to: '"--all"]',
    suite: CONTRACTS,
  },
  {
    name: "Mirror files that already matched stay uncommitted",
    file: "mirror-pi/src/projection.ts",
    from: "await uncommitted(vault, [...owned, ...starter].map((file) => file.path));",
    to: "await uncommitted(vault, written.map((file) => file.path));",
    suite: CONTRACTS,
  },
  {
    name: "a directory without Git gets no Git repository",
    file: "mirror-pi/src/projection.ts",
    from: "if (top !== undefined && (await realpath(top)) === vault) return;",
    to: "if (top !== null) return;",
    suite: CONTRACTS,
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
