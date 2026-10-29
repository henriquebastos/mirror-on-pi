// The frozen history of the capability gate: what the 25 history sessions left in an A2 vault, without the vault itself.
// The fixture keeps the user's data that a later Mirror must still serve: the Pi session files, and the vault files
// that the sessions created, changed, or removed. Mirror's own files come from the current projection when the fixture
// is materialized, so a gate run tests the current Mirror with the same past. Absolute paths are stored as tokens:
// {{ROOT}} for the arm's directory, {{REPO}} for this repository, and {{PI}} for the Pi package, whose documentation
// paths are in the system prompt that each session file records.
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isRecord, parseJson, stringField } from "../../../src/json.ts";
import { REPO } from "../../support/content.ts";
import { armDirs, sessionDirName } from "./arms.ts";

export const FIXTURE = join(REPO, "mirror-pi", "evals", "fixtures", "parity", "a2");
const ROOT = "{{ROOT}}";
const REPO_TOKEN = "{{REPO}}";
const PI_TOKEN = "{{PI}}";
const REPO_PATH = REPO.replace(/\/$/, "");
const PI_PACKAGE = /\/[^\s"'\\<>()]*\/node_modules\/@earendil-works\/pi-coding-agent(?=[/\\"<\s)])/g;
const MANIFEST = "manifest.json";

export type Manifest = { readonly historyModel: string; readonly removed: readonly string[]; readonly sha256: Readonly<Record<string, string>> };

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

async function files(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { recursive: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries.sort()) {
    if (entry === ".git" || entry.startsWith(`.git/`)) continue;
    if ((await stat(join(dir, entry))).isFile()) found.push(entry);
  }
  return found;
}

// The absolute forms of a root that can appear in files: as written, and without macOS's /private prefix.
function rootForms(root: string): readonly string[] {
  return root.startsWith("/private/") ? [root, root.slice("/private".length)] : [root];
}

function tokenize(text: string, root: string): string {
  const rooted = rootForms(root).reduce((current, form) => current.split(form).join(ROOT), text);
  return rooted.replace(PI_PACKAGE, PI_TOKEN).split(REPO_PATH).join(REPO_TOKEN);
}

// Write the fixture from an arm's fresh base and the same base after the history replay.
export async function freeze(freshRoot: string, historyRoot: string, target = FIXTURE): Promise<Manifest> {
  const history: unknown = parseJson(await readFile(join(historyRoot, "history.json"), "utf8"));
  const replayCwd = isRecord(history) ? stringField(history, "cwd") : undefined;
  const historyModel = isRecord(history) ? (stringField(history, "model") ?? "") : "";
  if (replayCwd === undefined) throw new Error(`No cwd in ${join(historyRoot, "history.json")}`);
  const replayRoot = dirname(replayCwd);
  const written = new Map<string, string>();
  const put = async (path: string, text: string): Promise<void> => {
    const tokenized = tokenize(text, replayRoot);
    await mkdir(dirname(join(target, path)), { recursive: true });
    await writeFile(join(target, path), tokenized);
    written.set(path, sha256(tokenized));
  };
  await rm(target, { recursive: true, force: true });
  await put("history.json", await readFile(join(historyRoot, "history.json"), "utf8"));
  const sessions = join(historyRoot, "agent", "sessions");
  for (const file of (await files(sessions)).filter((path) => path.endsWith(".jsonl"))) await put(join("sessions", file.slice(file.lastIndexOf("/") + 1)), await readFile(join(sessions, file), "utf8"));
  const fresh = join(freshRoot, "vault");
  const after = join(historyRoot, "vault");
  const before = new Set(await files(fresh));
  for (const file of await files(after)) {
    const text = await readFile(join(after, file), "utf8");
    if (!before.has(file) || (await readFile(join(fresh, file), "utf8")) !== text) await put(join("vault", file), text);
  }
  const kept = new Set(await files(after));
  const manifest: Manifest = { historyModel, removed: [...before].filter((file) => !kept.has(file)), sha256: Object.fromEntries([...written].sort(([a], [b]) => a.localeCompare(b))) };
  await writeFile(join(target, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function readManifest(source = FIXTURE): Promise<Manifest> {
  const value: unknown = parseJson(await readFile(join(source, MANIFEST), "utf8"));
  if (!isRecord(value) || !isRecord(value.sha256) || !Array.isArray(value.removed)) throw new Error(`Bad fixture manifest in ${source}`);
  const hashes = Object.entries(value.sha256).flatMap(([path, hash]) => (typeof hash === "string" ? [[path, hash] as const] : []));
  return { historyModel: stringField(value, "historyModel") ?? "", removed: value.removed.filter((path): path is string => typeof path === "string"), sha256: Object.fromEntries(hashes) };
}

// The fixture's identity for a baseline: the hash of its manifest, which lists the hash of every file.
export async function fixtureHash(source = FIXTURE): Promise<string> {
  return sha256(await readFile(join(source, MANIFEST), "utf8"));
}

// Problems with the fixture on disk: files that are missing, changed, or not in the manifest.
export async function verifyFixture(source = FIXTURE): Promise<readonly string[]> {
  const manifest = await readManifest(source);
  const present = (await files(source)).filter((path) => path !== MANIFEST);
  const problems = present.filter((path) => manifest.sha256[path] === undefined).map((path) => `not in the manifest: ${path}`);
  for (const [path, hash] of Object.entries(manifest.sha256)) {
    const text = await readFile(join(source, path), "utf8").catch(() => undefined);
    if (text === undefined) problems.push(`missing: ${path}`);
    else if (sha256(text) !== hash) problems.push(`changed: ${path}`);
  }
  return problems;
}

// Copy the arm's fresh base to the target, then add the fixture's sessions and vault files with the target's paths.
export async function materialize(freshRoot: string, target: string, source = FIXTURE): Promise<void> {
  const problems = await verifyFixture(source);
  if (problems.length > 0) throw new Error(`The fixture does not match its manifest:\n${problems.join("\n")}`);
  const manifest = await readManifest(source);
  await rm(target, { recursive: true, force: true });
  await cp(freshRoot, target, { recursive: true, verbatimSymlinks: true });
  const dirs = armDirs("a2", target);
  const pi = await realpath(join(REPO_PATH, "node_modules", "@earendil-works", "pi-coding-agent"));
  const sessions = join(dirs.agent, "sessions", sessionDirName(dirs.cwd));
  for (const path of Object.keys(manifest.sha256)) {
    const text = (await readFile(join(source, path), "utf8")).split(ROOT).join(target).split(REPO_TOKEN).join(REPO_PATH).split(PI_TOKEN).join(pi);
    const destination = path.startsWith("sessions/") ? join(sessions, path.slice("sessions/".length)) : join(target, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, text);
  }
  for (const path of manifest.removed) await rm(join(dirs.cwd, path), { force: true });
}
