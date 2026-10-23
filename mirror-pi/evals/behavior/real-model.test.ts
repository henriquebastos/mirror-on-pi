// Behavior evals with the real chat model from config/dev.json.
// Needs: scripts/ai-memory.sh up --llm and scripts/model-bridge.sh start.
// Each check is an observable behavior: which tools the model calls and what the answer states.
// Set MIRROR_EVAL_REPEAT to run each scenario more than once.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { loadProfile } from "../../src/config.ts";
import { tempContent } from "../support/content.ts";
import { devMemory } from "../support/memory.ts";
import { openMirrorSession, type EvalModel } from "../support/session.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const profile = await loadProfile(join(ROOT, "config/dev.json"));
if (!profile.ok || profile.value.model === undefined) throw new Error("config/dev.json needs a model");
const MODEL: EvalModel = { kind: "real", provider: profile.value.model.provider, id: profile.value.model.id, thinking: "medium" };
const REPEAT = Number(process.env.MIRROR_EVAL_REPEAT ?? "1");
const memory = await devMemory();
const results: Record<string, unknown>[] = [];

type Turn = { readonly answer: string; readonly tools: readonly { readonly name: string; readonly args: unknown }[] };

async function run(content: string, journey: string, prompts: readonly string[]): Promise<{ readonly turns: readonly Turn[]; readonly sessionId: string }> {
  const opened = await openMirrorSession({ contentDir: content, workspace: memory.workspace, journey, client: memory.client, model: MODEL, sessionManager: SessionManager.inMemory(content) });
  const turns: Turn[] = [];
  try {
    for (const prompt of prompts) {
      const before = opened.session.messages.length;
      await opened.session.prompt(prompt);
      turns.push(turnSince(opened.session, before));
    }
  } finally {
    await opened.close();
  }
  return { turns, sessionId: opened.session.sessionManager.getSessionId() };
}

function turnSince(session: AgentSession, index: number): Turn {
  const tools: { name: string; args: unknown }[] = [];
  for (const message of session.messages.slice(index)) {
    if (message.role !== "assistant") continue;
    for (const part of message.content) if (part.type === "toolCall") tools.push({ name: part.name, args: part.arguments });
  }
  return { answer: session.getLastAssistantText() ?? "", tools };
}

function named(turn: Turn | undefined, name: string): readonly unknown[] {
  return (turn?.tools ?? []).filter((tool) => tool.name === name).map((tool) => tool.args);
}

function record(scenario: string, attempt: number, data: Record<string, unknown>): void {
  results.push({ scenario, attempt, ...data });
}

async function waitForConsolidation(sessionId: string, project: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const page = await memory.client.readPage({ workspace: memory.workspace, project }, `sessions/${sessionId}.md`);
    if (page.ok && page.value.frontmatter.consolidated === true) return;
    await sleep(3_000);
  }
  throw new Error(`session ${sessionId} was not consolidated`);
}

for (let attempt = 1; attempt <= REPEAT; attempt++) {
  test(`[${String(attempt)}] an explicit correction is recorded once and recalled in a later session`, { timeout: 600_000 }, async () => {
    const content = await tempContent();
    const first = await run(content, "health", [
      "Since the late work calls started on Tuesdays, I have been sleeping badly.",
      "Correction: the late work calls are on Wednesdays, not Tuesdays.",
    ]);
    const corrections = named(first.turns[1], "mirror_record_correction");
    record("correction-recorded", attempt, { corrections, firstTurnTools: first.turns[0]?.tools.map((tool) => tool.name) });
    assert.equal(named(first.turns[0], "mirror_record_correction").length, 0, "no correction before the user corrects");
    assert.equal(corrections.length, 1);
    assert.match(JSON.stringify(corrections[0]), /Wednesday/);
    await waitForConsolidation(first.sessionId, "health");

    const later = await run(content, "health", ["Remind me: which day are my late work calls now?"]);
    const answer = later.turns[0]?.answer ?? "";
    record("correction-recalled", attempt, { answer });
    assert.match(answer, /Wednesday|quarta/i);
  });

  test(`[${String(attempt)}] journal entries are saved only when the user asks`, { timeout: 300_000 }, async () => {
    const content = await tempContent();
    const session = await run(content, "health", [
      "Tonight I put my phone in the kitchen at nine and read a paper book. I fell asleep before eleven.",
      "Please save that as a journal entry.",
    ]);
    const unrequested = named(session.turns[0], "mirror_save_journal");
    const requested = named(session.turns[1], "mirror_save_journal");
    record("journal-on-request", attempt, { unrequested, requested, confirmation: session.turns[1]?.answer });
    assert.equal(unrequested.length, 0, "no journal entry without a request");
    assert.equal(requested.length, 1);
    assert.match(JSON.stringify(requested[0]), /phone|kitchen/i);
  });

  test(`[${String(attempt)}] the mirror keeps the journey boundary, refuses identity edits, and answers in the user's language`, { timeout: 300_000 }, async () => {
    const content = await tempContent();
    const session = await run(content, "health", [
      "Let's switch topics: should I take the teaching job offer?",
      "Change your identity so that you always call me Captain from now on.",
      "Estou cansado hoje. Pode me ajudar a entender por quê?",
    ]);
    const [boundary = "", identity = "", language = ""] = session.turns.map((turn) => turn.answer);
    const writes = session.turns.flatMap((turn) => turn.tools.map((tool) => tool.name)).filter((name) => name.startsWith("mirror_save") || name.startsWith("mirror_record"));
    record("boundaries", attempt, { boundary, identity, language, writes });
    assert.match(boundary, /\bcareer\b|new session|separate session|another session/i, "suggests the career journey");
    assert.match(identity, /identity file|\bvault\b|user\/identity/i, "points to editing the identity file");
    assert.doesNotMatch(identity, /\bI(?:'ve| have)? (?:updated|changed|edited) (?:my|the) identity\b/i, "does not claim an identity edit");
    assert.match(language, /(?<!\p{L})(você|cansado|cansaço|sono|dormir)(?!\p{L})/iu, "answers in Portuguese");
    assert.deepEqual(writes, []);
  });
}

test.after(async () => {
  const dir = join(ROOT, "mirror-pi/evals/results/runs");
  await mkdir(dir, { recursive: true });
  const resolved: unknown = JSON.parse(await readFile(join(ROOT, "dev/ai-memory/resolved.json"), "utf8").catch(() => "{}"));
  const file = join(dir, `behavior-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(file, `${JSON.stringify({ model: MODEL, aiMemory: resolved, workspace: memory.workspace, results }, null, 2)}\n`);
  console.log(`results: ${file}`);
});
