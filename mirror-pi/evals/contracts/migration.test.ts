// The migration of a Mirror Mind home into a new vault. The home here is synthetic, with the tables Mirror Mind uses.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { boundSlug, listJourneys } from "../../src/journey.ts";
import { parseMarkdown } from "../../src/markdown.ts";
import { readMirrorMind } from "../../src/mirror-mind.ts";
import { IMPORT_ENTRY, planMigration, sessionDirName, writeMigration } from "../../src/migration.ts";
import { REPO, tempDir } from "../support/content.ts";

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]);

const SCHEMA = `
CREATE TABLE identity (id TEXT PRIMARY KEY, layer TEXT NOT NULL, key TEXT NOT NULL, content TEXT NOT NULL, version TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, metadata TEXT);
CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT, started_at TEXT NOT NULL, ended_at TEXT, interface TEXT NOT NULL, persona TEXT, journey TEXT, summary TEXT, tags TEXT, metadata TEXT);
CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, token_count INTEGER, metadata TEXT);
CREATE TABLE memories (id TEXT PRIMARY KEY, conversation_id TEXT, memory_type TEXT NOT NULL, layer TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, context TEXT, journey TEXT, persona TEXT, tags TEXT, created_at TEXT NOT NULL, relevance_score REAL, embedding BLOB, metadata TEXT);
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, journey TEXT, status TEXT);
`;

type Home = { readonly identityHome: string; readonly historyHome: string };

// In WAL mode, like Mirror Mind's databases.
function database(home: string): DatabaseSync {
  const db = new DatabaseSync(join(home, "memory.db"));
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec(SCHEMA);
  return db;
}

// The side files a Mirror Mind home keeps next to its database. SQLite changes or removes them when it opens the database there.
async function sideFiles(home: string): Promise<void> {
  for (const suffix of ["-wal", "-shm"]) await writeFile(join(home, `memory.db${suffix}`), "");
}

// Two homes, as on the user's machine: the newest identity in one, the conversations and memories in the other.
async function syntheticHome(): Promise<Home> {
  const root = await tempDir();
  const identityHome = join(root, "sam");
  const historyHome = join(root, "sam-old");
  for (const dir of ["identity/personas", "identity/journeys", "identity/user"]) await mkdir(join(identityHome, dir), { recursive: true });
  await mkdir(historyHome);
  const identity = database(identityHome);
  const insert = identity.prepare("INSERT INTO identity VALUES (?, ?, ?, ?, '1.0.0', '2026-05-04T01:00:00Z', '2026-05-04T01:00:00Z', NULL)");
  for (const [layer, key, content] of [
    ["self", "soul", "# Alma\n\nEu sou o espelho do Sam."],
    ["ego", "constraints", "# Limites\n\nNunca invente fatos."],
    ["user", "identity", "# Sam\n\nSam tem duas filhas, Ana e Bia."],
    ["persona", "pai", "# Pai\n\nLente de paternidade."],
    ["journey", "saude", "# Saúde\n**Status:** active\n\n## Context\n\nSam dorme mal desde as chamadas tardias."],
    ["journey", "carreira", "# Carreira\n\nSam pensa em dar aulas."],
    ["caminho", "velho", "# A retired layer"],
  ]) insert.run(`${String(layer)}-${String(key)}`, String(layer), String(key), String(content));
  identity.close();
  await writeFile(join(identityHome, "identity", "personas", "pai.yaml"), "persona_id: pai\nname: Pai\ndescription: >\n  Lente de paternidade.\n  Ativa com as filhas.\nrouting:\n  - filhas\n");
  await writeFile(join(identityHome, "identity", "journeys", "saude.yaml"), "travessia_id: saude\nname: Saúde\nstatus: active\ndescription: >\n  Sono e energia.\n");
  await writeFile(join(identityHome, "identity", "user", "identity.yaml"), "identity: |\n  # Sam\n");
  await writeFile(join(identityHome, "identity", "user", "big5.yaml"), "scores:\n  openness: 90\n");
  await writeFile(join(identityHome, "identity", "user", "report.pdf"), PDF);

  const history = database(historyHome);
  history.exec(`
    INSERT INTO conversations VALUES ('c1', 'Sono e chamadas', '2026-03-22T17:23:30.579Z', '2026-03-22T18:00:00Z', 'pi', NULL, 'saude', 'Sam liga o sono às chamadas tardias.', NULL, NULL);
    INSERT INTO conversations VALUES ('c2', NULL, '2026-04-03T16:53:39.198123Z', NULL, 'claude_code', NULL, 'tintim', NULL, NULL, NULL);
    INSERT INTO messages VALUES ('m1', 'c1', 'user', 'Durmo mal desde que começaram as chamadas das quartas.', '2026-03-22T17:23:31.000001Z', NULL, NULL);
    INSERT INTO messages VALUES ('m2', 'c1', 'assistant', 'O que acontece depois da chamada?', '2026-03-22T17:23:40Z', NULL, NULL);
    INSERT INTO messages VALUES ('m3', 'c1', 'system', 'internal', '2026-03-22T17:23:41Z', NULL, NULL);
    INSERT INTO messages VALUES ('m4', 'c2', 'user', 'Ideia para o Tintim: um caderno de vinhos.', '2026-04-03T16:54:00Z', NULL, NULL);
    INSERT INTO memories VALUES ('k1', 'c1', 'insight', 'ego', 'Chamadas e sono', 'As chamadas das quartas tiram o sono.', 'Conversa de março.', 'saude', NULL, '["sono", "trabalho"]', '2026-03-22T18:00:00Z', 1.0, NULL, NULL);
    INSERT INTO memories VALUES ('k2', 'c2', 'idea', 'ego', 'Caderno de vinhos', 'Um caderno para o Tintim.', NULL, 'tintim', NULL, NULL, '2026-04-03T17:00:00Z', 1.0, NULL, NULL);
    INSERT INTO tasks VALUES ('t1', 'Comprar o caderno secreto', 'tintim', 'todo');
  `);
  history.close();
  await sideFiles(identityHome);
  await sideFiles(historyHome);
  return { identityHome, historyHome };
}

async function snapshot(dir: string): Promise<Map<string, string>> {
  const files = await readdir(dir, { recursive: true, withFileTypes: true });
  const entries = await Promise.all(files.filter((file) => file.isFile()).map(async (file) => {
    const path = join(file.parentPath, file.name);
    return [path, createHash("sha256").update(await readFile(path)).digest("hex")] as const;
  }));
  return new Map(entries);
}

async function migrated(home: Home): Promise<{ readonly vault: string; readonly skipped: readonly string[]; readonly paths: readonly string[] }> {
  const data = await readMirrorMind(home.identityHome, home.historyHome);
  const written = await writeMigration(join(await tempDir(), "vault"), (cwd) => planMigration(data, cwd));
  if (!written.ok) throw new Error(written.error);
  return { vault: written.value.vault, skipped: written.value.plan.skipped, paths: written.value.plan.files.map((file) => file.path) };
}

async function markdown(path: string): Promise<{ readonly frontmatter: Readonly<Record<string, unknown>>; readonly body: string }> {
  const document = parseMarkdown(await readFile(path, "utf8"));
  if (!document.ok) throw new Error(document.error);
  return document.value;
}

test("identity rows become identity files and journeys with their text unchanged, and the user's other files are copied", async () => {
  const { vault, skipped } = await migrated(await syntheticHome());

  assert.deepEqual(await markdown(join(vault, "identity", "self", "soul.md")), { frontmatter: { layer: "self" }, body: "# Alma\n\nEu sou o espelho do Sam." });
  assert.equal((await markdown(join(vault, "identity", "user", "identity.md"))).body, "# Sam\n\nSam tem duas filhas, Ana e Bia.");
  assert.deepEqual((await markdown(join(vault, "identity", "personas", "pai.md"))).frontmatter, { name: "Pai", description: "Lente de paternidade. Ativa com as filhas." });
  assert.deepEqual((await markdown(join(vault, "journeys", "saude", "AGENTS.md"))).frontmatter, { title: "Saúde", status: "active", description: "Sono e energia." });
  assert.deepEqual((await markdown(join(vault, "journeys", "carreira", "AGENTS.md"))).frontmatter, { title: "carreira", status: "active" }, "a journey without YAML keeps its slug as title");
  assert.deepEqual(await listJourneys(vault), [{ slug: "carreira", description: "Sam pensa em dar aulas." }, { slug: "saude", description: "Sono e energia." }], "archives are not journeys");
  assert.deepEqual(await readFile(join(vault, "identity", "user", "report.pdf")), PDF);
  assert.equal(await readFile(join(vault, "identity", "user", "big5.yaml"), "utf8"), "scores:\n  openness: 90\n");
  assert.ok(skipped.includes("identity caminho/velho: no Mirror layer"), "an unknown layer is reported, not guessed");
});

test("conversations become Pi sessions of the vault: named, bound to their journey, and with their messages in order", async () => {
  const { vault, skipped } = await migrated(await syntheticHome());
  process.env.PI_CODING_AGENT_DIR = join(vault, ".pi", "agent");
  const dir = SessionManager.create(vault).getSessionDir();
  assert.equal(dir, join(vault, ".pi", "agent", "sessions", sessionDirName(vault)), "the directory Pi uses for a session at the vault root");
  const sessions = await SessionManager.list(vault, dir);
  assert.equal(sessions.length, 2);

  const sleep = SessionManager.open(join(dir, (await readdir(dir)).find((file) => file.startsWith("2026-03-22T17-23-30-579Z_")) ?? "missing"));
  assert.equal(sleep.getSessionName(), "Sono e chamadas");
  assert.equal(sleep.getHeader()?.timestamp, "2026-03-22T17:23:30.579Z");
  assert.equal(boundSlug(sleep.getBranch()), "saude");
  const context = sleep.buildSessionContext().messages.map((message) => [message.role, "content" in message ? JSON.stringify(message.content) : ""]);
  assert.deepEqual(context, [["user", JSON.stringify("Durmo mal desde que começaram as chamadas das quartas.")], ["assistant", JSON.stringify([{ type: "text", text: "O que acontece depois da chamada?" }])]]);
  const imported = sleep.getEntries().find((entry) => entry.type === "custom" && entry.customType === IMPORT_ENTRY);
  assert.match(JSON.stringify(imported), /"summary":"Sam liga o sono às chamadas tardias\."/);
  assert.ok(skipped.includes("conversation c1: 1 messages with another role"));

  const wine = SessionManager.open(join(dir, (await readdir(dir)).find((file) => file.startsWith("2026-04-03T16-53-39-198Z_")) ?? "missing"));
  assert.equal(boundSlug(wine.getBranch()), undefined, "a conversation of a journey that no longer exists stays without one");
});

test("the search command of the vault's AGENTS.md finds the migrated conversations", async () => {
  const { vault } = await migrated(await syntheticHome());
  const instructions = await readFile(join(REPO, "vault", "AGENTS.md"), "utf8");
  const command = /```sh\n([\s\S]*?)\n\s*```/.exec(instructions)?.[1]?.replace(/rg -i '[^']*'\s*$/, "rg -i 'quartas'");
  assert.ok(command !== undefined);
  const found = execFileSync("bash", ["-c", command], { cwd: vault, encoding: "utf8", env: { ...process.env, PI_CODING_AGENT_DIR: join(vault, ".pi", "agent") } });
  assert.match(found, /user: Durmo mal desde que começaram as chamadas das quartas\./);
});

test("memories become read-only archives in their journeys, and tasks are not migrated", async () => {
  const { vault, paths } = await migrated(await syntheticHome());
  const sleep = await readFile(join(vault, "journeys", "saude", "archive", "memories.md"), "utf8");
  assert.match(sleep, /## Chamadas e sono\n\n\*insight · ego · 2026-03-22 · journey: saude · tags: sono, trabalho · session: [0-9a-f-]{36}\*\n\nAs chamadas das quartas tiram o sono\.\n\nContext: Conversa de março\./);
  assert.match(await readFile(join(vault, "archive", "memories.md"), "utf8"), /## Caderno de vinhos[\s\S]*journey: tintim/, "a memory of a journey that no longer exists goes to the vault's archive");
  const everything = (await Promise.all(paths.map(async (path) => readFile(join(vault, path), "utf8")))).join("\n");
  assert.doesNotMatch(everything, /caderno secreto/);
});

test("the Mirror Mind homes are read, never written, and a second migration of the same data plans the same files", async () => {
  const home = await syntheticHome();
  const before = [await snapshot(home.identityHome), await snapshot(home.historyHome)];
  const data = await readMirrorMind(home.identityHome, home.historyHome);
  const cwd = await realpath(await tempDir());
  assert.deepEqual(planMigration(data, cwd), planMigration(await readMirrorMind(home.identityHome, home.historyHome), cwd));
  assert.deepEqual([await snapshot(home.identityHome), await snapshot(home.historyHome)], before);
});

test("a vault that already has an identity is refused and nothing is written", async () => {
  const home = await syntheticHome();
  const vault = join(await tempDir(), "vault");
  await mkdir(join(vault, "identity"), { recursive: true });
  await writeFile(join(vault, "identity", "mine.md"), "# Mine\n");
  const data = await readMirrorMind(home.identityHome, home.historyHome);
  const written = await writeMigration(vault, (cwd) => planMigration(data, cwd));

  assert.equal(written.ok, false);
  assert.deepEqual([...(await snapshot(vault)).keys()].map((path) => path.slice(vault.length)), ["/identity/mine.md"]);
});
