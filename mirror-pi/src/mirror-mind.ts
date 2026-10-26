// Read a Mirror Mind home (`~/.mirror/<user>`): its identity, conversations, and memories.
// The databases are copied to a temporary directory and read there, so the home is never written, not even SQLite's
// shared-memory file. Tasks and every other table are not read.
import { copyFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { parse } from "yaml";
import { isRecord, stringField } from "./json.ts";

export type OldIdentity = { readonly layer: string; readonly key: string; readonly content: string };

// The display fields of a persona or journey, from its YAML file: name, description, and status.
export type OldNames = { readonly name?: string | undefined; readonly description?: string | undefined; readonly status?: string | undefined };

export type OldConversation = {
  readonly id: string;
  readonly title: string | undefined;
  readonly startedAt: string;
  readonly endedAt: string | undefined;
  readonly origin: string;
  readonly journey: string | undefined;
  readonly summary: string | undefined;
};

export type OldMessage = { readonly conversationId: string; readonly role: string; readonly content: string; readonly createdAt: string };

export type OldMemory = {
  readonly conversationId: string | undefined;
  readonly type: string;
  readonly layer: string;
  readonly title: string;
  readonly content: string;
  readonly context: string | undefined;
  readonly journey: string | undefined;
  readonly persona: string | undefined;
  readonly tags: string | undefined;
  readonly createdAt: string;
};

export type OldFile = { readonly name: string; readonly content: Buffer };

export type MirrorMindData = {
  readonly identity: readonly OldIdentity[];
  // Keyed by `persona/<id>` and `journey/<id>`.
  readonly names: ReadonlyMap<string, OldNames>;
  // Files in `identity/user/` other than `identity.yaml`: assessments and their reports.
  readonly userFiles: readonly OldFile[];
  readonly conversations: readonly OldConversation[];
  readonly messages: readonly OldMessage[];
  readonly memories: readonly OldMemory[];
};

type Row = Record<string, SQLOutputValue>;

// The identity comes from one home, the history from another: the newest identity and the conversations may live apart.
export async function readMirrorMind(identityHome: string, historyHome: string): Promise<MirrorMindData> {
  const identity = await withCopy(identityHome, (db) => rows(db, "SELECT layer, key, content FROM identity ORDER BY layer, key").map(toIdentity));
  const history = await withCopy(historyHome, (db) => ({
    conversations: rows(db, "SELECT * FROM conversations ORDER BY started_at, id").map(toConversation),
    messages: rows(db, "SELECT conversation_id, role, content, created_at FROM messages ORDER BY created_at, rowid").map(toMessage),
    memories: rows(db, "SELECT * FROM memories ORDER BY created_at, id").map(toMemory),
  }));
  return { identity, names: await readNames(identityHome), userFiles: await readUserFiles(identityHome), ...history };
}

async function withCopy<T>(home: string, read: (db: DatabaseSync) => T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "mirror-mind-"));
  try {
    for (const suffix of ["", "-wal"]) await copyFile(join(home, `memory.db${suffix}`), join(dir, `memory.db${suffix}`)).catch(ignoreMissing);
    const db = new DatabaseSync(join(dir, "memory.db"));
    try {
      return read(db);
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function ignoreMissing(error: unknown): void {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
  throw error;
}

function rows(db: DatabaseSync, sql: string): Row[] {
  return db.prepare(sql).all();
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Expected text in column ${key}`);
  return value;
}

function optional(row: Row, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function toIdentity(row: Row): OldIdentity {
  return { layer: text(row, "layer"), key: text(row, "key"), content: text(row, "content") };
}

function toConversation(row: Row): OldConversation {
  return {
    id: text(row, "id"),
    title: optional(row, "title"),
    startedAt: text(row, "started_at"),
    endedAt: optional(row, "ended_at"),
    origin: text(row, "interface"),
    journey: optional(row, "journey"),
    summary: optional(row, "summary"),
  };
}

function toMessage(row: Row): OldMessage {
  return { conversationId: text(row, "conversation_id"), role: text(row, "role"), content: text(row, "content"), createdAt: text(row, "created_at") };
}

function toMemory(row: Row): OldMemory {
  return {
    conversationId: optional(row, "conversation_id"),
    type: text(row, "memory_type"),
    layer: text(row, "layer"),
    title: text(row, "title"),
    content: text(row, "content"),
    context: optional(row, "context"),
    journey: optional(row, "journey"),
    persona: optional(row, "persona"),
    tags: optional(row, "tags"),
    createdAt: text(row, "created_at"),
  };
}

async function readNames(home: string): Promise<Map<string, OldNames>> {
  const names = new Map<string, OldNames>();
  for (const [kind, dir] of [["persona", "personas"], ["journey", "journeys"]] as const) {
    for (const file of await yamlFiles(join(home, "identity", dir))) {
      const data: unknown = parse(await readFile(join(home, "identity", dir, file), "utf8"));
      if (isRecord(data)) names.set(`${kind}/${file.replace(/\.yaml$/, "")}`, { name: stringField(data, "name"), description: oneLine(stringField(data, "description")), status: stringField(data, "status") });
    }
  }
  return names;
}

async function yamlFiles(dir: string): Promise<string[]> {
  const files = await readdir(dir).catch(() => []);
  return files.filter((file) => file.endsWith(".yaml")).sort();
}

function oneLine(value: string | undefined): string | undefined {
  return value?.replace(/\s+/g, " ").trim();
}

async function readUserFiles(home: string): Promise<OldFile[]> {
  const dir = join(home, "identity", "user");
  const files = (await readdir(dir).catch(() => [])).filter((name) => name !== "identity.yaml" && !name.startsWith(".")).sort();
  return Promise.all(files.map(async (name) => ({ name, content: await readFile(join(dir, name)) })));
}
