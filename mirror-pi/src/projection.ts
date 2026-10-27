// Project the Mirror repository into a vault: a separate directory with its own Git repository.
// Mirror owns the files in the repository's `vault/` directory and the vault's `.pi/settings.json`, which loads this
// repository as a Pi package with Mirror's extensions. Every projection writes them.
// The files in `starter/` become the user's: they are copied only into a new vault, one without `AGENTS.md` and without
// an `identity/` directory (a migrated vault has its own), and never replace a file. Records, state notes, and every other file of the user are never touched.
// The vault's `AGENTS.md` is the user's map. The starter map goes into every vault that Mirror has not projected before,
// a migrated one too. It replaces, once, the instructions that Mirror 0.1.0 and 0.1.1 kept in that file.
// Mirror 0.1 also projected the Soul skill into `.agents/skills/soul/`. Pi now loads it from the package, so the projection
// deletes that copy, which Git keeps in history. A copy with uncommitted changes stops the projection like any Mirror file.
// The projection commits only its own files, so each projection is one reviewable commit in the vault.
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { VAULT_MAP } from "./journey.ts";
import { err, ok, type Result } from "./result.ts";

export type FileOutcome = "created" | "updated" | "kept" | "deleted";

export type ProjectedFile = {
  readonly path: string;
  readonly outcome: FileOutcome;
};

export type Projection = {
  readonly vault: string;
  readonly files: readonly ProjectedFile[];
  // The vault commit that holds the projection, or undefined when nothing changed.
  readonly commit: string | undefined;
};

type PlannedFile = {
  readonly path: string;
  readonly content: Buffer;
  readonly current: Buffer | undefined;
};

const run = promisify(execFile);

const SETTINGS = join(".pi", "settings.json");
// Every AGENTS.md that Mirror 0.1.0 and 0.1.1 projected starts with this text.
const FORMER_INSTRUCTIONS = "# Mirror\n\nThis directory is a Mirror vault.";
// The files of the Soul skill that Mirror 0.1 projected into the vault.
const FORMER_SKILL = join(".agents", "skills", "soul");
const FORMER_FILES = ["SKILL.md", ...["beauty", "self", "shadow", "wisdom"].map((voice) => join("voices", `${voice}.md`))].map((file) => join(FORMER_SKILL, file));

export async function projectVault(repo: string, target: string): Promise<Result<Projection, string>> {
  await mkdir(target, { recursive: true });
  const vault = await realpath(target);
  await ensureGitRepository(vault);
  const fresh = (await readOptional(join(vault, "AGENTS.md"))) === undefined && !(await hasEntries(join(vault, "identity")));
  const map = await planMap(repo, vault);
  const owned = [...(await planFiles(join(repo, "vault"), vault)), await planSettings(repo, vault), ...(map === undefined ? [] : [map])];
  const former = await existing(vault, FORMER_FILES);
  const conflicts = await uncommitted(vault, [...owned.filter((file) => file.current !== undefined && changes(file)).map((file) => file.path), ...former]);
  if (conflicts.length > 0) {
    return err(`Uncommitted changes in files that Mirror owns: ${conflicts.join(", ")}. Commit or discard them, then run again.`);
  }
  const starter = fresh ? (await planFiles(join(repo, "starter"), vault)).filter((file) => file.current === undefined && file.path !== VAULT_MAP) : [];
  const files = [...[...owned, ...starter].map((file) => ({ path: file.path, outcome: outcomeOf(file) })), ...former.map((path) => ({ path, outcome: "deleted" as const }))];
  const written = [...owned, ...starter].filter(changes);
  for (const file of written) {
    await mkdir(dirname(join(vault, file.path)), { recursive: true });
    await writeFile(join(vault, file.path), file.content);
  }
  await removeFormerSkill(vault, former);
  // Commit Mirror's files, the copied starter files, and the deletions, including Mirror files that already matched but Git did not have.
  const pending = await uncommitted(vault, [...[...owned, ...starter].map((file) => file.path), ...former]);
  const commit = pending.length === 0 ? undefined : await commitFiles(vault, pending, await describeRepo(repo));
  return ok({ vault, files, commit });
}

async function planFiles(source: string, vault: string): Promise<PlannedFile[]> {
  const entries = await readdir(source, { recursive: true, withFileTypes: true });
  const paths = entries.filter((entry) => entry.isFile() && entry.name !== ".DS_Store").map((entry) => relative(source, join(entry.parentPath, entry.name)));
  return Promise.all(paths.sort().map(async (path) => ({ path, content: await readFile(join(source, path)), current: await readOptional(join(vault, path)) })));
}

// Pi loads the package when it runs at the vault root and the user trusts the vault.
async function planSettings(repo: string, vault: string): Promise<PlannedFile> {
  const content = Buffer.from(`${JSON.stringify({ packages: [resolve(repo)] }, null, 2)}\n`);
  return { path: SETTINGS, content, current: await readOptional(join(vault, SETTINGS)) };
}

// The starter map, for a vault without AGENTS.md that Mirror has not projected before, or in place of Mirror's former instructions.
// A vault that has the settings and no AGENTS.md is one whose user deleted the map: it stays deleted.
async function planMap(repo: string, vault: string): Promise<PlannedFile | undefined> {
  const current = await readOptional(join(vault, VAULT_MAP));
  const wanted = current === undefined ? (await readOptional(join(vault, SETTINGS))) === undefined : current.toString("utf8").startsWith(FORMER_INSTRUCTIONS);
  return wanted ? { path: VAULT_MAP, content: await readFile(join(repo, "starter", VAULT_MAP)), current } : undefined;
}

function changes(file: PlannedFile): boolean {
  return file.current?.equals(file.content) !== true;
}

function outcomeOf(file: PlannedFile): FileOutcome {
  if (file.current === undefined) return "created";
  return changes(file) ? "updated" : "kept";
}

async function existing(vault: string, paths: readonly string[]): Promise<string[]> {
  const found = await Promise.all(paths.map(async (path) => ((await readOptional(join(vault, path))) === undefined ? undefined : path)));
  return found.filter((path) => path !== undefined);
}

// Delete the former skill files, then the directories that they leave empty, up to `.agents`.
async function removeFormerSkill(vault: string, files: readonly string[]): Promise<void> {
  if (files.length === 0) return;
  for (const file of files) await rm(join(vault, file));
  for (const dir of [join(FORMER_SKILL, "voices"), FORMER_SKILL, dirname(FORMER_SKILL), dirname(dirname(FORMER_SKILL))]) {
    if (!(await hasEntries(join(vault, dir)))) await rmdir(join(vault, dir)).catch(() => undefined);
  }
}

async function hasEntries(dir: string): Promise<boolean> {
  return (await readdir(dir).catch(() => [])).length > 0;
}

async function readOptional(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, ...args]);
  return stdout.trim();
}

async function ensureGitRepository(vault: string): Promise<void> {
  const top = await git(vault, ["rev-parse", "--show-toplevel"]).catch(() => undefined);
  if (top !== undefined && (await realpath(top)) === vault) return;
  await git(vault, ["-c", "init.defaultBranch=main", "init", "-q"]);
}

// The paths whose content Git does not have in the last commit: an edit, a staged change, or an untracked file.
async function uncommitted(vault: string, paths: readonly string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const { stdout } = await run("git", ["-C", vault, "status", "--porcelain", "-z", "--untracked-files=all", "--", ...paths]);
  return stdout.split("\0").filter((entry) => entry !== "").map((entry) => entry.slice(3));
}

// Commit only the given paths. Other staged changes of the user stay staged and uncommitted.
async function commitFiles(vault: string, paths: readonly string[], source: string): Promise<string> {
  await git(vault, ["add", "--", ...paths]);
  await git(vault, ["commit", "-q", "--no-verify", "-m", `chore: project Mirror ${source}`, "--only", "--", ...paths]);
  return git(vault, ["rev-parse", "HEAD"]);
}

// The repository commit that was projected, marked when the projected files have uncommitted changes.
async function describeRepo(repo: string): Promise<string> {
  const commit = await git(repo, ["rev-parse", "--short", "HEAD"]).catch(() => undefined);
  if (commit === undefined) return "(not a Git checkout)";
  const dirty = await git(repo, ["status", "--porcelain", "--", "vault", "starter"]);
  return dirty === "" ? commit : `${commit}-dirty`;
}
