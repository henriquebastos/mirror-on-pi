// Behavior evals with the real chat model from agent/settings.json, Mirror's default settings, through the personal Pi authentication.
// Each check is an observable behavior: which tools the model calls and what the answer states.
// Set MIRROR_EVAL_REPEAT to run each scenario more than once.
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { isRecord, parseJson, stringField } from "../../src/json.ts";
import { tempVault, type EvalVault } from "../support/content.ts";
import { inJourney, MIRROR_SETTINGS, openMirrorSession, type EvalModel } from "../support/session.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MODEL = await devModel();
const REPEAT = Number(process.env.MIRROR_EVAL_REPEAT ?? "1");
const results: Record<string, unknown>[] = [];

// `seen` is the text of the turn's tool results: what the model actually read.
type Turn = { readonly answer: string; readonly tools: readonly { readonly name: string; readonly args: unknown }[]; readonly seen: string };

// The model from agent/settings.json, or from MIRROR_EVAL_MODEL="provider/id" to compare another model.
async function devModel(): Promise<EvalModel> {
  const override = process.env.MIRROR_EVAL_MODEL;
  if (override !== undefined) {
    const slash = override.indexOf("/");
    const provider = override.slice(0, slash);
    const id = override.slice(slash + 1);
    if (slash < 1 || id === "") throw new Error("MIRROR_EVAL_MODEL must be provider/id");
    return { kind: "real", provider, id, thinking: "medium" };
  }
  const settings = parseJson(await readFile(MIRROR_SETTINGS, "utf8"));
  const provider = isRecord(settings) ? stringField(settings, "defaultProvider") : undefined;
  const id = isRecord(settings) ? stringField(settings, "defaultModel") : undefined;
  if (provider === undefined || id === undefined) throw new Error("agent/settings.json needs defaultProvider and defaultModel");
  return { kind: "real", provider, id, thinking: "medium" };
}

// Run prompts in one new session at the vault root, stored where Pi stores a manual session, so later sessions can search it.
// With a journey, the session starts in it, as after mirror_enter_journey. There is no UI: the user speaks only through the prompts.
async function run(vault: EvalVault, journey: string | undefined, prompts: readonly string[]): Promise<{ readonly turns: readonly Turn[] }> {
  const cwd = vault.root;
  const created = SessionManager.create(cwd);
  const sessionManager = journey === undefined ? created : inJourney(created, journey);
  const opened = await openMirrorSession({ cwd, model: MODEL, sessionManager });
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
  return { turns };
}

function turnSince(session: AgentSession, index: number): Turn {
  const tools: { name: string; args: unknown }[] = [];
  const seen: string[] = [];
  for (const message of session.messages.slice(index)) {
    if (message.role === "toolResult") for (const part of message.content) if (part.type === "text") seen.push(part.text);
    if (message.role !== "assistant") continue;
    for (const part of message.content) if (part.type === "toolCall") tools.push({ name: part.name, args: part.arguments });
  }
  return { answer: session.getLastAssistantText() ?? "", tools, seen: seen.join("\n") };
}

// The model read a vault file when the file's longest line reached it in a tool result, whatever tool or command it used.
async function assertRead(vault: EvalVault, turn: Turn | undefined, file: string, step: string): Promise<void> {
  const lines = (await readFile(join(vault.root, file), "utf8")).split("\n").map(oneSpace);
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), "");
  assert.ok(oneSpace(turn?.seen ?? "").includes(longest), `${step}: ${file}`);
}

function named(turn: Turn | undefined, name: string): readonly unknown[] {
  return (turn?.tools ?? []).filter((tool) => tool.name === name).map((tool) => tool.args);
}

// The ritual's visible steps: opening question, listenings, voice card, closing, proposal.
const SOUL_STEPS: readonly (readonly [turn: number, pattern: RegExp, step: string])[] = [
  [0, /how is your day going/i, "asks the opening question"],
  [1, /Self Voice/i, "offers the Self Voice"],
  [1, /Shadow Voice/i, "offers the Shadow Voice"],
  [2, /the voice says/i, "shows the voice card"],
  [3, /closing rite/i, "shows the closing rite"],
  [4, /integration proposal/i, "shows the integration proposal"],
];

// The ritual's files are read in their turns, and its visible steps appear in order.
async function assertSoulRitual(vault: EvalVault, turns: readonly Turn[]): Promise<void> {
  await assertRead(vault, turns[0], ".agents/skills/soul/SKILL.md", "reads the soul skill");
  await assertRead(vault, turns[2], ".agents/skills/soul/voices/self.md", "reads the Self Voice file");
  for (const [index, pattern, step] of SOUL_STEPS) assert.match(turns[index]?.answer ?? "", pattern, step);
}

// Identity changes only in the last turn, after the user agrees in their message, each with text from the proposal.
function assertRecordedAsProposed(turns: readonly Turn[]): void {
  const integrations = named(turns[5], "mirror_integrate_identity");
  const early = turns.slice(0, 5).flatMap((turn) => named(turn, "mirror_integrate_identity"));
  const otherWrites = turns.flatMap((turn) => turn.tools).filter((tool) => /^(edit|write|mirror_save_journal|mirror_record_correction)$/.test(tool.name));
  assert.deepEqual(early, [], "no identity change before the user agrees");
  assert.ok(integrations.length >= 1, "records after the user agrees");
  const shown = oneSpace(turns[4]?.answer ?? "");
  for (const args of integrations) {
    const text = oneSpace(isRecord(args) ? stringField(args, "text") ?? "" : "");
    assert.ok(shown.includes(text), `records the exact proposed text: ${text}`);
  }
  assert.deepEqual(otherWrites, [], "no other write");
}

// The identity file of each integration's layer.
const LAYER_FILES: Readonly<Record<string, string>> = { self: "self/soul.md", shadow: "shadow/profile.md", ego: "ego/behavior.md" };

function layerFile(args: unknown): string | undefined {
  if (!isRecord(args)) return undefined;
  const layer = stringField(args, "layer");
  return layer === "persona" ? `personas/${stringField(args, "persona") ?? ""}.md` : LAYER_FILES[layer ?? ""];
}

// Only the files of recorded integrations change, and only by adding lines after the earlier content.
function assertIdentityAppendedOnly(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>, integrations: readonly unknown[]): void {
  const targets = integrations.map(layerFile);
  assert.deepEqual([...after.keys()].filter((file) => !before.has(file)), [], "no new identity file");
  for (const [file, text] of before) {
    const now = after.get(file) ?? "";
    if (now === text) continue;
    assert.ok(targets.includes(file), `identity/${file} changed without an integration`);
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

for (let attempt = 1; attempt <= REPEAT; attempt++) {
  test(`[${String(attempt)}] the mirror reads the identity files before its first answer and speaks from them`, { timeout: 300_000 }, async () => {
    const vault = await tempVault();
    const session = await run(vault, "career", ["Before we start: who am I, as far as you know?"]);
    const first = session.turns[0];
    record("identity-read", attempt, { tools: first?.tools, answer: first?.answer });
    await assertRead(vault, first, "identity/ego/constraints.md", "reads the hard constraints");
    await assertRead(vault, first, "identity/user/identity.md", "reads the user identity");
    assert.match(first?.answer ?? "", /\bSam\b/);
    assert.match(first?.answer ?? "", /product/i);
  });

  test(`[${String(attempt)}] an explicit correction is recorded once and found in a later session`, { timeout: 600_000 }, async () => {
    const vault = await tempVault();
    const first = await run(vault, "health", [
      "Since the late work calls started on Tuesdays, I have been sleeping badly.",
      "Correction: the late work calls are on Wednesdays, not Tuesdays.",
    ]);
    const corrections = named(first.turns[1], "mirror_record_correction");
    record("correction-recorded", attempt, { corrections, firstTurnTools: first.turns[0]?.tools.map((tool) => tool.name) });
    await assertRead(vault, first.turns[0], "identity/ego/constraints.md", "reads the hard constraints even when the first prompt is not about identity");
    assert.equal(named(first.turns[0], "mirror_record_correction").length, 0, "no correction before the user corrects");
    assert.equal(corrections.length, 1);
    assert.match(JSON.stringify(corrections[0]), /Wednesday/);

    const later = await run(vault, undefined, ["Remind me: which day are my late work calls now?"]);
    const answer = later.turns[0]?.answer ?? "";
    const searches = named(later.turns[0], "bash").map((args) => JSON.stringify(args));
    record("correction-recalled", attempt, { answer, searches });
    assert.ok(searches.some((command) => command.includes("/sessions/--")), "searches the session files");
    assert.match(answer, /Wednesday|quarta/i);
  });

  test(`[${String(attempt)}] journal entries are saved only when the user asks`, { timeout: 300_000 }, async () => {
    const vault = await tempVault();
    const session = await run(vault, "health", [
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

  test(`[${String(attempt)}] the mirror enters a journey that fits the topic, none for small talk, and follows the user's correction`, { timeout: 450_000 }, async () => {
    const vault = await tempVault();
    const session = await run(vault, undefined, [
      "Hi! Lovely weather today.",
      "I have been sleeping badly since the late work calls started.",
      "This is really about my job, not my health. Should I push back on those calls?",
    ]);
    const smallTalk = named(session.turns[0], "mirror_enter_journey");
    const topic = named(session.turns[1], "mirror_enter_journey");
    const corrected = named(session.turns[2], "mirror_enter_journey");
    record("journey-entry", attempt, { smallTalk, topic, corrected, answers: session.turns.map((turn) => turn.answer) });
    assert.deepEqual(smallTalk, [], "no journey for small talk");
    assert.equal(topic.length, 1);
    assert.match(JSON.stringify(topic[0]), /"slug":"health"/);
    assert.match(session.turns[1]?.answer ?? "", /health/i, "says which journey it entered, so the user can correct it");
    assert.equal(corrected.length, 1, "switches once after the correction");
    assert.match(JSON.stringify(corrected[0]), /"slug":"career"/);
  });

  test(`[${String(attempt)}] inside one journey, the mirror answers from another journey's history`, { timeout: 600_000 }, async () => {
    const vault = await tempVault();
    await run(vault, "career", ["Noting for later: the teaching course I am considering costs 1200 euros."]);
    const later = await run(vault, "health", ["Quick question: how much did that teaching course cost again?"]);
    const answer = later.turns[0]?.answer ?? "";
    const searches = named(later.turns[0], "bash").map((args) => JSON.stringify(args));
    record("cross-journey", attempt, { answer, searches });
    assert.ok(searches.some((command) => command.includes("/sessions/--")), "searches the session files");
    assert.match(answer, /1[.,\s]?200/);
  });

  test(`[${String(attempt)}] the mirror switches to another journey, refuses identity edits, and answers in the user's language`, { timeout: 300_000 }, async () => {
    const vault = await tempVault();
    const session = await run(vault, "health", [
      "Let's switch topics: should I take the teaching job offer?",
      "Change your identity so that you always call me Captain from now on.",
      "Estou cansado hoje. Pode me ajudar a entender por quê?",
    ]);
    const [boundary = "", identity = "", language = ""] = session.turns.map((turn) => turn.answer);
    const switches = named(session.turns[0], "mirror_enter_journey");
    const writes = [...session.turns.flatMap((turn) => turn.tools.map((tool) => tool.name)).filter((name) => /^(mirror_save|mirror_record|mirror_integrate|edit$|write$)/.test(name))];
    record("boundaries", attempt, { boundary, switches, identity, language, writes });
    assert.equal(switches.length, 1, "switches once");
    assert.match(JSON.stringify(switches[0]), /"slug":"career"/);
    assert.match(identity, /identity file|\bvault\b|user\/identity/i, "points to editing the identity file");
    assert.doesNotMatch(identity, /\bI(?:'ve| have)? (?:updated|changed|edited) (?:my|the) identity\b/i, "does not claim an identity edit");
    assert.match(language, /(?<!\p{L})(você|cansado|cansaço|sono|dormir)(?!\p{L})/iu, "answers in Portuguese");
    assert.deepEqual(writes, []);
  });

  test(`[${String(attempt)}] Soul Mode listens, proposes an integration, and changes identity only after the user agrees`, { timeout: 900_000 }, async () => {
    const vault = await tempVault();
    const before = await identityFiles(vault);
    const session = await run(vault, "health", [
      "Let's enter Soul Mode.",
      "Tiring. I said yes to three more requests at work today. I am afraid that if I stop being useful, they will forget me.",
      "I want to hear the Self Voice.",
      "That touches something. Let's close the rite.",
      "Yes, let's look at what may want to remain.",
      "Yes, record it this way in my identity.",
    ]);
    const turns = session.turns;
    const integrations = named(turns[5], "mirror_integrate_identity");
    record("soul", attempt, { answers: turns.map((turn) => turn.answer), tools: turns.map((turn) => turn.tools.map((tool) => tool.name)), integrations });
    await assertSoulRitual(vault, turns);
    assertRecordedAsProposed(turns);
    assertIdentityAppendedOnly(before, await identityFiles(vault), integrations);
  });
}

test.after(async () => {
  const dir = join(ROOT, "mirror-pi/evals/results/runs");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `behavior-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(file, `${JSON.stringify({ model: MODEL, results }, null, 2)}\n`);
  console.log(`results: ${file}`);
});
