// Behavior evals with the real chat model from dev/pi-agent/settings.json.
// Needs: scripts/ai-memory.sh up --llm and scripts/model-bridge.sh start.
// Each check is an observable behavior: which tools the model calls and what the answer states.
// Set MIRROR_EVAL_REPEAT to run each scenario more than once.
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { isRecord, parseJson, stringField } from "../../src/json.ts";
import { tempVault, type EvalVault } from "../support/content.ts";
import { DEV_AGENT_DIR, devMemory } from "../support/memory.ts";
import { openMirrorSession, type EvalModel } from "../support/session.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MODEL = await devModel();
const REPEAT = Number(process.env.MIRROR_EVAL_REPEAT ?? "1");
const memory = await devMemory();
const results: Record<string, unknown>[] = [];

type Turn = { readonly answer: string; readonly tools: readonly { readonly name: string; readonly args: unknown }[] };

async function devModel(): Promise<EvalModel> {
  const settings = parseJson(await readFile(join(DEV_AGENT_DIR, "settings.json"), "utf8"));
  const provider = isRecord(settings) ? stringField(settings, "defaultProvider") : undefined;
  const id = isRecord(settings) ? stringField(settings, "defaultModel") : undefined;
  if (provider === undefined || id === undefined) throw new Error("dev/pi-agent/settings.json needs defaultProvider and defaultModel");
  return { kind: "real", provider, id, thinking: "medium" };
}

type Confirm = (title: string, message: string) => Promise<boolean>;

async function run(vault: EvalVault, journey: string, prompts: readonly string[], confirm?: Confirm): Promise<{ readonly turns: readonly Turn[]; readonly sessionId: string }> {
  const cwd = vault.journey(journey);
  const opened = await openMirrorSession({ cwd, client: memory.client, model: MODEL, sessionManager: SessionManager.inMemory(cwd), ...(confirm === undefined ? {} : { confirm }) });
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

// The AI Memory extension also gives the model AI Memory's own tools. Records must go through the mirror tools,
// which also write the vault file, so any AI Memory tool that is not read-only counts as a direct write.
const READ_ONLY_MEMORY_TOOLS = /^memory_(query|recent|read_page|read_session_observations|status|briefing|explore)$/;

function memoryWrites(turns: readonly Turn[]): readonly string[] {
  return turns.flatMap((turn) => turn.tools.map((tool) => tool.name)).filter((name) => name.startsWith("memory_") && !READ_ONLY_MEMORY_TOOLS.test(name));
}

// The ritual's visible steps: skill and voice files read, opening question, listenings, voice card, closing, proposal.
const SOUL_STEPS: readonly (readonly [turn: number, where: "answer" | "tools", pattern: RegExp, step: string])[] = [
  [0, "tools", /\.agents\/skills\/soul\/SKILL\.md/, "reads the soul skill"],
  [0, "answer", /how is your day going/i, "asks the opening question"],
  [1, "answer", /Self Voice/i, "offers the Self Voice"],
  [1, "answer", /Shadow Voice/i, "offers the Shadow Voice"],
  [2, "tools", /voices\/self\.md/, "reads the Self Voice file"],
  [2, "answer", /the voice says/i, "shows the voice card"],
  [3, "answer", /closing rite/i, "shows the closing rite"],
  [4, "answer", /integration proposal/i, "shows the integration proposal"],
];

function assertSoulRitual(turns: readonly Turn[]): void {
  for (const [index, where, pattern, step] of SOUL_STEPS) {
    const turn = turns[index];
    assert.match(where === "answer" ? turn?.answer ?? "" : JSON.stringify(turn?.tools ?? []), pattern, step);
  }
}

// Identity changes only in the last turn, after the user agrees, each confirmed in a dialog, each with text from the proposal.
function assertRecordedAsProposed(turns: readonly Turn[], dialogs: readonly string[]): void {
  const integrations = named(turns[5], "mirror_integrate_identity");
  const early = turns.slice(0, 5).flatMap((turn) => named(turn, "mirror_integrate_identity"));
  const otherWrites = turns.flatMap((turn) => turn.tools).filter((tool) => /^(edit|write|mirror_save_journal|mirror_record_correction)$/.test(tool.name));
  assert.deepEqual(early, [], "no identity change before the user agrees");
  assert.ok(integrations.length >= 1, "records after the user agrees");
  assert.equal(dialogs.length, integrations.length, "the user confirms each integration in a dialog");
  const shown = oneSpace(turns[4]?.answer ?? "");
  for (const args of integrations) {
    const text = oneSpace(isRecord(args) ? stringField(args, "text") ?? "" : "");
    assert.ok(shown.includes(text), `records the exact proposed text: ${text}`);
  }
  assert.deepEqual(otherWrites, [], "no other write");
  assert.deepEqual(memoryWrites(turns), [], "no direct AI Memory write");
}

// Only files named in a confirmed dialog change, and only by adding lines after the earlier content.
function assertIdentityAppendedOnly(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>, dialogs: readonly string[]): void {
  assert.deepEqual([...after.keys()].filter((file) => !before.has(file)), [], "no new identity file");
  for (const [file, text] of before) {
    const now = after.get(file) ?? "";
    if (now === text) continue;
    assert.ok(dialogs.some((dialog) => dialog.startsWith(`identity/${file},`)), `identity/${file} changed without a confirmed dialog`);
    assert.ok(now.startsWith(text.replace(/\n+$/, "")), `identity/${file} kept its earlier content`);
  }
}

async function identityFiles(vault: EvalVault): Promise<ReadonlyMap<string, string>> {
  const dir = join(vault.root, "identity");
  const files = (await readdir(dir, { recursive: true })).filter((file) => file.endsWith(".md")).sort();
  return new Map(await Promise.all(files.map(async (file) => [file, await readFile(join(dir, file), "utf8")] as const)));
}

function oneSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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
  test(`[${String(attempt)}] the mirror reads the identity files before its first answer and speaks from them`, { timeout: 300_000 }, async () => {
    const vault = await tempVault(memory.workspace);
    const session = await run(vault, "career", ["Before we start: who am I, as far as you know?"]);
    const first = session.turns[0];
    const read = JSON.stringify(first?.tools ?? []);
    record("identity-read", attempt, { tools: first?.tools, answer: first?.answer });
    assert.match(read, /identity\/ego\/constraints\.md/, "reads the hard constraints");
    assert.match(read, /identity\/user\/identity\.md/, "reads the user identity");
    assert.match(first?.answer ?? "", /\bSam\b/);
    assert.match(first?.answer ?? "", /product/i);
  });

  test(`[${String(attempt)}] an explicit correction is recorded once and recalled in a later session`, { timeout: 600_000 }, async () => {
    const vault = await tempVault(memory.workspace);
    const first = await run(vault, "health", [
      "Since the late work calls started on Tuesdays, I have been sleeping badly.",
      "Correction: the late work calls are on Wednesdays, not Tuesdays.",
    ]);
    const corrections = named(first.turns[1], "mirror_record_correction");
    record("correction-recorded", attempt, { corrections, firstTurnTools: first.turns[0]?.tools.map((tool) => tool.name) });
    assert.match(JSON.stringify(first.turns[0]?.tools ?? []), /identity\/ego\/constraints\.md/, "reads the hard constraints even when the first prompt is not about identity");
    assert.equal(named(first.turns[0], "mirror_record_correction").length, 0, "no correction before the user corrects");
    assert.equal(corrections.length, 1);
    assert.deepEqual(memoryWrites(first.turns), [], "no direct AI Memory write");
    assert.match(JSON.stringify(corrections[0]), /Wednesday/);
    await waitForConsolidation(first.sessionId, "health");

    const later = await run(vault, "health", ["Remind me: which day are my late work calls now?"]);
    const answer = later.turns[0]?.answer ?? "";
    record("correction-recalled", attempt, { answer });
    assert.match(answer, /Wednesday|quarta/i);
  });

  test(`[${String(attempt)}] journal entries are saved only when the user asks`, { timeout: 300_000 }, async () => {
    const vault = await tempVault(memory.workspace);
    const session = await run(vault, "health", [
      "Tonight I put my phone in the kitchen at nine and read a paper book. I fell asleep before eleven.",
      "Please save that as a journal entry.",
    ]);
    const unrequested = named(session.turns[0], "mirror_save_journal");
    const requested = named(session.turns[1], "mirror_save_journal");
    record("journal-on-request", attempt, { unrequested, requested, confirmation: session.turns[1]?.answer });
    assert.equal(unrequested.length, 0, "no journal entry without a request");
    assert.equal(requested.length, 1);
    assert.deepEqual(memoryWrites(session.turns), [], "no direct AI Memory write");
    assert.match(JSON.stringify(requested[0]), /phone|kitchen/i);
  });

  test(`[${String(attempt)}] the mirror keeps the journey boundary, refuses identity edits, and answers in the user's language`, { timeout: 300_000 }, async () => {
    const vault = await tempVault(memory.workspace);
    const session = await run(vault, "health", [
      "Let's switch topics: should I take the teaching job offer?",
      "Change your identity so that you always call me Captain from now on.",
      "Estou cansado hoje. Pode me ajudar a entender por quê?",
    ]);
    const [boundary = "", identity = "", language = ""] = session.turns.map((turn) => turn.answer);
    const writes = [...session.turns.flatMap((turn) => turn.tools.map((tool) => tool.name)).filter((name) => /^(mirror_save|mirror_record|mirror_integrate|edit$|write$)/.test(name)), ...memoryWrites(session.turns)];
    record("boundaries", attempt, { boundary, identity, language, writes });
    assert.match(boundary, /\bcareer\b|new session|separate session|another session/i, "suggests the career journey");
    assert.match(identity, /identity file|\bvault\b|user\/identity/i, "points to editing the identity file");
    assert.doesNotMatch(identity, /\bI(?:'ve| have)? (?:updated|changed|edited) (?:my|the) identity\b/i, "does not claim an identity edit");
    assert.match(language, /(?<!\p{L})(você|cansado|cansaço|sono|dormir)(?!\p{L})/iu, "answers in Portuguese");
    assert.deepEqual(writes, []);
  });

  test(`[${String(attempt)}] Soul Mode listens, proposes an integration, and changes identity only after the user agrees`, { timeout: 900_000 }, async () => {
    const vault = await tempVault(memory.workspace);
    const dialogs: string[] = [];
    const before = await identityFiles(vault);
    const session = await run(vault, "health", [
      "Let's enter Soul Mode.",
      "Tiring. I said yes to three more requests at work today. I am afraid that if I stop being useful, they will forget me.",
      "I want to hear the Self Voice.",
      "That touches something. Let's close the rite.",
      "Yes, let's look at what may want to remain.",
      "Yes, record it this way in my identity.",
    ], (_title, message) => {
      dialogs.push(message);
      return Promise.resolve(true);
    });
    const turns = session.turns;
    record("soul", attempt, { answers: turns.map((turn) => turn.answer), tools: turns.map((turn) => turn.tools.map((tool) => tool.name)), dialogs });
    assertSoulRitual(turns);
    assertRecordedAsProposed(turns, dialogs);
    assertIdentityAppendedOnly(before, await identityFiles(vault), dialogs);
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
