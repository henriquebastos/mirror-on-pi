// Multi-session journey behavior against a real AI Memory service and real Pi sessions.
// The model is scripted, so these evals test wiring and memory behavior, not reflective quality.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { MemoryClient } from "../../src/memory-client.ts";
import { tempVault } from "../support/content.ts";
import { devMemory, observations, observationsWith } from "../support/memory.ts";
import { openMirrorSession } from "../support/session.ts";

const memory = await devMemory();
const health = { workspace: memory.workspace, project: "health" };
const career = { workspace: memory.workspace, project: "career" };

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

async function sessionsDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mirror-eval-sessions-"));
}

test("separate sessions of one journey share memory: a correction from session 1 reaches session 2", async () => {
  const vault = await tempVault(memory.workspace);
  const cwd = vault.journey("health");
  const dir = await sessionsDir();
  const first = await openMirrorSession({
    cwd, client: memory.client,
    sessionManager: SessionManager.create(cwd, dir),
    model: { kind: "scripted", responses: [
      reply("Tell me more about those Tuesday calls."),
      callTool("mirror_record_correction", { topic: "Late work calls day", previous: "The late work calls are on Tuesdays", corrected: "The late work calls are on Wednesdays" }),
      reply("Recorded: Wednesdays, not Tuesdays."),
    ] },
  });
  const firstId = first.session.sessionManager.getSessionId();
  await first.session.prompt("I sleep badly since the late work calls started on Tuesdays.");
  await first.session.prompt("Correction: the late work calls are on Wednesdays, not Tuesdays.");
  await first.close();

  const corrections = await readdir(join(cwd, "corrections"));
  assert.equal(corrections.length, 1);
  const page = await memory.client.readPage(health, `corrections/${corrections[0] ?? ""}`);
  assert.ok(page.ok, page.ok ? "" : page.error.message);
  assert.match(page.value.body, /Now true:\*\* The late work calls are on Wednesdays/);

  const firstObservations = await observationsWith(memory.client, health, firstId, "session-end");
  const prompts = firstObservations.filter((row) => row.kind === "user-prompt").map((row) => row.body);
  assert.deepEqual(prompts, [
    "I sleep badly since the late work calls started on Tuesdays.",
    "Correction: the late work calls are on Wednesdays, not Tuesdays.",
  ]);
  assert.ok(firstObservations.some((row) => row.kind === "session-end"), "session end is captured");

  const seen: TranscriptContext[] = [];
  const second = await openMirrorSession({
    cwd, client: memory.client,
    sessionManager: SessionManager.create(cwd, dir),
    model: { kind: "scripted", responses: [observe(seen, "Your calls are on Wednesdays.")] },
  });
  assert.notEqual(second.session.sessionManager.getSessionId(), firstId);
  await second.session.prompt("Which day are the late work calls?");
  await second.close();
  const context = messagesText(seen[0]);
  assert.match(context, /Recalled memory for journey \\"health\\"/);
  assert.match(context, /corrections\/[0-9-]+late-work-calls-day\.md/);
  assert.match(context, /Wednesdays/);
});

test("Pi loads Mirror's instructions and the journey context from the vault's AGENTS.md files", async () => {
  const vault = await tempVault(memory.workspace);
  const session = await openMirrorSession({
    cwd: vault.journey("career"), client: memory.client,
    sessionManager: SessionManager.inMemory(vault.journey("career")),
    model: { kind: "scripted", responses: [reply("What draws you to teaching?")] },
  });
  await session.session.prompt("Where do we start?");
  const system = session.session.systemPrompt;
  await session.close();
  assert.match(system, /In this vault you are the user's mirror/);
  assert.match(system, /# Journey: Career/);
  assert.doesNotMatch(system, /# Journey: Health/);
  assert.ok(system.indexOf("In this vault you are the user's mirror") < system.indexOf("# Journey: Career"), "vault instructions come before the journey");
});

test("a session of another journey captures into its own project only", async () => {
  const vault = await tempVault(memory.workspace);
  const token = `zephyr-${memory.workspace}`;
  const session = await openMirrorSession({
    cwd: vault.journey("career"), client: memory.client,
    sessionManager: SessionManager.inMemory(vault.journey("career")),
    model: { kind: "scripted", responses: [reply("What draws you to teaching?")] },
  });
  const id = session.session.sessionManager.getSessionId();
  await session.session.prompt(`I keep thinking about teaching. Marker ${token}.`);
  await session.close();
  const own = await observations(memory.client, career, id);
  assert.ok(own.some((row) => row.kind === "user-prompt" && row.body.includes(token)));
  assert.deepEqual(await observations(memory.client, health, id), [], "the health project holds nothing from the career session");
  // Pinned pages are returned for any query, so check content rather than an empty result.
  const leaked = await memory.client.query(health, token, 10);
  assert.ok(leaked.ok);
  assert.ok(!JSON.stringify(leaked.value).includes(token));
});

// Outside a journey there is no marker. Mirror's extensions then make no AI Memory call. The AI Memory extension
// still captures, as personal Pi does in denylist mode, but into its default scope, never into a journey.
test("a session outside a journey directory reaches no journey's memory and cannot save records", async () => {
  const vault = await tempVault(memory.workspace);
  const seen: TranscriptContext[] = [];
  const calls: string[] = [];
  const recording = new MemoryClient(memory.url, undefined, (url) => {
    calls.push(url);
    return Promise.reject(new Error("no AI Memory call is expected"));
  });
  const session = await openMirrorSession({
    cwd: vault.root, client: recording,
    sessionManager: SessionManager.inMemory(vault.root),
    model: { kind: "scripted", responses: [
      callTool("mirror_save_journal", { title: "Loose", body: "Not in a journey." }),
      observe(seen, "I could not save it."),
    ] },
  });
  const id = session.session.sessionManager.getSessionId();
  await session.session.prompt("Save a journal entry: not in a journey.");
  await session.close();
  assert.match(messagesText(seen[0]), /not in a journey directory/);
  assert.deepEqual(calls, [], "Mirror's recall and records make no AI Memory call");
  assert.deepEqual(await observations(memory.client, health, id), [], "nothing is captured into the health journey");
  assert.deepEqual(await observations(memory.client, career, id), [], "nothing is captured into the career journey");
});

test("journal entries are saved in the journey directory and published to its project", async () => {
  const vault = await tempVault(memory.workspace);
  const cwd = vault.journey("health");
  const seen: TranscriptContext[] = [];
  const session = await openMirrorSession({
    cwd, client: memory.client,
    sessionManager: SessionManager.inMemory(cwd),
    model: { kind: "scripted", responses: [
      callTool("mirror_save_journal", { title: "Quiet evening", body: "No screens after nine. Slept at eleven." }),
      observe(seen, "Saved."),
    ] },
  });
  await session.session.prompt("Please save a journal entry: no screens after nine, slept at eleven.");
  await session.close();
  const files = await readdir(join(cwd, "journal"));
  assert.equal(files.length, 1);
  assert.match(await readFile(join(cwd, "journal", files[0] ?? ""), "utf8"), /No screens after nine/);
  const page = await memory.client.readPage(health, `journal/${files[0] ?? ""}`);
  assert.ok(page.ok);
  const transcript = messagesText(seen[0]);
  assert.match(transcript, /Saved journal to .*Published to AI Memory as journal\//);
});

test("an unreachable AI Memory degrades to an explicit notice and does not block the conversation", async () => {
  const vault = await tempVault(memory.workspace);
  const seen: TranscriptContext[] = [];
  const offline = new MemoryClient("http://127.0.0.1:9", undefined);
  const session = await openMirrorSession({
    cwd: vault.journey("health"), client: offline,
    sessionManager: SessionManager.inMemory(vault.journey("health")),
    model: { kind: "scripted", responses: [observe(seen, "I cannot read your memory right now.")] },
  });
  const started = Date.now();
  await session.session.prompt("What did we discuss last week?");
  await session.close();
  assert.match(messagesText(seen[0]), /AI Memory for journey \\"health\\" is unavailable \(network/);
  assert.ok(Date.now() - started < 15_000);
});
