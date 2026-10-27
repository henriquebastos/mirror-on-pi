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
    file: "mirror-pi/instructions.md",
    from: "s|[/:]|-|g",
    to: "s|[/:]|_|g",
    suite: INTEGRATION,
  },
  {
    name: "the session search returns tool output",
    file: "mirror-pi/instructions.md",
    from: '(.message.role == "user" or .message.role == "assistant")',
    to: '(.message.role != "system")',
    suite: INTEGRATION,
  },
  {
    name: "the session search leaves out the mirror's replies",
    file: "mirror-pi/instructions.md",
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
    name: "an identity integration is reported but not written",
    file: "mirror-pi/extensions/identity.ts",
    from: "await writeIntegration(target.value);",
    to: "",
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
    name: "the vault's Git tracks the auth link",
    file: "vault/.pi/.gitignore",
    from: "/agent/*\n",
    to: "",
    suite: CONTRACTS,
  },
  {
    name: "the vault's Git leaves out the sessions",
    file: "vault/.pi/.gitignore",
    from: "!/agent/sessions/\n",
    to: "",
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
    name: "the launcher puts the agent directory outside the vault",
    file: "scripts/mirror.sh",
    from: 'agent_dir="$(pwd -P)/.pi/agent"',
    to: 'agent_dir="$HOME/.pi/agent"',
    suite: CONTRACTS,
  },
  {
    name: "the launcher starts pi outside the vault",
    file: "scripts/mirror.sh",
    from: 'cd "$MIRROR_VAULT"\nagent_dir="$(pwd -P)/.pi/agent"',
    to: 'agent_dir="$MIRROR_VAULT/.pi/agent"',
    suite: CONTRACTS,
  },
  {
    name: "entering a journey does not bind the session",
    file: "mirror-pi/extensions/journeys.ts",
    from: "pi.appendEntry<JourneyEntry>(JOURNEY_ENTRY, { slug, from, reason });",
    to: "",
    suite: INTEGRATION,
  },
  {
    name: "a journey entry leaves out where it came from and why",
    file: "mirror-pi/extensions/journeys.ts",
    from: "{ slug, from, reason });",
    to: "{ slug, from: null, reason: \"\" });",
    suite: INTEGRATION,
  },
  {
    name: "a journey that does not exist is entered",
    file: "mirror-pi/extensions/journeys.ts",
    from: "if (journey === undefined) throw new Error(`There is no journey",
    to: "if (journey === null) throw new Error(`There is no journey",
    suite: INTEGRATION,
  },
  {
    name: "the journey's context does not reach the model",
    file: "mirror-pi/extensions/journeys.ts",
    from: "journeySection(ctx.cwd, slug);",
    to: "journeySection(ctx.cwd, undefined);",
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
    name: "the session search skips sessions started in other directories of the vault",
    file: "mirror-pi/instructions.md",
    from: ' "$base"-*--/*.jsonl',
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
    from: ".filter((file) => file.current === undefined && file.path",
    to: ".filter((file) => file.current !== null && file.path",
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
    name: "the projection keeps the Soul skill that Mirror 0.1 projected",
    file: "mirror-pi/src/projection.ts",
    from: "await removeFormerSkill(vault, former);",
    to: "",
    suite: CONTRACTS,
  },
  {
    name: "the projection deletes uncommitted edits of the former Soul skill",
    file: "mirror-pi/src/projection.ts",
    from: "changes(file)).map((file) => file.path), ...former]);",
    to: "changes(file)).map((file) => file.path)]);",
    suite: CONTRACTS,
  },
  {
    name: "the projection deletes the former skill without committing the deletion",
    file: "mirror-pi/src/projection.ts",
    from: "...starter].map((file) => file.path), ...former]);",
    to: "...starter].map((file) => file.path)]);",
    suite: CONTRACTS,
  },
  {
    name: "the Mirror package does not declare the Soul skill",
    file: "package.json",
    from: '"./mirror-pi/skills"',
    to: "",
    suite: INTEGRATION,
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
    from: "await uncommitted(vault, [...[...owned, ...starter].map((file) => file.path), ...former]);",
    to: "await uncommitted(vault, [...written.map((file) => file.path), ...former]);",
    suite: CONTRACTS,
  },
  {
    name: "a directory without Git gets no Git repository",
    file: "mirror-pi/src/projection.ts",
    from: "if (top !== undefined && (await realpath(top)) === vault) return;",
    to: "if (top !== null) return;",
    suite: CONTRACTS,
  },
  {
    name: "a vault with its own identity gets the starter content",
    file: "mirror-pi/src/projection.ts",
    from: ' === undefined && !(await hasEntries(join(vault, "identity")));',
    to: " === undefined;",
    suite: CONTRACTS,
  },
  {
    name: "the migration writes into a vault that already has an identity",
    file: "mirror-pi/src/migration.ts",
    from: "if ((await readdir(join(root, dir)).catch(() => [])).length > 0) return err(",
    to: "if (dir === \"none\") return err(",
    suite: CONTRACTS,
  },
  {
    name: "a migrated conversation is not bound to its journey",
    file: "mirror-pi/src/migration.ts",
    from: "if (conversation.journey !== undefined && journeys.has(conversation.journey)) {",
    to: "if (conversation.journey === \"\") {",
    suite: CONTRACTS,
  },
  {
    name: "a migrated conversation is bound to a journey that no longer exists",
    file: "mirror-pi/src/migration.ts",
    from: "if (conversation.journey !== undefined && journeys.has(conversation.journey)) {",
    to: "if (conversation.journey !== undefined) {",
    suite: CONTRACTS,
  },
  {
    name: "migrated sessions go to a directory Pi does not read",
    file: "mirror-pi/src/migration.ts",
    from: 'return `--${cwd.replace(/^[/\\\\]/, "")',
    to: 'return `-${cwd.replace(/^[/\\\\]/, "")',
    suite: CONTRACTS,
  },
  {
    name: "migrated messages lose their order",
    file: "mirror-pi/src/mirror-mind.ts",
    from: "ORDER BY created_at, rowid",
    to: "ORDER BY created_at DESC, rowid",
    suite: CONTRACTS,
  },
  {
    name: "an identity file is rewritten in migration",
    file: "mirror-pi/src/migration.ts",
    from: "renderMarkdown({ layer: entry.layer }, entry.content)",
    to: "renderMarkdown({ layer: entry.layer }, entry.content.replace(/\\n\\n/g, \"\\n\"))",
    suite: CONTRACTS,
  },
  {
    name: "a memory of a removed journey creates a journey directory",
    file: "mirror-pi/src/migration.ts",
    from: "(memory.journey !== undefined && journeys.has(memory.journey) ? memory.journey : \"\")",
    to: "(memory.journey ?? \"\")",
    suite: CONTRACTS,
  },
  {
    name: "the Mirror Mind database is opened in place",
    file: "mirror-pi/src/mirror-mind.ts",
    from: 'const db = new DatabaseSync(join(dir, "memory.db"));',
    to: 'const db = new DatabaseSync(join(home, "memory.db"));',
    suite: CONTRACTS,
  },
  {
    name: "the hard constraints are left out of the identity section",
    file: "mirror-pi/src/identity-context.ts",
    from: "if (constraints !== \"\") parts.push(",
    to: "if (constraints === \"\\0\") parts.push(",
    suite: CONTRACTS,
  },
  {
    name: "the identity map lists hidden files",
    file: "mirror-pi/src/identity-context.ts",
    from: ".filter((file) => !file.split(\"/\").some((part) => part.startsWith(\".\")))",
    to: "",
    suite: CONTRACTS,
  },
  {
    name: "personas are listed without their description",
    file: "mirror-pi/src/identity-context.ts",
    from: "if (!file.startsWith(\"identity/personas/\") || !file.endsWith(\".md\")) return",
    to: "if (file !== \"\") return",
    suite: CONTRACTS,
  },
  {
    name: "the identity section does not reach the model",
    file: "mirror-pi/extensions/identity.ts",
    from: "if (section !== undefined) event.systemPromptOptions",
    to: "if (section === \"\") event.systemPromptOptions",
    suite: INTEGRATION,
  },
  {
    name: "Mirror's instructions do not reach the model",
    file: "mirror-pi/extensions/instructions.ts",
    from: "event.systemPromptOptions.sections.mirror_instructions = await readFile(INSTRUCTIONS, \"utf8\");",
    to: "await readFile(INSTRUCTIONS, \"utf8\");",
    suite: INTEGRATION,
  },
  {
    name: "the package leaves out the instructions extension",
    file: "package.json",
    from: '"./mirror-pi/extensions/instructions.ts",',
    to: "",
    suite: INTEGRATION,
  },
  {
    name: "a subagent started in the vault is the mirror",
    file: "mirror-pi/src/pi.ts",
    from: "return process.env.PI_SUBAGENT_CHILD === \"1\";",
    to: "return false;",
    suite: INTEGRATION,
  },
  {
    name: "journeys listed in the map are ignored",
    file: "mirror-pi/src/journey.ts",
    from: "[...(local === undefined ? [] : [local]), ...(await listedJourneys(vault)), ...(await journeysDirectory(vault))]",
    to: "[...(await journeysDirectory(vault))]",
    suite: CONTRACTS,
  },
  {
    name: "list items before the Journeys section are journeys",
    file: "mirror-pi/src/journey.ts",
    from: "journeysSection(map).flatMap(",
    to: "map.split(\"\\n\").flatMap(",
    suite: CONTRACTS,
  },
  {
    name: "list items after the Journeys section are journeys",
    file: "mirror-pi/src/journey.ts",
    from: "return end === -1 ? rest : rest.slice(0, end);",
    to: "return rest;",
    suite: CONTRACTS,
  },
  {
    name: "a listed directory outside the vault is a journey",
    file: "mirror-pi/src/journey.ts",
    from: "item.dir.startsWith(resolve(vault) + sep)",
    to: "item.dir !== \"\"",
    suite: CONTRACTS,
  },
  {
    name: "a listed directory that does not exist is a journey",
    file: "mirror-pi/src/journey.ts",
    from: "return inside.filter((_item, index) => exists[index] === true);",
    to: "return inside;",
    suite: CONTRACTS,
  },
  {
    name: "the starter map replaces the user's AGENTS.md",
    file: "mirror-pi/src/projection.ts",
    from: "current.toString(\"utf8\").startsWith(FORMER_INSTRUCTIONS)",
    to: "current.length > 0",
    suite: CONTRACTS,
  },
  {
    name: "Mirror's former instructions stay in AGENTS.md",
    file: "mirror-pi/src/projection.ts",
    from: "const FORMER_INSTRUCTIONS = \"# Mirror",
    to: "const FORMER_INSTRUCTIONS = \"# Never",
    suite: CONTRACTS,
  },
  {
    name: "a map the user deleted is copied again",
    file: "mirror-pi/src/projection.ts",
    from: "(await readOptional(join(vault, SETTINGS))) === undefined : current",
    to: "true : current",
    suite: CONTRACTS,
  },
  {
    name: "a vault that Mirror has not projected before gets no map",
    file: "mirror-pi/src/projection.ts",
    from: "(await readOptional(join(vault, SETTINGS))) === undefined : current",
    to: "false : current",
    suite: CONTRACTS,
  },
  {
    name: "a journey's context is its AGENTS.md",
    file: "mirror-pi/src/journey.ts",
    from: 'export const JOURNEY_FILE = "JOURNEY.md";',
    to: 'export const JOURNEY_FILE = "AGENTS.md";',
    suite: INTEGRATION,
  },
  {
    name: "a session started in a journey directory gets no journey section",
    file: "mirror-pi/extensions/journeys.ts",
    from: "?? (await localJourney(ctx.cwd))?.slug;",
    to: "?? undefined;",
    suite: INTEGRATION,
  },
  {
    name: "migrated journeys keep their context in AGENTS.md",
    file: "mirror-pi/src/migration.ts",
    from: 'join("journeys", entry.key, JOURNEY_FILE)',
    to: 'join("journeys", entry.key, "AGENTS.md")',
    suite: CONTRACTS,
  },
  {
    name: "identity discovery uses the parent instead of cwd",
    file: "mirror-pi/extensions/identity.ts",
    from: "await identitySection(ctx.cwd);",
    to: "await identitySection(`${ctx.cwd}/..`);",
    suite: INTEGRATION,
  },
  {
    name: "journeys depend on identity again",
    file: "mirror-pi/extensions/journeys.ts",
    from: "if (isSubagent()) return;",
    to: "if (isSubagent() || !(await import(\"node:fs\")).existsSync(`${ctx.cwd}/identity`)) return;",
    suite: INTEGRATION,
  },
  {
    name: "instructions depend on identity again",
    file: "mirror-pi/extensions/instructions.ts",
    from: "if (isSubagent()) return;",
    to: "if (isSubagent() || !(await import(\"node:fs\")).existsSync(`${process.cwd()}/identity`)) return;",
    suite: INTEGRATION,
  },
  {
    name: "an empty cwd gets an empty journey section",
    file: "mirror-pi/src/journey.ts",
    from: "if (journeys.length === 0 && slug === undefined) return undefined;",
    to: "",
    suite: INTEGRATION,
  },
  {
    name: "local JOURNEY.md is ignored",
    file: "mirror-pi/src/journey.ts",
    from: "const local = await localJourney(vault);",
    to: "const local = undefined;",
    suite: CONTRACTS,
  },
  {
    name: "a directory named JOURNEY.md is a journey",
    file: "mirror-pi/src/journey.ts",
    from: "?.isFile() !== true",
    to: "?.isDirectory() !== true",
    suite: CONTRACTS,
  },
  {
    name: "the map replaces the local journey with the same slug",
    file: "mirror-pi/src/journey.ts",
    from: "[...(local === undefined ? [] : [local]), ...(await listedJourneys(vault)), ...(await journeysDirectory(vault))]",
    to: "[...(await listedJourneys(vault)), ...(local === undefined ? [] : [local]), ...(await journeysDirectory(vault))]",
    suite: CONTRACTS,
  },
  {
    name: "records ignore the local journey",
    file: "mirror-pi/src/pi.ts",
    from: "slug === undefined ? await localJourney(ctx.cwd) :",
    to: "slug === undefined ? undefined :",
    suite: INTEGRATION,
  },
  {
    name: "identity integration creates structure that is absent from cwd",
    file: "mirror-pi/src/identity.ts",
    from: "if (!(await isDirectory(join(vault, \"identity\")))) return err(`No identity/ directory in ${vault}`);",
    to: "",
    suite: INTEGRATION,
  },
  {
    name: "an explicit binding cannot override the local journey",
    file: "mirror-pi/extensions/journeys.ts",
    from: "boundSlug(ctx.sessionManager.getBranch()) ?? (await localJourney(ctx.cwd))?.slug",
    to: "(await localJourney(ctx.cwd))?.slug ?? boundSlug(ctx.sessionManager.getBranch())",
    suite: INTEGRATION,
  },
  {
    name: "a switch from the cwd journey loses its origin",
    file: "mirror-pi/extensions/journeys.ts",
    from: "const from = boundSlug(ctx.sessionManager.getBranch()) ?? (await localJourney(ctx.cwd))?.slug ?? null;",
    to: "const from = boundSlug(ctx.sessionManager.getBranch()) ?? null;",
    suite: INTEGRATION,
  },
  {
    name: "records prefer the local default over the explicit binding",
    file: "mirror-pi/src/pi.ts",
    from: "slug === undefined ? await localJourney(ctx.cwd) : await findJourneyBySlug(ctx.cwd, slug)",
    to: "(await localJourney(ctx.cwd)) ?? (slug === undefined ? undefined : await findJourneyBySlug(ctx.cwd, slug))",
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
