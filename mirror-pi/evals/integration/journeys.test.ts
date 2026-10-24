// Multi-session journey behavior with real Pi sessions, real session files, and real files in a temporary vault.
// The model is scripted, so these evals test wiring, not reflective quality.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { tempVault, type EvalVault } from "../support/content.ts";
import { openMirrorSession, type EvalModel } from "../support/session.ts";

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

// The session search command exactly as the vault's AGENTS.md gives it to the model, with the search terms filled in.
async function searchCommand(vault: EvalVault, terms: string): Promise<string> {
  const agents = await readFile(join(vault.root, "AGENTS.md"), "utf8");
  const block = /```sh\n((?: {2}.*\n)+?) {2}```/.exec(agents)?.[1];
  if (block === undefined) throw new Error("The vault's AGENTS.md has no session search command");
  const command = block.split("\n").map((line) => line.slice(2)).join("\n").trim();
  assert.ok(command.includes("'term|other term'"), "the command ends with a search for example terms");
  return command.replace("'term|other term'", `'${terms}'`);
}

// Run prompts in a new persisted session, stored where Pi stores a manual session in this directory.
async function converse(cwd: string, prompts: readonly string[], responses: readonly FauxResponseStep[]): Promise<void> {
  const model: EvalModel = { kind: "scripted", responses };
  const session = await openMirrorSession({ cwd, model, sessionManager: SessionManager.create(cwd) });
  for (const prompt of prompts) await session.session.prompt(prompt);
  await session.close();
}

test("a later session finds the earlier conversation of its journey, including the mirror's replies, with the vault's search command", async () => {
  const vault = await tempVault();
  const health = vault.journey("health");
  // The model reads a file that also mentions Sam, so the search must leave out tool output to pass.
  await converse(health, ["Sam here. I stay up late whenever I feel behind at work."], [
    callTool("read", { path: "../../identity/user/identity.md" }),
    reply("I would call that pattern Borrowed Freedom."),
  ]);
  await converse(vault.journey("career"), ["Sam again. Career only: I am thinking about teaching."], [reply("Teaching is a career-only thread, Borrowed Freedom aside.")]);

  const seen: TranscriptContext[] = [];
  await converse(health, ["What name did you give that pattern?"], [
    callTool("bash", { command: await searchCommand(vault, "borrowed freedom|sam") }),
    observe(seen, "Borrowed Freedom."),
  ]);
  const found = lastToolResult(seen[0]);
  const lines = found.trim().split("\n");
  assert.ok(lines.some((line) => line.endsWith(" user: Sam here. I stay up late whenever I feel behind at work.")), `finds the user's words:\n${found}`);
  assert.ok(lines.some((line) => line.endsWith(" assistant: I would call that pattern Borrowed Freedom.")), `finds the mirror's reply:\n${found}`);
  for (const line of lines) assert.match(line, /^\S+\.jsonl (user|assistant): /, "only conversation text, no tool output or system prompt");
  assert.doesNotMatch(found, /Career only|career-only/, "nothing from another journey");
});

test("Pi loads Mirror's instructions and the journey context from the vault's AGENTS.md files", async () => {
  const vault = await tempVault();
  const session = await openMirrorSession({
    cwd: vault.journey("career"),
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

test("journal entries and corrections are saved as files in the journey directory", async () => {
  const vault = await tempVault();
  const cwd = vault.journey("health");
  const seen: TranscriptContext[] = [];
  const session = await openMirrorSession({
    cwd, sessionManager: SessionManager.inMemory(cwd),
    model: { kind: "scripted", responses: [
      callTool("mirror_save_journal", { title: "Quiet evening", body: "No screens after nine. Slept at eleven." }),
      callTool("mirror_record_correction", { topic: "Late work calls day", previous: "The late work calls are on Tuesdays", corrected: "The late work calls are on Wednesdays" }),
      observe(seen, "Saved both."),
    ] },
  });
  await session.session.prompt("Save a journal entry: no screens after nine, slept at eleven. And the calls are on Wednesdays, not Tuesdays.");
  await session.close();
  const journal = await readdir(join(cwd, "journal"));
  const corrections = await readdir(join(cwd, "corrections"));
  assert.equal(journal.length, 1);
  assert.equal(corrections.length, 1);
  assert.match(await readFile(join(cwd, "journal", journal[0] ?? ""), "utf8"), /No screens after nine/);
  assert.match(await readFile(join(cwd, "corrections", corrections[0] ?? ""), "utf8"), /\*\*Now true:\*\* The late work calls are on Wednesdays/);
  assert.match(messagesText(seen[0]), /Saved journal to .*journal\/.*Saved correction to .*corrections\//);
});

test("a session outside a journey directory cannot save records", async () => {
  const vault = await tempVault();
  const seen: TranscriptContext[] = [];
  const session = await openMirrorSession({
    cwd: vault.root, sessionManager: SessionManager.inMemory(vault.root),
    model: { kind: "scripted", responses: [
      callTool("mirror_save_journal", { title: "Loose", body: "Not in a journey." }),
      observe(seen, "I could not save it."),
    ] },
  });
  await session.session.prompt("Save a journal entry: not in a journey.");
  await session.close();
  assert.match(messagesText(seen[0]), /not in a journey directory/);
  await assert.rejects(readdir(join(vault.root, "journal")));
});
