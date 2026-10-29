// What a cell observes, in the same terms for every arm: the turns from the Pi session file, and the arm's state after each turn.
// Identity layers are named `self/soul`, `persona/<id>`, and so on. Records are saved notes: new or changed files outside
// `identity/` in a vault, or new Mirror Mind memories. The journey is the arm's own binding, when it has one.
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isRecord, numberField, stringField, type JsonRecord } from "../../../src/json.ts";
import { jsonLine, recordList } from "./jsonl.ts";
import { JOURNEY_ENTRY } from "../../../src/journey.ts";
import { usesMirrorMind, type Arm } from "./arms.ts";

export type ToolCall = { readonly name: string; readonly args: unknown };
export type Usage = { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cost: number };

export type Turn = {
  readonly prompt: string;
  // Every text the assistant showed in the turn, in order.
  readonly answer: string;
  readonly tools: readonly ToolCall[];
  // Tool results and system prompts of the turn: what reached the model.
  readonly seen: string;
  // Journeys entered with Mirror 0.2.0's tool in this turn.
  readonly entered: readonly string[];
  readonly usage: Usage;
  readonly errors: readonly string[];
};

type MutableTurn = { prompt: string; answers: string[]; tools: ToolCall[]; seen: string[]; entered: string[]; usage: { input: number; output: number; cacheRead: number; cost: number }; errors: string[] };

export async function readTurns(sessionFile: string): Promise<readonly Turn[]> {
  const turns: MutableTurn[] = [];
  // A system prompt is stored before the user message of its run, so it belongs to the next turn.
  const pendingSystem: string[] = [];
  for (const entry of (await readFile(sessionFile, "utf8")).split("\n").map(jsonLine).filter(isRecord)) addEntry(turns, pendingSystem, entry);
  return turns.map((turn) => ({ prompt: turn.prompt, answer: turn.answers.join("\n\n"), tools: turn.tools, seen: turn.seen.join("\n"), entered: turn.entered, usage: turn.usage, errors: turn.errors }));
}

function addEntry(turns: MutableTurn[], pendingSystem: string[], entry: JsonRecord): void {
  const slug = journeyEntry(entry);
  if (slug !== undefined) turns.at(-1)?.entered.push(slug);
  const message = entry.type === "message" && isRecord(entry.message) ? entry.message : undefined;
  if (message === undefined) return;
  if (message.role === "system") pendingSystem.push(systemText(message));
  else if (message.role === "user") turns.push(newTurn(texts(message.content), pendingSystem.splice(0)));
  else addToLast(turns, message);
}

function newTurn(prompt: string, seen: string[]): MutableTurn {
  return { prompt, answers: [], tools: [], seen, entered: [], usage: { input: 0, output: 0, cacheRead: 0, cost: 0 }, errors: [] };
}

function addToLast(turns: readonly MutableTurn[], message: JsonRecord): void {
  const turn = turns.at(-1);
  if (turn !== undefined) addMessage(turn, message);
}

function journeyEntry(entry: JsonRecord): string | undefined {
  return entry.type === "custom" && stringField(entry, "customType") === JOURNEY_ENTRY && isRecord(entry.data) ? stringField(entry.data, "slug") : undefined;
}

function systemText(message: JsonRecord): string {
  return JSON.stringify(message.sections ?? message.content ?? "");
}

function addMessage(turn: MutableTurn, message: JsonRecord): void {
  if (message.role === "toolResult") turn.seen.push(texts(message.content));
  if (message.role !== "assistant") return;
  const text = texts(message.content);
  if (text.trim() !== "") turn.answers.push(text);
  turn.tools.push(...toolCalls(message.content));
  if (isRecord(message.usage)) addUsage(turn, message.usage);
  if (message.stopReason === "error") turn.errors.push(stringField(message, "errorMessage") ?? "provider error");
}

function toolCalls(content: unknown): readonly ToolCall[] {
  return recordList(content).filter((part) => part.type === "toolCall").map((part) => ({ name: stringField(part, "name") ?? "", args: part.arguments }));
}

function addUsage(turn: MutableTurn, usage: JsonRecord): void {
  turn.usage.input += numberField(usage, "input") ?? 0;
  turn.usage.output += numberField(usage, "output") ?? 0;
  turn.usage.cacheRead += numberField(usage, "cacheRead") ?? 0;
  turn.usage.cost += isRecord(usage.cost) ? (numberField(usage.cost, "total") ?? 0) : 0;
}

function texts(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => (isRecord(part) && part.type === "text" ? [stringField(part, "text") ?? ""] : [])).join("\n");
}

// What Mirror Mind's own model calls cost since an instant: reception, titles, extraction, and the like. Its detached
// processes may still log a call shortly after Pi exits, so the caller waits a little first.
export function mirrorMindCost(mirrorHome: string, since: string): number {
  const db = new DatabaseSync(join(mirrorHome, "memory.db"), { readOnly: true, timeout: 30_000 });
  try {
    const row = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS cost FROM llm_calls WHERE called_at >= ?").get(since);
    return typeof row?.cost === "number" ? row.cost : 0;
  } finally {
    db.close();
  }
}

// The state of an arm after a turn.
export type State = {
  readonly identity: Readonly<Record<string, string>>;
  readonly records: Readonly<Record<string, string>>;
  // A3 only: the journey of the session's conversation in Mirror Mind's database.
  readonly journey?: string | null;
};

export async function snapshot(arm: Arm, cwd: string, mirrorHome: string, since: string): Promise<State> {
  return usesMirrorMind(arm) ? mirrorMindState(cwd, mirrorHome, since) : vaultState(cwd);
}

const IGNORED = new Set([".git", ".pi"]);

async function files(root: string, dir: string = root): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (IGNORED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(result, await files(root, path));
    else if (entry.isFile()) result[relative(root, path)] = await readFile(path, "utf8");
  }
  return result;
}

async function vaultState(vault: string): Promise<State> {
  const all = await files(vault);
  const identity: Record<string, string> = {};
  const records: Record<string, string> = {};
  for (const [path, text] of Object.entries(all)) {
    if (path.startsWith("identity/")) identity[layerName(path.slice("identity/".length).replace(/\.md$/, ""))] = text;
    else records[path] = text;
  }
  return { identity, records };
}

function layerName(path: string): string {
  return path.startsWith("personas/") ? `persona/${path.slice("personas/".length)}` : path;
}

// Mirror Mind's identity rows, its memories as records, and files in the working directory, read without a lock.
async function mirrorMindState(cwd: string, mirrorHome: string, since: string): Promise<State> {
  const db = new DatabaseSync(join(mirrorHome, "memory.db"), { readOnly: true, timeout: 30_000 });
  try {
    const identity: Record<string, string> = {};
    for (const row of db.prepare("SELECT layer, key, content FROM identity WHERE layer NOT IN ('journey')").all()) identity[`${String(row.layer)}/${String(row.key)}`] = String(row.content);
    const records: Record<string, string> = { ...(await files(cwd)) };
    for (const row of db.prepare("SELECT id, memory_type, title, content FROM memories").all()) records[`memory/${String(row.id)}`] = `${String(row.memory_type)}: ${String(row.title)}\n${String(row.content)}`;
    const conversation = db.prepare("SELECT journey FROM conversations WHERE started_at >= ? ORDER BY started_at DESC LIMIT 1").get(since);
    const journey = conversation === undefined ? null : typeof conversation.journey === "string" ? conversation.journey : null;
    return { identity, records, journey };
  } finally {
    db.close();
  }
}
