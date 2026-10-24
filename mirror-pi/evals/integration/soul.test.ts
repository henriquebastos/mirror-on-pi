// Soul Mode wiring in real Pi sessions: skill discovery from a journey directory, and identity integration
// that writes only after the user confirms the exact text in a dialog. The model is scripted.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, type FauxResponseStep, type TranscriptContext } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { tempVault } from "../support/content.ts";
import { devMemory } from "../support/memory.ts";
import { openMirrorSession } from "../support/session.ts";

const memory = await devMemory();
const fixed = (): Date => new Date("2026-10-24T08:30:00Z");
const TEXT = "I care for bonds without turning immediate availability into proof of love.";

function integrate(seen: TranscriptContext[]): FauxResponseStep[] {
  return [
    fauxAssistantMessage(fauxToolCall("mirror_integrate_identity", { layer: "self", text: TEXT }), { stopReason: "toolUse" }),
    (context) => {
      seen.push(context);
      return fauxAssistantMessage("Done.");
    },
  ];
}

async function integrationRun(confirm: ((title: string, message: string) => Promise<boolean>) | undefined): Promise<{ before: string; after: string; transcript: string }> {
  const vault = await tempVault(memory.workspace);
  const cwd = vault.journey("health");
  const file = join(vault.root, "identity/self/soul.md");
  const before = await readFile(file, "utf8");
  const seen: TranscriptContext[] = [];
  const session = await openMirrorSession({
    cwd, client: memory.client, now: fixed, sessionManager: SessionManager.inMemory(cwd),
    model: { kind: "scripted", responses: integrate(seen) },
    ...(confirm === undefined ? {} : { confirm }),
  });
  await session.session.prompt("Yes, record it exactly this way in my identity.");
  await session.close();
  return { before, after: await readFile(file, "utf8"), transcript: JSON.stringify(seen[0]?.messages ?? []) };
}

test("Pi offers the vault's soul skill in a journey session", async () => {
  const vault = await tempVault(memory.workspace);
  const cwd = vault.journey("career");
  const session = await openMirrorSession({
    cwd, client: memory.client, sessionManager: SessionManager.inMemory(cwd),
    model: { kind: "scripted", responses: [fauxAssistantMessage("ok")] },
  });
  const system = session.session.systemPrompt;
  await session.close();
  assert.match(system, /<name>soul<\/name>/);
  assert.match(system, new RegExp(`${vault.root}/\\.agents/skills/soul/SKILL\\.md`));
  assert.match(system, /mirror_integrate_identity/);
});

test("a confirmed integration is appended to the identity file with the exact text the user saw", async () => {
  const dialogs: string[] = [];
  const run = await integrationRun((_title, message) => {
    dialogs.push(message);
    return Promise.resolve(true);
  });
  const bullet = `- [2026-10-24] ${TEXT}`;
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0] ?? "", /identity\/self\/soul\.md, under "## New Incorporated Principles"/);
  assert.ok((dialogs[0] ?? "").includes(bullet), "the dialog shows the exact bullet");
  assert.equal(run.after, `${run.before.replace(/\n+$/, "")}\n\n## New Incorporated Principles\n\n${bullet}\n`);
  assert.match(run.transcript, /Added to identity\/self\/soul\.md/);
});

test("a declined dialog writes nothing and says so", async () => {
  const run = await integrationRun(() => Promise.resolve(false));
  assert.equal(run.after, run.before);
  assert.match(run.transcript, /The user did not confirm\. Nothing was written\./);
});

test("without an interactive user, an integration is refused and nothing is written", async () => {
  const run = await integrationRun(undefined);
  assert.equal(run.after, run.before);
  assert.match(run.transcript, /need the user's confirmation in an interactive session/);
});
