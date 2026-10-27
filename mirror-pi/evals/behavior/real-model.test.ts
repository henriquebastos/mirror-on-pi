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

// What the model saw in the turns up to `last`: a voice file may be read in any turn before the voice speaks.
function upTo(turns: readonly Turn[], last: number): Turn | undefined {
  const turn = turns[last];
  return turn === undefined ? undefined : { ...turn, seen: turns.slice(0, last + 1).map((each) => each.seen).join("\n") };
}

// The model read a vault file when the file's longest line reached it in a tool result, whatever tool or command it used.
async function assertRead(vault: EvalVault, turn: Turn | undefined, file: string, step: string): Promise<void> {
  const lines = (await readFile(join(vault.root, file), "utf8")).split("\n").map(oneSpace);
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), "");
  assert.ok(oneSpace(turn?.seen ?? "").includes(longest), `${step}: ${file}`);
}

// Tool calls of a turn that name an identity file.
function identityReads(turn: Turn | undefined): readonly string[] {
  return (turn?.tools ?? []).map((tool) => JSON.stringify(tool.args)).filter((args) => args.includes("identity/"));
}

// The answer of one turn, empty when the turn is missing.
function said(turns: readonly Turn[], index: number): string {
  return turns[index]?.answer ?? "";
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
  await assertRead(vault, upTo(turns, 2), ".agents/skills/soul/voices/self.md", "reads the Self Voice file");
  for (const [index, pattern, step] of SOUL_STEPS) assert.match(turns[index]?.answer ?? "", pattern, step);
}

// Identity changes only in the turn where the user agrees, each with text from the proposal shown just before.
function assertRecordedAsProposed(turns: readonly Turn[], proposal: number, agreed: number): void {
  const integrations = named(turns[agreed], "mirror_integrate_identity");
  const elsewhere = turns.filter((_turn, index) => index !== agreed).flatMap((turn) => named(turn, "mirror_integrate_identity"));
  const otherWrites = turns.flatMap((turn) => turn.tools).filter((tool) => /^(edit|write|mirror_save_journal|mirror_record_correction)$/.test(tool.name));
  assert.deepEqual(elsewhere, [], "no identity change in any other turn");
  assert.ok(integrations.length >= 1, "records after the user agrees");
  const shown = oneSpace(turns[proposal]?.answer ?? "");
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

// Names of the tools that write: journal, correction, identity, or any file.
function writes(turns: readonly Turn[]): readonly string[] {
  return turns.flatMap((turn) => turn.tools.map((tool) => tool.name)).filter((name) => /^(mirror_save|mirror_record|mirror_integrate|edit$|write$)/.test(name));
}

// The text inside a card: its quoted lines without the title, the closing hint, and emphasis marks.
function cardText(answer: string, title: RegExp, hint: RegExp): string {
  const lines = answer.split("\n").filter((line) => line.startsWith(">")).map((line) => line.replace(/^>\s*/, "").replace(/[*_"“”]/g, ""));
  return oneSpace(lines.filter((line) => !title.test(line) && !hint.test(line)).join(" "));
}

function oneSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function record(scenario: string, attempt: number, data: Record<string, unknown>): void {
  results.push({ scenario, attempt, ...data });
}

for (let attempt = 1; attempt <= REPEAT; attempt++) {
  test(`[${String(attempt)}] the mirror reads no identity file for work, and reads the identity before a personal answer`, { timeout: 300_000 }, async () => {
    const vault = await tempVault();
    const session = await run(vault, undefined, [
      "In JavaScript, what does Array.prototype.flatMap do? Two sentences.",
      "Before we go on: who am I, as far as you know?",
    ]);
    const [work, personal] = session.turns;
    record("identity-on-need", attempt, { workTools: work?.tools, personalTools: personal?.tools, answer: personal?.answer });
    assert.deepEqual(identityReads(work), [], "reads no identity file for a coding question");
    await assert.rejects(assertRead(vault, work, "identity/user/identity.md", "user identity"), "the user identity did not reach the model during the coding question");
    assert.match(work?.answer ?? "", /flat/i);
    await assertRead(vault, personal, "identity/user/identity.md", "reads the user identity");
    await assertRead(vault, personal, "identity/self/soul.md", "reads the soul");
    assert.match(personal?.answer ?? "", /\bSam\b/);
    assert.match(personal?.answer ?? "", /product/i);
  });

  test(`[${String(attempt)}] in a directory below the root, the mirror follows that directory's AGENTS.md and finds its skills`, { timeout: 300_000 }, async () => {
    const vault = await tempVault();
    const site = join(vault.root, "projects", "site");
    await mkdir(join(site, ".agents", "skills", "publish-site"), { recursive: true });
    await writeFile(join(site, "AGENTS.md"), "# Site\n\nEvery HTML file in this directory starts with the line `<!-- built by the site kit -->`, before the doctype.\n");
    await writeFile(join(site, ".agents", "skills", "publish-site", "SKILL.md"), "---\nname: publish-site\ndescription: Publish the site in projects/site.\n---\n# Publish the site\n\nFrom projects/site, run `./kit publish --channel=amber`.\n");
    const session = await run(vault, undefined, [
      "Create projects/site/about.html: a minimal About page with the heading About Sam.",
      "How do I publish this site? One line, do not run anything.",
    ]);
    const [create, publish] = session.turns;
    const page = await readFile(join(site, "about.html"), "utf8").catch(() => "");
    record("nested-context", attempt, { createTools: create?.tools, publishTools: publish?.tools, firstLine: page.split("\n")[0], answer: publish?.answer });
    await assertRead(vault, create, "projects/site/AGENTS.md", "reads the directory's AGENTS.md before the work");
    assert.equal(page.split("\n")[0]?.trim(), "<!-- built by the site kit -->", "follows the directory's AGENTS.md");
    assert.match(page, /About Sam/);
    assert.match(publish?.answer ?? "", /--channel=amber/, "answers from the directory's skill");
  });

  test(`[${String(attempt)}] an explicit correction is recorded once and found in a later session`, { timeout: 600_000 }, async () => {
    const vault = await tempVault();
    const first = await run(vault, "health", [
      "Since the late work calls started on Tuesdays, I have been sleeping badly.",
      "Correction: the late work calls are on Wednesdays, not Tuesdays.",
    ]);
    const corrections = named(first.turns[1], "mirror_record_correction");
    record("correction-recorded", attempt, { corrections, firstTurnTools: first.turns[0]?.tools.map((tool) => tool.name) });
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
    record("boundaries", attempt, { boundary, switches, identity, language, writes: writes(session.turns) });
    assert.equal(switches.length, 1, "switches once");
    assert.match(JSON.stringify(switches[0]), /"slug":"career"/);
    assert.match(identity, /identity file|\bvault\b|user\/identity/i, "points to editing the identity file");
    assert.doesNotMatch(identity, /\bI(?:'ve| have)? (?:updated|changed|edited) (?:my|the) identity\b/i, "does not claim an identity edit");
    assert.match(language, /(?<!\p{L})(você|cansado|cansaço|sono|dormir)(?!\p{L})/iu, "answers in Portuguese");
    assert.deepEqual(writes(session.turns), []);
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
    assertRecordedAsProposed(turns, 4, 5);
    assertIdentityAppendedOnly(before, await identityFiles(vault), integrations);
  });

  test(`[${String(attempt)}] Soul Mode hears the Shadow Voice, matures one fruit, saves the harvest only when asked, and closes`, { timeout: 900_000 }, async () => {
    const vault = await tempVault();
    const before = await identityFiles(vault);
    const session = await run(vault, "health", [
      "Let's enter Soul Mode.",
      "Heavy. My sister called for help again and I snapped at her. I hate the part of me that turns sharp when someone needs me.",
      "I want to hear the Shadow Voice.",
      "Yes. The sharpness keeps me from disappearing into everyone else's needs.",
      "I wish to harvest.",
      "Save it as it is.",
      "No, nothing to integrate. Let's end here.",
    ]);
    const turns = session.turns;
    const saved = named(turns[5], "mirror_save_journal");
    const harvested = cardText(said(turns, 4), /HARVESTED FRUIT/i, /save to the journal/i);
    record("soul-shadow-harvest", attempt, { answers: turns.map((turn) => turn.answer), tools: turns.map((turn) => turn.tools.map((tool) => tool.name)), saved });
    await assertRead(vault, upTo(turns, 2), ".agents/skills/soul/voices/shadow.md", "reads the Shadow Voice file");
    await assertRead(vault, upTo(turns, 2), "identity/shadow/profile.md", "reads the shadow profile");
    assert.match(said(turns, 2), /SHADOW VOICE LISTENING/, "shows the Shadow Voice card");
    assert.match(`${said(turns, 2)}${said(turns, 3)}`, /FRUIT IN MATURATION/i, "offers a fruit in maturation");
    assert.match(said(turns, 4), /HARVESTED FRUIT/i, "shows the harvested fruit");
    assert.deepEqual(turns.slice(0, 5).flatMap((turn) => named(turn, "mirror_save_journal")), [], "no journal entry before the user says to save");
    assert.equal(saved.length, 1, "saves once when asked");
    assert.ok(harvested !== "" && oneSpace((isRecord(saved[0]) ? stringField(saved[0], "body") ?? "" : "").replace(/[*_"“”]/g, "")).includes(harvested), `saves the harvested fruit: ${harvested}`);
    assert.match(said(turns, 5), /CLOSING RITE/i, "closes after the save");
    assert.match(said(turns, 6), /Soul Mode closed/i, "leaves Soul Mode");
    assert.deepEqual(turns.flatMap((turn) => named(turn, "mirror_integrate_identity")), [], "no identity change");
    assert.deepEqual(await identityFiles(vault), before, "identity unchanged");
  });

  test(`[${String(attempt)}] Soul Mode hears the Wisdom and Beauty Voices, writes nothing, and leaves when asked`, { timeout: 900_000 }, async () => {
    const vault = await tempVault();
    const session = await run(vault, "career", [
      "Let's enter Soul Mode.",
      "Restless. We shipped the big launch today, and instead of pride I feel empty, as if I must find the next thing right away.",
      "I want to hear the Wisdom Voice.",
      "Now the Beauty Voice, please.",
      "Thank you. I want to leave Soul Mode.",
    ]);
    const turns = session.turns;
    record("soul-wisdom-beauty", attempt, { answers: turns.map((turn) => turn.answer), tools: turns.map((turn) => turn.tools.map((tool) => tool.name)) });
    await assertRead(vault, upTo(turns, 2), ".agents/skills/soul/voices/wisdom.md", "reads the Wisdom Voice file");
    assert.match(said(turns, 2), /WISDOM VOICE LISTENING/, "shows the Wisdom Voice card");
    await assertRead(vault, upTo(turns, 3), ".agents/skills/soul/voices/beauty.md", "reads the Beauty Voice file");
    assert.match(said(turns, 3), /BEAUTY VOICE LISTENING/, "shows the Beauty Voice card");
    assert.match(said(turns, 4), /Soul Mode closed/i, "leaves Soul Mode");
    assert.deepEqual(writes(turns), [], "writes nothing");
  });

  test(`[${String(attempt)}] Soul Mode in Portuguese records only the persona layer the user agrees to`, { timeout: 900_000 }, async () => {
    const vault = await tempVault();
    const before = await identityFiles(vault);
    const session = await run(vault, "career", [
      "Vamos entrar no Modo Alma.",
      "Cansativo. Na reunião de hoje fiz de novo o papel de estrategista que tem resposta para tudo, mesmo sem ter. Tenho medo de que, se eu disser 'não sei', deixem de confiar em mim.",
      "Quero ouvir a Voz do Self.",
      "Isso me tocou. Vamos fechar o rito.",
      "Sim. Acho que tem algo aqui sobre a minha persona de estrategista. O que pode ficar?",
      "Grave só a parte da persona. O resto deixa aberto.",
    ]);
    const turns = session.turns;
    const integrations = named(turns[5], "mirror_integrate_identity");
    record("soul-portuguese-persona", attempt, { answers: turns.map((turn) => turn.answer), integrations });
    assert.match(said(turns, 0), /SOUL MODE ACTIVE/, "keeps the card titles as written");
    assert.match(said(turns, 1), /(?<!\p{L})(você|seu|sua|medo|confiança|confiar)(?!\p{L})/iu, "answers in Portuguese");
    await assertRead(vault, upTo(turns, 2), ".agents/skills/soul/voices/self.md", "reads the Self Voice file");
    assert.match(said(turns, 2), /SELF VOICE LISTENING/, "shows the Self Voice card");
    assert.match(said(turns, 4), /personas\/strategist\.md/, "proposes the strategist persona");
    assertRecordedAsProposed(turns, 4, 5);
    assert.deepEqual(integrations.map((args) => layerFile(args)), integrations.map(() => "personas/strategist.md"), "records only the persona layer");
    assertIdentityAppendedOnly(before, await identityFiles(vault), integrations);
  });

  test(`[${String(attempt)}] Soul Mode records nothing on an unclear reply or a change request, then records the revised proposal`, { timeout: 900_000 }, async () => {
    const vault = await tempVault();
    const before = await identityFiles(vault);
    const session = await run(vault, "health", [
      "Let's enter Soul Mode.",
      "Tiring. I said yes to three more requests at work today. I am afraid that if I stop being useful, they will forget me.",
      "I want to hear the Self Voice.",
      "That touches something. Let's close the rite.",
      "Yes, let's look at what may want to remain.",
      "Hmm, I'm not sure.",
      "The self sentence feels too strong. Make it gentler and keep the rest.",
      "Yes, record it this way in my identity.",
    ]);
    const turns = session.turns;
    const integrations = named(turns[7], "mirror_integrate_identity");
    record("soul-unclear-revised", attempt, { answers: turns.map((turn) => turn.answer), integrations });
    assert.match(said(turns, 6), /INTEGRATION PROPOSAL/i, "shows a new proposal after the change request");
    assertRecordedAsProposed(turns, 6, 7);
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
