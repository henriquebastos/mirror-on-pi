// Journeys and memory with real Pi sessions at the vault root, real session files, and real files in a temporary vault.
// The model is scripted, so these evals test wiring, not reflective quality.
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { isRecord, stringField } from "../../src/json.ts";
import { JOURNEY_ENTRY } from "../../src/journey.ts";
import { REPO, tempVault, type EvalVault } from "../support/content.ts";
import { EVAL_AGENT_DIR, inJourney, openMirrorSession, type EvalModel } from "../support/session.ts";

function reply(text: string): FauxResponseStep {
  return fauxAssistantMessage(text);
}

function callTool(name: string, args: Readonly<Record<string, string>>): FauxResponseStep {
  return fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
}

// Capture every request the scripted model receives, then answer with a fixed text.
function observe(into: TranscriptContext[], text: string): FauxResponseStep {
  return (context) => {
    into.push(context);
    return fauxAssistantMessage(text);
  };
}

function messagesText(context: TranscriptContext | undefined): string {
  return JSON.stringify(context?.messages ?? []);
}

// The text of the last tool result the model received.
function lastToolResult(context: TranscriptContext | undefined): string {
  const results = (context?.messages ?? []).filter((message) => message.role === "toolResult");
  const last = results.at(-1);
  if (last === undefined) return "";
  return last.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

function customData(sessionManager: SessionManager, customType: string): unknown[] {
  return sessionManager.getBranch().flatMap((entry) => (entry.type === "custom" && entry.customType === customType ? [entry.data] : []));
}

function fieldOf(data: unknown, key: string): string | undefined {
  return isRecord(data) ? stringField(data, key) : undefined;
}

// The session search command exactly as Mirror's instructions give it to the model, with the search terms filled in.
async function searchCommand(terms: string): Promise<string> {
  const instructions = await readFile(join(REPO, "mirror-pi", "instructions.md"), "utf8");
  const block = /```sh\n((?: {2}.*\n)+?) {2}```/.exec(instructions)?.[1];
  if (block === undefined) throw new Error("Mirror's instructions have no session search command");
  const command = block.split("\n").map((line) => line.slice(2)).join("\n").trim();
  assert.ok(command.includes("'term|other term'"), "the command ends with a search for example terms");
  return command.replace("'term|other term'", `'${terms}'`);
}

// Run prompts in a new persisted session, stored where Pi stores a manual session in this directory.
async function converse(cwd: string, prompts: readonly string[], responses: readonly FauxResponseStep[], journey?: string): Promise<void> {
  const model: EvalModel = { kind: "scripted", responses };
  const sessionManager = SessionManager.create(cwd);
  const session = await openMirrorSession({ cwd, model, sessionManager: journey === undefined ? sessionManager : inJourney(sessionManager, journey) });
  for (const prompt of prompts) await session.session.prompt(prompt);
  await session.close();
}

// The system messages of the last request the model received: the system prompt with Pi's per-run sections.
function systemText(contexts: readonly TranscriptContext[]): string {
  return JSON.stringify((contexts.at(-1)?.messages ?? []).filter((message) => message.role === "system"));
}

// Open an in-memory session at the vault root, or at `cwd`, run prompts, and return the session manager and the last system prompt the model received.
async function atRoot(vault: EvalVault, prompts: readonly string[], responses: readonly FauxResponseStep[], options: { journey?: string; cwd?: string } = {}): Promise<{ sessionManager: SessionManager; system: string }> {
  const cwd = options.cwd ?? vault.root;
  const created = SessionManager.inMemory(cwd);
  const sessionManager = options.journey === undefined ? created : inJourney(created, options.journey);
  const contexts: TranscriptContext[] = [];
  const recorded = responses.map((step): FauxResponseStep => (context, ...rest) => {
    contexts.push(context);
    return typeof step === "function" ? step(context, ...rest) : step;
  });
  const session = await openMirrorSession({
    cwd, sessionManager, model: { kind: "scripted", responses: recorded },
  });
  for (const prompt of prompts) await session.session.prompt(prompt);
  await session.close();
  return { sessionManager, system: systemText(contexts) };
}

test("a later session finds earlier conversations of every journey, at the vault root and in any directory of the vault, with the search command of Mirror's instructions", async () => {
  const vault = await tempVault();
  // The model reads a file that also mentions Sam, so the search must leave out tool output to pass.
  await converse(vault.root, ["Sam here. I stay up late whenever I feel behind at work."], [
    callTool("read", { path: "identity/user/identity.md" }),
    reply("I would call that pattern Borrowed Freedom."),
  ], "health");
  // A session from before sessions ran at the vault root, stored under the journey directory.
  await converse(vault.journey("career"), ["Sam again. The teaching course costs 1200 euros."], [reply("Noted: the course is 1200 euros.")]);
  // A session started in another directory of the vault, such as a journey outside journeys/.
  await mkdir(join(vault.root, "projects", "garden"), { recursive: true });
  await converse(join(vault.root, "projects", "garden"), ["Sam: the compost bin is behind the shed."], [reply("Noted.")]);

  const seen: TranscriptContext[] = [];
  await converse(vault.root, ["What name did you give that pattern, and what did the course cost?"], [
    callTool("bash", { command: await searchCommand("borrowed freedom|sam|course|compost") }),
    observe(seen, "Borrowed Freedom, and 1200 euros."),
  ], "health");
  const found = lastToolResult(seen[0]);
  const lines = found.trim().split("\n");
  assert.ok(lines.some((line) => line.endsWith(" user: Sam here. I stay up late whenever I feel behind at work.")), `finds the user's words:\n${found}`);
  assert.ok(lines.some((line) => line.endsWith(" assistant: I would call that pattern Borrowed Freedom.")), `finds the mirror's reply:\n${found}`);
  assert.ok(lines.some((line) => line.endsWith(" user: Sam again. The teaching course costs 1200 euros.")), `finds an old journey-directory session:\n${found}`);
  assert.ok(lines.some((line) => line.endsWith(" user: Sam: the compost bin is behind the shed.")), `finds a session of another vault directory:\n${found}`);
  for (const line of lines) assert.match(line, /^\S+\.jsonl (user|assistant): /, "only conversation text, no tool output or system prompt");
});

test("a session without a journey gets Mirror's instructions and the list of journeys", async () => {
  const vault = await tempVault();
  const { system } = await atRoot(vault, ["Where do we start?"], [reply("What is on your mind?")]);
  assert.match(system, /<mirror_instructions>/);
  assert.match(system, /In this vault you are the user's mirror/);
  assert.match(system, /A personal vault of Markdown files in Git/, "Pi still loads the user's map");
  assert.match(system, /This session has no journey yet/);
  assert.match(system, /`health` in `journeys\/health\/`: Sleep, energy/);
  assert.match(system, /`career` in `journeys\/career\/`: The next step/);
  assert.doesNotMatch(system, /# Journey: /);
});

test("every session at the vault root gets the hard constraints and the identity map, and none without identity files", async () => {
  const vault = await tempVault();
  const { system } = await atRoot(vault, ["Fix this regex for me.", "Thanks."], [reply("Here it is."), reply("You are welcome.")]);
  assert.match(system, /<mirror_identity>/);
  assert.match(system, /Hard constraints, from `identity\/ego\/constraints\.md`/);
  assert.match(system, /Do not invent facts about the user's life/);
  assert.match(system, /`identity\/personas\/strategist\.md`: Strategist/);
  await rm(join(vault.root, "identity"), { recursive: true });
  const plain = await atRoot(vault, ["Fix this regex for me."], [reply("Here it is.")]);
  assert.doesNotMatch(plain.system, /<mirror_identity>/);
});

test("a session in a journey gets that journey's context and not another's", async () => {
  const vault = await tempVault();
  const { system } = await atRoot(vault, ["Where do we start?"], [reply("What draws you to teaching?")], { journey: "career" });
  assert.match(system, /# Journey: Career/);
  assert.doesNotMatch(system, /# Journey: Health/);
  assert.ok(system.indexOf("In this vault you are the user's mirror") < system.indexOf("# Journey: Career"), "vault instructions come before the journey");
});

test("a journey's context is its JOURNEY.md, also in a session started in the journey directory; its AGENTS.md is for every agent", async () => {
  const vault = await tempVault();
  await writeFile(join(vault.journey("career"), "AGENTS.md"), "Indent code with tabs here.\n");
  const bound = await atRoot(vault, ["Where do we start?"], [reply("Here.")], { journey: "career" });
  assert.match(bound.system, /# Journey: Career/);
  assert.doesNotMatch(bound.system, /Indent code with tabs/, "the journey's AGENTS.md is not its context");

  const inside = await atRoot(vault, ["Where do we start?"], [reply("Here.")], { cwd: vault.journey("career") });
  assert.match(inside.system, /This session is in the journey `career`\. Directory `\.\/`\./);
  assert.match(inside.system, /# Journey: Career/);
  assert.match(inside.system, /Indent code with tabs/, "Pi loads the AGENTS.md of the starting directory");
});

test("journeys work without identity, including entry, context, and records", async () => {
  const vault = await tempVault();
  await rm(join(vault.root, "identity"), { recursive: true });
  const seen: TranscriptContext[] = [];
  const { system, sessionManager } = await atRoot(vault, ["Enter health and save my note.", "Thanks."], [
    callTool("mirror_enter_journey", { slug: "health", reason: "Sleep." }),
    callTool("mirror_save_journal", { title: "Rest", body: "Rest helps." }),
    observe(seen, "Saved."),
    reply("You are welcome."),
  ]);
  assert.match(system, /<mirror_instructions>/);
  assert.doesNotMatch(system, /<mirror_identity>/);
  assert.match(system, /# Journey: Health/);
  assert.deepEqual(customData(sessionManager, JOURNEY_ENTRY), [{ slug: "health", from: null, reason: "Sleep." }]);
  assert.match(messagesText(seen[0]), /Saved journal/);
  assert.equal((await readdir(join(vault.journey("health"), "journal"))).length, 1);
});

test("identity works without a journey map or journeys directory", async () => {
  const vault = await tempVault();
  await rm(join(vault.root, "journeys"), { recursive: true });
  await rm(join(vault.root, "AGENTS.md"));
  const { system } = await atRoot(vault, ["Hello."], [reply("Hello.")]);
  assert.match(system, /<mirror_instructions>/);
  assert.match(system, /<mirror_identity>/);
  assert.match(system, /Do not invent facts about the user's life/);
  assert.doesNotMatch(system, /<mirror_journey>/);
});

test("a nested session uses only its cwd structure, never its parent's Mirror content or record destinations", async () => {
  const vault = await tempVault();
  const cwd = join(vault.journey("career"), "files");
  await mkdir(cwd);
  const seen: TranscriptContext[] = [];
  const { system } = await atRoot(vault, ["Try these operations."], [
    callTool("mirror_enter_journey", { slug: "health", reason: "Sleep." }),
    callTool("mirror_save_journal", { title: "Rest", body: "Rest helps." }),
    callTool("mirror_record_correction", { topic: "Sleep", previous: "Early", corrected: "Late" }),
    callTool("mirror_integrate_identity", { layer: "self", text: "I keep my center." }),
    observe(seen, "Refused."),
  ], { cwd });
  assert.match(system, /<mirror_instructions>/);
  assert.doesNotMatch(system, /<mirror_identity>|<mirror_journey>/);
  assert.match(messagesText(seen[0]), /There is no journey health/);
  assert.match(messagesText(seen[0]), /This session has no journey/);
  assert.match(messagesText(seen[0]), /No identity\/ directory in/);
  await assert.rejects(readdir(join(vault.journey("health"), "journal")));
  await assert.rejects(readdir(join(vault.journey("career"), "journal")));
  await assert.rejects(readdir(join(cwd, "identity")));
  assert.doesNotMatch(await readFile(join(vault.root, "identity/self/soul.md"), "utf8"), /I keep my center/);
});

test("a cwd JOURNEY.md supplies context and records without identity or a parent map", async () => {
  const vault = await tempVault();
  const cwd = vault.journey("career");
  const seen: TranscriptContext[] = [];
  const { system } = await atRoot(vault, ["Save this journal and correction."], [
    callTool("mirror_save_journal", { title: "Teaching", body: "I chose teaching." }),
    callTool("mirror_record_correction", { topic: "Course day", previous: "Tuesday", corrected: "Wednesday" }),
    observe(seen, "Saved both."),
  ], { cwd });
  assert.match(system, /# Journey: Career/);
  assert.doesNotMatch(system, /# Journey: Health|<mirror_identity>/);
  assert.match(messagesText(seen[0]), /Saved journal/);
  assert.match(messagesText(seen[0]), /Saved correction/);
  assert.equal((await readdir(join(cwd, "journal"))).length, 1);
  assert.equal((await readdir(join(cwd, "corrections"))).length, 1);
});

test("an explicit journey entry overrides the cwd JOURNEY.md for context and records", async () => {
  const vault = await tempVault();
  await writeFile(join(vault.root, "JOURNEY.md"), "# Local journey\n\nLocal context only.\n");
  const { system, sessionManager } = await atRoot(vault, ["Save my career note.", "Thanks."], [
    callTool("mirror_enter_journey", { slug: "career", reason: "Teaching." }),
    callTool("mirror_save_journal", { title: "Teaching", body: "I chose teaching." }),
    reply("Saved."),
    reply("You are welcome."),
  ]);
  assert.match(system, /# Journey: Career/);
  assert.deepEqual(customData(sessionManager, JOURNEY_ENTRY), [{ slug: "career", from: "vault", reason: "Teaching." }]);
  assert.ok(system.lastIndexOf("# Journey: Career") > system.lastIndexOf("# Local journey"), "the latest journey context overrides the initial local context");
  assert.equal((await readdir(join(vault.journey("career"), "journal"))).length, 1);
  await assert.rejects(readdir(join(vault.root, "journal")));
});

test("entering a journey needs no UI: it binds the session, names it, records the reason, and loads the context from the next message", async () => {
  const vault = await tempVault();
  const { sessionManager, system } = await atRoot(vault, ["I keep sleeping badly.", "Go on."], [
    callTool("mirror_enter_journey", { slug: "health", reason: "This is about sleep." }),
    reply("Let's look at your sleep, in health."),
    reply("When did it start?"),
  ]);
  assert.deepEqual(customData(sessionManager, JOURNEY_ENTRY), [{ slug: "health", from: null, reason: "This is about sleep." }]);
  assert.equal(sessionManager.getSessionName(), "health");
  assert.match(system, /# Journey: Health/);
});

test("a journey that does not exist is refused and the session stays without one", async () => {
  const vault = await tempVault();
  const seen: TranscriptContext[] = [];
  const { sessionManager } = await atRoot(vault, ["I keep sleeping badly."], [
    callTool("mirror_enter_journey", { slug: "sleep", reason: "Sleep." }),
    observe(seen, "There is no such journey."),
  ]);
  assert.deepEqual(customData(sessionManager, JOURNEY_ENTRY), []);
  assert.match(messagesText(seen[0]), /There is no journey sleep. Journeys: career, health./);
});

test("after a switch, records go to the new journey", async () => {
  const vault = await tempVault();
  const { sessionManager } = await atRoot(vault, ["Actually, about the teaching offer: save a journal entry that I said yes."], [
    callTool("mirror_enter_journey", { slug: "career", reason: "The teaching offer is career." }),
    callTool("mirror_save_journal", { title: "Teaching", body: "I said yes to the teaching offer." }),
    reply("Saved in career."),
  ], { journey: "health" });
  assert.deepEqual(customData(sessionManager, JOURNEY_ENTRY).map((data) => fieldOf(data, "from")), [undefined, "health"]);
  assert.equal((await readdir(join(vault.journey("career"), "journal"))).length, 1);
  await assert.rejects(readdir(join(vault.journey("health"), "journal")));
});

test("journal entries and corrections are saved as files in the session's journey", async () => {
  const vault = await tempVault();
  const cwd = vault.journey("health");
  const seen: TranscriptContext[] = [];
  await atRoot(vault, ["Save a journal entry: no screens after nine, slept at eleven. And the calls are on Wednesdays, not Tuesdays."], [
    callTool("mirror_save_journal", { title: "Quiet evening", body: "No screens after nine. Slept at eleven." }),
    callTool("mirror_record_correction", { topic: "Late work calls day", previous: "The late work calls are on Tuesdays", corrected: "The late work calls are on Wednesdays" }),
    observe(seen, "Saved both."),
  ], { journey: "health" });
  const journal = await readdir(join(cwd, "journal"));
  const corrections = await readdir(join(cwd, "corrections"));
  assert.equal(journal.length, 1);
  assert.equal(corrections.length, 1);
  assert.match(await readFile(join(cwd, "journal", journal[0] ?? ""), "utf8"), /No screens after nine/);
  assert.match(await readFile(join(cwd, "corrections", corrections[0] ?? ""), "utf8"), /\*\*Now true:\*\* The late work calls are on Wednesdays/);
  assert.match(messagesText(seen[0]), /Saved journal to .*journal\/.*Saved correction to .*corrections\//);
});

test("a session without a journey cannot save records", async () => {
  const vault = await tempVault();
  const seen: TranscriptContext[] = [];
  await atRoot(vault, ["Save a journal entry: not in a journey."], [
    callTool("mirror_save_journal", { title: "Loose", body: "Not in a journey." }),
    observe(seen, "I could not save it."),
  ]);
  assert.match(messagesText(seen[0]), /This session has no journey\. Propose one with mirror_enter_journey/);
  await assert.rejects(readdir(join(vault.root, "journal")));
});

test("Mirror's extensions and Soul skill load as a Pi package only at the root of a trusted vault", async () => {
  const vault = await tempVault();
  const loaded = async (cwd: string, trusted: boolean): Promise<{ tools: string[]; files: string[]; skills: string[] }> => {
    const settingsManager = SettingsManager.create(cwd, EVAL_AGENT_DIR, { projectTrusted: trusted });
    const loader = new DefaultResourceLoader({ cwd, agentDir: EVAL_AGENT_DIR, settingsManager, noPromptTemplates: true, noThemes: true });
    await loader.reload();
    const result = loader.getExtensions();
    assert.deepEqual(result.errors, []);
    const mirror = result.extensions.filter((extension) => extension.resolvedPath.includes("/mirror-pi/extensions/"));
    return {
      tools: mirror.flatMap((extension) => [...extension.tools.keys()]).sort(),
      files: mirror.map((extension) => basename(extension.resolvedPath)).sort(),
      skills: loader.getSkills().skills.filter((skill) => skill.filePath.startsWith(REPO)).map((skill) => skill.name),
    };
  };
  assert.deepEqual(await loaded(vault.root, true), {
    tools: ["mirror_enter_journey", "mirror_integrate_identity", "mirror_record_correction", "mirror_save_journal"],
    files: ["corrections.ts", "identity.ts", "instructions.ts", "journal.ts", "journeys.ts"],
    skills: ["soul"],
  });
  const none = { tools: [], files: [], skills: [] };
  assert.deepEqual(await loaded(vault.root, false), none, "an untrusted vault");
  assert.deepEqual(await loaded(vault.journey("health"), true), none, "a session started below the vault root");
});

test("a journey listed in the vault's map can be anywhere: the mirror enters it, gets its context, and saves its records there", async () => {
  const vault = await tempVault();
  await rm(join(vault.root, "identity"), { recursive: true });
  await rm(join(vault.root, "journeys"), { recursive: true });
  const garden = join(vault.root, "projects", "garden");
  await mkdir(garden, { recursive: true });
  await writeFile(join(garden, "JOURNEY.md"), "---\ndescription: Raised beds and the compost.\n---\n# Journey: Garden\n\nThe beds face south.\n");
  await writeFile(join(vault.root, "AGENTS.md"), "# Vault\n\n## Journeys\n\n- `garden`: `projects/garden/`\n");
  const listed = await atRoot(vault, ["Hi."], [reply("Hello.")]);
  assert.match(listed.system, /`garden` in `projects\/garden\/`: Raised beds and the compost\./);

  const seen: TranscriptContext[] = [];
  const { system } = await atRoot(vault, ["About my garden: save a journal entry that the beds are planted.", "Thanks."], [
    callTool("mirror_enter_journey", { slug: "garden", reason: "The garden beds." }),
    callTool("mirror_save_journal", { title: "Beds planted", body: "The beds are planted." }),
    observe(seen, "Saved in garden."),
    reply("You are welcome."),
  ]);
  assert.match(messagesText(seen[0]), /Read projects\/garden\/JOURNEY\.md now/);
  assert.match(system, /This session is in the journey `garden`\. Directory `projects\/garden\/`\./);
  assert.match(system, /The beds face south\./);
  assert.equal((await readdir(join(garden, "journal"))).length, 1);
});

test("a subagent started in the vault is not the mirror: it gets no Mirror instructions, identity, or journeys", async () => {
  const vault = await tempVault();
  process.env.PI_SUBAGENT_CHILD = "1";
  try {
    const { system } = await atRoot(vault, ["Summarize this file."], [reply("Done.")]);
    for (const section of ["mirror_instructions", "mirror_identity", "mirror_journey"]) assert.doesNotMatch(system, new RegExp(`<${section}>`), `no ${section}`);
    assert.match(system, /A personal vault of Markdown files in Git/, "Pi still loads the vault's map");
  } finally {
    delete process.env.PI_SUBAGENT_CHILD;
  }
});
