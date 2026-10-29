// The four arms of the parity comparison, built from one synthetic person: the starter vault (Sam).
// A0: the vault's identity and map, no Mirror. A1: Mirror's instructions and Soul skill as plain text, no extensions.
// A2: Mirror 0.2.0 as the vault's Pi package. A3: Mirror Mind as a Pi package, with the same identity and journeys seeded
// into its database. Every arm runs the same Pi, the same default tools, and an empty home directory.
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { identitySection } from "../../../src/identity-context.ts";
import { journeySection, listJourneys } from "../../../src/journey.ts";
import { parseMarkdown } from "../../../src/markdown.ts";
import { projectVault } from "../../../src/projection.ts";
import { REPO } from "../../support/content.ts";
import { EVAL_AUTH, keyEnv } from "../../support/credentials.ts";
import { exec } from "./process.ts";
import { MIRROR_MIND, MIRROR_MIND_BIN } from "./reference.ts";

// `x2` and `x3` are negative controls, not arms of the comparison: A2 and A3 with an extension that saves a record and
// changes the identity after every turn, whatever the model does. The probes must report both.
export type Arm = "a0" | "a1" | "a2" | "a3" | "x2" | "x3";
export const ARMS: readonly Arm[] = ["a0", "a1", "a2", "a3"];
export const ALL_ARMS: readonly Arm[] = [...ARMS, "x2", "x3"];

// The Mirror Mind arms, which keep their state in a database.
export function usesMirrorMind(arm: Arm): boolean {
  return arm === "a3" || arm === "x3";
}

// Where one arm instance lives. `cwd` is where Pi starts; `agent` is its agent directory.
export type ArmDirs = { readonly root: string; readonly cwd: string; readonly agent: string; readonly home: string; readonly mirrorHome: string };

export function armDirs(arm: Arm, root: string): ArmDirs {
  return { root, cwd: join(root, usesMirrorMind(arm) ? "work" : "vault"), agent: join(root, "agent"), home: join(root, "home"), mirrorHome: join(root, "mirror-home") };
}

const SOUL = join(REPO, "mirror-pi", "skills", "soul");

export async function prepareArm(arm: Arm, root: string): Promise<ArmDirs> {
  const dirs = armDirs(arm, root);
  await mkdir(dirs.home, { recursive: true });
  await mkdir(join(root, "tmp"), { recursive: true });
  await mkdir(join(dirs.agent, "sessions"), { recursive: true });
  await linkAuth(dirs.agent);
  await writeFile(join(dirs.agent, "settings.json"), `${JSON.stringify(usesMirrorMind(arm) ? { packages: [MIRROR_MIND] } : {}, null, 2)}\n`);
  const vault = usesMirrorMind(arm) ? join(root, "source-vault") : dirs.cwd;
  const projection = await projectVault(REPO, vault);
  if (!projection.ok) throw new Error(projection.error);
  if (arm === "a0" || arm === "a1") await withoutMirror(vault);
  if (arm === "a1") await addPlainMirror(vault);
  if (usesMirrorMind(arm)) await seedMirrorMind(vault, dirs);
  if (arm === "x2") await writeControl(join(vault, ".pi", "extensions"), VAULT_CONTROL);
  if (arm === "x3") await writeControl(join(dirs.agent, "extensions"), MIRROR_MIND_CONTROL);
  return dirs;
}

// Pi's session directory name for a working directory.
export function sessionDirName(cwd: string): string {
  return `--${cwd.replace(/^\//, "").replace(/[/:]/g, "-")}--`;
}

// The named auth file, when there is one; otherwise Pi uses the provider keys of armEnv.
export async function linkAuth(agent: string): Promise<void> {
  await rm(join(agent, "auth.json"), { force: true });
  if (EVAL_AUTH !== undefined) await symlink(EVAL_AUTH, join(agent, "auth.json"));
}

// The vault without the Mirror package and without the vault README, which describes Mirror.
async function withoutMirror(vault: string): Promise<void> {
  await rm(join(vault, ".pi", "settings.json"));
  await rm(join(vault, "README.md"));
  await commit(vault, "Remove Mirror");
}

const VAULT_CONTROL = `import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export default function (pi) {
  let turn = 0;
  pi.on("agent_end", async (_event, ctx) => {
    turn += 1;
    mkdirSync(join(ctx.cwd, "journeys", "health", "journal"), { recursive: true });
    writeFileSync(join(ctx.cwd, "journeys", "health", "journal", "control-" + turn + ".md"), "# Control " + turn + "\\n");
    appendFileSync(join(ctx.cwd, "identity", "self", "soul.md"), "\\n- control " + turn + "\\n");
  });
}
`;

const MIRROR_MIND_CONTROL = `export default function (pi) {
  let turn = 0;
  pi.on("agent_end", async () => {
    turn += 1;
    await pi.exec("mirror", ["journal", "control entry " + turn, "--journey", "health"]);
    await pi.exec("mirror", ["identity", "set", "self", "soul", "--content", "control " + turn]);
  });
}
`;

async function writeControl(dir: string, source: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "negative-control.ts"), source);
}

// A1: what Mirror 0.2.0 adds, as text a user could keep in the vault. The instructions with file steps instead of tools,
// the identity and journey summaries that the extensions would add, and the Soul skill with the same two replacements.
async function addPlainMirror(vault: string): Promise<void> {
  const instructions = (await readFile(join(import.meta.dirname, "a1-instructions.md"), "utf8")).replace(/^# Mirror\n/, "## Mirror\n").replace(/^## /gm, "### ").replace(/^### Mirror\n/m, "## Mirror\n");
  const identity = ((await identitySection(vault)) ?? "").replace(/^## /gm, "#### ");
  const journeys = (await journeySection(vault, undefined)) ?? "";
  const map = await readFile(join(vault, "AGENTS.md"), "utf8");
  await writeFile(join(vault, "AGENTS.md"), `${map.trimEnd()}\n\n${instructions.trimEnd()}\n\n### Identity summary\n\n${identity}\n\n### Journeys summary\n\n${journeys}\n`);
  const skill = join(vault, ".agents", "skills", "soul");
  await cp(SOUL, skill, { recursive: true });
  const file = join(skill, "SKILL.md");
  await writeFile(file, replaceOnce(await readFile(file, "utf8"), SKILL_REPLACEMENTS));
  await commit(vault, "Mirror as plain text");
}

const SKILL_REPLACEMENTS: readonly (readonly [string, string])[] = [
  ["call `mirror_save_journal` once, in the session's journey.", "save it once as a journal entry in the session's journey, as Mirror's instructions say."],
  ["call `mirror_integrate_identity` once for each recorded layer, with that layer's exact text from the last proposal.", "append that layer's exact text from the last proposal to its identity file, once for each recorded layer, as Mirror's instructions say."],
  ['Say a layer was recorded only when the result says "Added to".', "Say a layer was recorded only when the `edit` result confirms it."],
];

export function replaceOnce(text: string, replacements: readonly (readonly [string, string])[]): string {
  return replacements.reduce((current, [from, to]) => {
    if (current.split(from).length !== 2) throw new Error(`Expected one match of: ${from}`);
    return current.replace(from, to);
  }, text);
}

async function commit(vault: string, message: string): Promise<void> {
  await exec("git", ["add", "-A"], { cwd: vault });
  await exec("git", ["commit", "-q", "-m", message], { cwd: vault });
}

// A3: the same identity and journeys, written as Mirror Mind's identity YAML in a new Mirror home, then `mirror seed`.
async function seedMirrorMind(vault: string, dirs: ArmDirs): Promise<void> {
  await mkdir(dirs.cwd, { recursive: true });
  const identity = join(dirs.mirrorHome, "identity");
  for (const [layer, key, field] of CORE) {
    const body = await markdownBody(join(vault, "identity", layer, `${key}.md`));
    if (body !== undefined) await writeYaml(join(identity, layer, `${key}.yaml`), [["version", "1.0.0"]], [[field, body]]);
  }
  for (const file of await readdir(join(vault, "identity", "personas"))) await writePersona(vault, identity, file.replace(/\.md$/, ""));
  for (const journey of await listJourneys(vault)) {
    const document = parseMarkdown(await readFile(join(journey.dir, "JOURNEY.md"), "utf8"));
    if (!document.ok) throw new Error(document.error);
    const front = document.value.frontmatter;
    const name = typeof front.title === "string" ? front.title : journey.slug;
    const status = typeof front.status === "string" ? front.status : "active";
    await writeYaml(join(identity, "journeys", `${journey.slug}.yaml`), [["journey_id", journey.slug], ["name", name], ["status", status], ["version", "1.0.0"]], [["description", journey.description], ["briefing", journey.description], ["context", document.value.body]]);
  }
  await exec("mirror", ["seed"], { env: mirrorMindEnv(dirs) });
}

// The identity files that Mirror Mind seeds, with the YAML field of each.
const CORE: readonly (readonly [layer: string, key: string, field: string])[] = [
  ["self", "soul", "soul"],
  ["ego", "identity", "identity"],
  ["ego", "behavior", "behavior"],
  ["ego", "constraints", "constraints"],
  ["user", "identity", "user"],
  ["organization", "identity", "identity"],
  ["organization", "principles", "principles"],
  ["shadow", "profile", "profile"],
];

// A persona keeps Mirror Mind's own routing keywords for the same persona, so its routing works as designed.
async function writePersona(vault: string, identity: string, id: string): Promise<void> {
  const document = parseMarkdown(await readFile(join(vault, "identity", "personas", `${id}.md`), "utf8"));
  if (!document.ok) throw new Error(document.error);
  const template = await readFile(join(MIRROR_MIND, "templates", "identity", "personas", `${id}.yaml`), "utf8").catch(() => "");
  const keywords = /^routing_keywords:\n((?:- .*\n)+)/m.exec(template)?.[1] ?? "";
  const name = typeof document.value.frontmatter.name === "string" ? document.value.frontmatter.name : id;
  const description = typeof document.value.frontmatter.description === "string" ? document.value.frontmatter.description : "";
  const file = join(identity, "personas", `${id}.yaml`);
  await writeYaml(file, [["persona_id", id], ["name", name], ["version", "1.0.0"], ["inherits_from", "self"]], [["description", description], ["system_prompt", document.value.body], ["briefing", description]]);
  await writeFile(file, `${await readFile(file, "utf8")}routing_keywords:\n${keywords}`);
}

async function markdownBody(path: string): Promise<string | undefined> {
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  const document = parseMarkdown(text);
  return document.ok ? document.value.body : text;
}

// Scalars as quoted strings, texts as literal blocks.
async function writeYaml(path: string, scalars: readonly (readonly [string, string])[], blocks: readonly (readonly [string, string])[]): Promise<void> {
  const lines = [
    ...scalars.map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
    ...blocks.flatMap(([key, value]) => [`${key}: |`, ...value.trimEnd().split("\n").map((line) => (line === "" ? "" : `  ${line}`))]),
  ];
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${lines.join("\n")}\n`);
}

// The environment of every Pi process and of Mirror Mind's CLI: an empty home, the arm's agent directory, the provider
// keys, and no other shell variables of this machine. A3 also gets its Mirror home, the `mirror` command, and the
// OpenRouter key for its own model calls.
export function armEnv(arm: Arm, dirs: ArmDirs, openRouterKey?: string): Record<string, string> {
  const base: Record<string, string> = {
    HOME: dirs.home,
    TMPDIR: join(dirs.root, "tmp"),
    LANG: "en_US.UTF-8",
    PATH: TOOL_PATH.join(":"),
    PI_CODING_AGENT_DIR: dirs.agent,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    ...keyEnv(),
  };
  return usesMirrorMind(arm) ? { ...base, ...mirrorMindEnv(dirs), ...(openRouterKey === undefined ? {} : { OPENROUTER_API_KEY: openRouterKey }) } : base;
}

// Node and the directories of rg, git, and jq on this machine, then the system directories; `mirror` only in A3.
export const TOOL_PATH: readonly string[] = [...new Set([
  dirname(process.execPath),
  ...["rg", "git", "jq"].flatMap((tool) => (process.env.PATH ?? "").split(":").filter((dir) => dir !== "" && existsSync(join(dir, tool))).slice(0, 1)),
  "/usr/bin",
  "/bin",
])];

function mirrorMindEnv(dirs: ArmDirs): Record<string, string> {
  return { HOME: dirs.home, MIRROR_HOME: dirs.mirrorHome, PATH: [MIRROR_MIND_BIN, ...TOOL_PATH].join(":") };
}
