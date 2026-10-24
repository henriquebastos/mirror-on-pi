// Run the synthetic history once as real Pi sessions, in order, with the real chat model.
// The AI Memory extension captures every session into a new workspace, as in a development session (S1).
// The same sessions are stored as Pi session files in the journey's `.pi/sessions` (S2, and S3 after conversion).
// Usage: node mirror-pi/evals/experiments/memory/generate.ts <output-dir>
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { isRecord, parseJson, stringField } from "../../../src/json.ts";
import { tempVault } from "../../support/content.ts";
import { DEV_AGENT_DIR, devMemory, type EvalMemory } from "../../support/memory.ts";
import { openMirrorSession, type EvalModel } from "../../support/session.ts";
import { firstPrompt, HISTORY } from "./history.ts";
import { JOURNEY, SESSION_DIR } from "./strategies.ts";

export type GeneratedSession = { readonly id: string; readonly sessionId: string; readonly lastReply: string };

export type HistoryState = {
  readonly workspace: string;
  readonly vault: string;
  readonly model: EvalModel;
  readonly startedAt: string;
  readonly generatedAt: string;
  readonly consolidatedAt: string;
  readonly sessions: readonly GeneratedSession[];
};

const CONSOLIDATION_TIMEOUT_MS = 45 * 60_000;

export async function devModel(): Promise<EvalModel> {
  const settings = parseJson(await readFile(join(DEV_AGENT_DIR, "settings.json"), "utf8"));
  const provider = isRecord(settings) ? stringField(settings, "defaultProvider") : undefined;
  const id = isRecord(settings) ? stringField(settings, "defaultModel") : undefined;
  if (provider === undefined || id === undefined) throw new Error("dev/pi-agent/settings.json needs defaultProvider and defaultModel");
  return { kind: "real", provider, id, thinking: "medium" };
}

async function generate(output: string): Promise<HistoryState> {
  const memory = await devMemory();
  const model = await devModel();
  const vault = await tempVault(memory.workspace);
  const cwd = vault.journey(JOURNEY);
  const startedAt = new Date().toISOString();
  const sessions: GeneratedSession[] = [];
  for (const spec of HISTORY) {
    const opened = await openMirrorSession({ cwd, client: memory.client, model, extensions: "capture", sessionManager: SessionManager.create(cwd, join(cwd, SESSION_DIR)) });
    const [first = "", ...rest] = spec.turns;
    for (const prompt of [firstPrompt(spec, first), ...rest]) await opened.session.prompt(prompt);
    const lastReply = opened.session.getLastAssistantText() ?? "";
    await opened.close();
    sessions.push({ id: spec.id, sessionId: opened.session.sessionManager.getSessionId(), lastReply });
    console.log(`${spec.id} ${spec.date}: ${lastReply.slice(0, 80).replace(/\s+/g, " ")}`);
  }
  const generatedAt = new Date().toISOString();
  await waitForConsolidation(memory, sessions);
  const state: HistoryState = { workspace: memory.workspace, vault: vault.root, model, startedAt, generatedAt, consolidatedAt: new Date().toISOString(), sessions };
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "history.json"), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

async function waitForConsolidation(memory: EvalMemory, sessions: readonly GeneratedSession[]): Promise<void> {
  const deadline = Date.now() + CONSOLIDATION_TIMEOUT_MS;
  const pending = new Set(sessions.map((session) => session.sessionId));
  while (pending.size > 0) {
    if (Date.now() > deadline) throw new Error(`${String(pending.size)} sessions were not consolidated`);
    for (const id of [...pending]) {
      const page = await memory.client.readPage({ workspace: memory.workspace, project: JOURNEY }, `sessions/${id}.md`);
      if (page.ok && page.value.frontmatter.consolidated === true) pending.delete(id);
    }
    console.log(`consolidation: ${String(sessions.length - pending.size)}/${String(sessions.length)}`);
    if (pending.size > 0) await sleep(15_000);
  }
}

const output = process.argv[2];
if (output === undefined) throw new Error("Usage: generate.ts <output-dir>");
const state = await generate(output);
console.log(`history: ${state.vault} (workspace ${state.workspace})`);
