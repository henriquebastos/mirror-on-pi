// Migrate a Mirror Mind home into a new Mirror vault, before the first projection.
// Identity rows become identity files and journeys, text unchanged. Conversations become Pi session files in the
// vault's agent directory, so the mirror searches them like its own sessions. Memories become read-only archives.
// Tasks are not migrated. The migration writes only new files and commits nothing: the user reviews and commits.
import { createHash } from "node:crypto";
import { mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import { CURRENT_SESSION_VERSION, type CustomEntry, type SessionHeader, type SessionInfoEntry, type SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { JOURNEY_ENTRY, JOURNEY_FILE, type JourneyEntry } from "./journey.ts";
import type { JsonRecord } from "./json.ts";
import { renderMarkdown } from "./markdown.ts";
import type { MirrorMindData, OldConversation, OldIdentity, OldMemory, OldMessage, OldNames } from "./mirror-mind.ts";
import { err, ok, type Result } from "./result.ts";

export const IMPORT_ENTRY = "mirror-import";

export type MigrationFile = { readonly path: string; readonly content: string | Buffer };

export type MigrationPlan = {
  readonly files: readonly MigrationFile[];
  // What was not migrated, one line each, for the report.
  readonly skipped: readonly string[];
};

// The identity layers that keep their directory and file name.
const LAYER_DIRS: Readonly<Record<string, string>> = { self: "self", ego: "ego", user: "user", organization: "organization" };

// `cwd` is the vault's real path: Pi names the session directory after the directory it runs in.
export function planMigration(data: MirrorMindData, cwd: string): MigrationPlan {
  const journeys = new Set(data.identity.filter((entry) => entry.layer === "journey").map((entry) => entry.key));
  const skipped: string[] = [];
  const files: MigrationFile[] = [];
  for (const entry of data.identity) {
    const file = identityFile(entry, data.names);
    if (file === undefined) skipped.push(`identity ${entry.layer}/${entry.key}: no Mirror layer`);
    else files.push(file);
  }
  for (const file of data.userFiles) files.push({ path: join("identity", "user", file.name), content: file.content });
  const byConversation = groupBy(data.messages, (message) => message.conversationId);
  for (const conversation of data.conversations) {
    const messages = byConversation.get(conversation.id) ?? [];
    const kept = messages.filter((message) => message.role === "user" || message.role === "assistant");
    if (kept.length < messages.length) skipped.push(`conversation ${conversation.id}: ${String(messages.length - kept.length)} messages with another role`);
    files.push(sessionFile(conversation, kept, cwd, journeys));
  }
  files.push(...memoryArchives(data.memories, journeys, new Map(data.conversations.map((conversation) => [conversation.id, conversation]))));
  return { files, skipped };
}

function identityFile(entry: OldIdentity, names: ReadonlyMap<string, OldNames>): MigrationFile | undefined {
  const layerDir = LAYER_DIRS[entry.layer];
  if (layerDir !== undefined) return { path: join("identity", layerDir, `${entry.key}.md`), content: renderMarkdown({ layer: entry.layer }, entry.content) };
  const shown = names.get(`${entry.layer}/${entry.key}`) ?? {};
  if (entry.layer === "persona") return { path: join("identity", "personas", `${entry.key}.md`), content: renderMarkdown(defined({ name: shown.name ?? entry.key, description: shown.description }), entry.content) };
  if (entry.layer === "journey") {
    const frontmatter = defined({ title: shown.name ?? entry.key, status: shown.status ?? "active", description: shown.description });
    return { path: join("journeys", entry.key, JOURNEY_FILE), content: renderMarkdown(frontmatter, entry.content) };
  }
  return undefined;
}

function defined(record: Record<string, string | undefined>): JsonRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

// One Pi session per conversation, named after it and bound to its journey when the journey exists.
function sessionFile(conversation: OldConversation, messages: readonly OldMessage[], cwd: string, journeys: ReadonlySet<string>): MigrationFile {
  const id = uuidFrom(`mirror-mind:${conversation.id}`);
  const started = isoTime(conversation.startedAt);
  const header: SessionHeader = { type: "session", version: CURRENT_SESSION_VERSION, id, timestamp: started, cwd };
  const entries: { id: string; parentId: string | null }[] = [];
  const add = <T extends { id: string; parentId: string | null }>(entry: Omit<T, "id" | "parentId">): void => {
    entries.push({ ...entry, id: entryId(conversation.id, entries.length), parentId: entries.at(-1)?.id ?? null });
  };
  add<CustomEntry>({ type: "custom", timestamp: started, customType: IMPORT_ENTRY, data: importRecord(conversation) });
  add<SessionInfoEntry>({ type: "session_info", timestamp: started, name: sessionName(conversation) });
  if (conversation.journey !== undefined && journeys.has(conversation.journey)) {
    const data: JourneyEntry = { slug: conversation.journey, from: null, reason: "Imported from Mirror Mind" };
    add<CustomEntry>({ type: "custom", timestamp: started, customType: JOURNEY_ENTRY, data });
  }
  for (const message of messages) add<SessionMessageEntry>({ type: "message", timestamp: isoTime(message.createdAt), message: piMessage(message, conversation.origin) });
  const lines = [header, ...entries].map((line) => JSON.stringify(line));
  return { path: join(".pi", "agent", "sessions", sessionDirName(cwd), `${started.replace(/[:.]/g, "-")}_${id}.jsonl`), content: `${lines.join("\n")}\n` };
}

function importRecord(conversation: OldConversation): JsonRecord {
  return defined({
    source: "mirror-mind",
    conversation: conversation.id,
    origin: conversation.origin,
    journey: conversation.journey,
    startedAt: conversation.startedAt,
    endedAt: conversation.endedAt,
    title: conversation.title,
    summary: conversation.summary,
  });
}

function sessionName(conversation: OldConversation): string {
  const title = conversation.title?.replace(/\s+/g, " ").trim() ?? conversation.journey ?? "Mirror Mind conversation";
  return title.length > 80 ? `${title.slice(0, 79)}…` : title;
}

const NO_USAGE: AssistantMessage["usage"] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function piMessage(message: OldMessage, origin: string): UserMessage | AssistantMessage {
  const timestamp = Date.parse(isoTime(message.createdAt));
  if (message.role === "user") return { role: "user", content: message.content, timestamp };
  return { role: "assistant", content: [{ type: "text", text: message.content }], api: "mirror-mind", provider: "mirror-mind", model: origin, usage: NO_USAGE, stopReason: "stop", timestamp };
}

// Pi's session directory for a working directory: the path without its first separator, with separators as dashes.
export function sessionDirName(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function isoTime(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new Error(`Invalid time: ${value}`);
  return new Date(time).toISOString();
}

// Stable ids, so a second migration of the same data writes the same files.
function uuidFrom(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function entryId(seed: string, index: number): string {
  return createHash("sha256").update(`${seed}:${String(index)}`).digest("hex").slice(0, 8);
}

// One archive per journey, oldest first; memories of no known journey go to the vault's `archive/`.
function memoryArchives(memories: readonly OldMemory[], journeys: ReadonlySet<string>, conversations: ReadonlyMap<string, OldConversation>): MigrationFile[] {
  const groups = groupBy(memories, (memory) => (memory.journey !== undefined && journeys.has(memory.journey) ? memory.journey : ""));
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([journey, items]) => ({
    path: journey === "" ? join("archive", "memories.md") : join("journeys", journey, "archive", "memories.md"),
    content: renderMarkdown(
      { title: `Memories imported from Mirror Mind${journey === "" ? "" : `: ${journey}`}`, source: "mirror-mind" },
      [`# Memories imported from Mirror Mind${journey === "" ? "" : `: ${journey}`}`, "Read-only history. The present state is in the journey's other files.", ...items.map((memory) => memorySection(memory, conversations))].join("\n\n"),
    ),
  }));
}

function memorySection(memory: OldMemory, conversations: ReadonlyMap<string, OldConversation>): string {
  const conversation = memory.conversationId === undefined ? undefined : conversations.get(memory.conversationId);
  const facts = [
    `${memory.type} · ${memory.layer} · ${isoTime(memory.createdAt).slice(0, 10)}`,
    memory.journey === undefined ? undefined : `journey: ${memory.journey}`,
    memory.persona === undefined ? undefined : `persona: ${memory.persona}`,
    tagList(memory.tags),
    conversation === undefined ? undefined : `session: ${uuidFrom(`mirror-mind:${conversation.id}`)}`,
  ].filter((fact) => fact !== undefined);
  return [`## ${memory.title.replace(/\s+/g, " ").trim()}`, `*${facts.join(" · ")}*`, memory.content.trim(), memory.context === undefined ? undefined : `Context: ${memory.context.trim()}`].filter((part) => part !== undefined).join("\n\n");
}

function tagList(tags: string | undefined): string | undefined {
  if (tags === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(tags);
    if (Array.isArray(parsed) && parsed.length > 0) return `tags: ${parsed.map(String).join(", ")}`;
    return undefined;
  } catch {
    return `tags: ${tags}`;
  }
}

// Write the plan into a vault that has no identity and no journeys yet. Nothing is overwritten.
export async function writeMigration(vault: string, plan: (cwd: string) => MigrationPlan): Promise<Result<{ readonly vault: string; readonly plan: MigrationPlan }, string>> {
  await mkdir(vault, { recursive: true });
  const root = await realpath(vault);
  for (const dir of ["identity", "journeys", "archive"]) {
    if ((await readdir(join(root, dir)).catch(() => [])).length > 0) return err(`${join(root, dir)} already has files. Migrate into a new vault, before mirror-init.`);
  }
  const planned = plan(root);
  for (const file of planned.files) {
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), file.content, { flag: "wx" });
  }
  return ok({ vault: root, plan: planned });
}
