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
import { tempContent } from "../support/content.ts";
import { devMemory, observations } from "../support/memory.ts";
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
  const content = await tempContent();
  const dir = await sessionsDir();
  const first = await openMirrorSession({
    contentDir: content, workspace: memory.workspace, journey: "health", client: memory.client,
    sessionManager: SessionManager.create(content, dir),
    responses: [
      reply("Tell me more about those Tuesday calls."),
      callTool("mirror_record_correction", { topic: "Late work calls day", previous: "The late work calls are on Tuesdays", corrected: "The late work calls are on Wednesdays" }),
      reply("Recorded: Wednesdays, not Tuesdays."),
    ],
  });
  const firstId = first.session.sessionManager.getSessionId();
  await first.session.prompt("I sleep badly since the late work calls started on Tuesdays.");
  await first.session.prompt("Correction: the late work calls are on Wednesdays, not Tuesdays.");
  await first.close();

  const corrections = await readdir(join(content, "journeys/health/corrections"));
  assert.equal(corrections.length, 1);
  const page = await memory.client.readPage(health, `corrections/${corrections[0] ?? ""}`);
  assert.ok(page.ok, page.ok ? "" : page.error.message);
  assert.match(page.value.body, /Now true:\*\* The late work calls are on Wednesdays/);

  const firstObservations = await observations(memory.client, health, firstId);
  const prompts = firstObservations.filter((row) => row.kind === "user-prompt").map((row) => row.body);
  assert.deepEqual(prompts, [
    "I sleep badly since the late work calls started on Tuesdays.",
    "Correction: the late work calls are on Wednesdays, not Tuesdays.",
  ]);
  assert.ok(firstObservations.some((row) => row.kind === "session-end"), "session end is captured");

  const seen: TranscriptContext[] = [];
  const second = await openMirrorSession({
    contentDir: content, workspace: memory.workspace, journey: "health", client: memory.client,
    sessionManager: SessionManager.create(content, dir),
    responses: [observe(seen, "Your calls are on Wednesdays.")],
  });
  assert.notEqual(second.session.sessionManager.getSessionId(), firstId);
  await second.session.prompt("Which day are the late work calls?");
  await second.close();
  const context = messagesText(seen[0]);
  assert.match(context, /Recalled memory for journey \\"Health\\"/);
  assert.match(context, /corrections\/[0-9-]+late-work-calls-day\.md/);
  assert.match(context, /Wednesdays/);
  assert.match(JSON.stringify(seen[0]?.messages[0] ?? {}), /mirror_identity/, "identity is part of the system prompt");
});

test("a session of another journey captures into its own project only", async () => {
  const content = await tempContent();
  const token = `zephyr-${memory.workspace}`;
  const session = await openMirrorSession({
    contentDir: content, workspace: memory.workspace, journey: "career", client: memory.client,
    sessionManager: SessionManager.inMemory(content),
    responses: [reply("What draws you to teaching?")],
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

test("a session bound to one journey cannot be resumed under another journey", async () => {
  const content = await tempContent();
  const dir = await sessionsDir();
  const original = await openMirrorSession({
    contentDir: content, workspace: memory.workspace, journey: "health", client: memory.client,
    sessionManager: SessionManager.create(content, dir),
    responses: [reply("Noted.")],
  });
  await original.session.prompt("Evening walks help.");
  const file = original.session.sessionManager.getSessionFile();
  const id = original.session.sessionManager.getSessionId();
  await original.close();
  assert.ok(file !== undefined);

  const seen: TranscriptContext[] = [];
  const wrong = await openMirrorSession({
    contentDir: content, workspace: memory.workspace, journey: "career", client: memory.client,
    sessionManager: SessionManager.open(file, dir),
    responses: [observe(seen, "should not run")],
  });
  await wrong.session.prompt("Now about my career.");
  await wrong.close();
  assert.equal(seen.length, 0, "the model is not called");
  assert.deepEqual(await observations(memory.client, career, id), [], "nothing is captured into the other journey");
  const healthRows = await observations(memory.client, health, id);
  assert.ok(!healthRows.some((row) => row.body.includes("Now about my career")), "the refused prompt is not captured");
});

test("journal entries are saved to the vault and published; file tools stay inside the vault", async () => {
  const content = await tempContent();
  const seen: TranscriptContext[] = [];
  const session = await openMirrorSession({
    contentDir: content, workspace: memory.workspace, journey: "health", client: memory.client,
    sessionManager: SessionManager.inMemory(content),
    responses: [
      callTool("mirror_save_journal", { title: "Quiet evening", body: "No screens after nine. Slept at eleven." }),
      callTool("read", { path: "../../../../etc/hosts" }),
      callTool("read", { path: "journeys/health/journey.md" }),
      observe(seen, "Saved."),
    ],
  });
  await session.session.prompt("Please save a journal entry: no screens after nine, slept at eleven.");
  await session.close();
  const files = await readdir(join(content, "journeys/health/journal"));
  assert.equal(files.length, 1);
  assert.match(await readFile(join(content, "journeys/health/journal", files[0] ?? ""), "utf8"), /No screens after nine/);
  const page = await memory.client.readPage(health, `journal/${files[0] ?? ""}`);
  assert.ok(page.ok);
  const transcript = messagesText(seen[0]);
  assert.match(transcript, /Saved journal to .*Published to AI Memory as journal\//);
  assert.match(transcript, /Path outside the content vault/);
  assert.match(transcript, /Sam wants to sleep better/, "reading inside the vault works");
});

test("an unreachable AI Memory degrades to an explicit notice and does not block the conversation", async () => {
  const content = await tempContent();
  const seen: TranscriptContext[] = [];
  const offline = new MemoryClient("http://127.0.0.1:9", undefined);
  const session = await openMirrorSession({
    contentDir: content, workspace: memory.workspace, journey: "health", client: offline,
    sessionManager: SessionManager.inMemory(content),
    responses: [observe(seen, "I cannot read your memory right now.")],
  });
  const started = Date.now();
  await session.session.prompt("What did we discuss last week?");
  await session.close();
  assert.match(messagesText(seen[0]), /AI Memory for journey \\"Health\\" is unavailable \(network/);
  assert.ok(Date.now() - started < 15_000);
});
