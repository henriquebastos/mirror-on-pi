// Soul Mode wiring in real Pi sessions: skill discovery at the vault root, and identity integration
// that writes the exact text with no UI, as in `pi -p`. The user's agreement is their message. The model is scripted.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, type FauxResponseStep, type TranscriptContext } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { REPO, tempVault } from "../support/content.ts";
import { openMirrorSession } from "../support/session.ts";

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

async function integrationRun(): Promise<{ before: string; after: string; transcript: string }> {
  const vault = await tempVault();
  const cwd = vault.root;
  const file = join(vault.root, "identity/self/soul.md");
  const before = await readFile(file, "utf8");
  const seen: TranscriptContext[] = [];
  const session = await openMirrorSession({
    cwd, now: fixed, sessionManager: SessionManager.inMemory(cwd),
    model: { kind: "scripted", responses: integrate(seen) },
  });
  await session.session.prompt("Yes, record it exactly this way in my identity.");
  await session.close();
  return { before, after: await readFile(file, "utf8"), transcript: JSON.stringify(seen[0]?.messages ?? []) };
}

test("Pi offers the soul skill from the Mirror package in a session at the vault root", async () => {
  const vault = await tempVault();
  const cwd = vault.root;
  const session = await openMirrorSession({
    cwd, sessionManager: SessionManager.inMemory(cwd),
    model: { kind: "scripted", responses: [fauxAssistantMessage("ok")] },
  });
  const system = session.session.systemPrompt;
  const tools = session.session.getActiveToolNames();
  await session.close();
  assert.match(system, /<name>soul<\/name>/);
  assert.match(system, new RegExp(`${REPO}mirror-pi/skills/soul/SKILL\\.md`));
  assert.ok(tools.includes("mirror_integrate_identity"), "the model is offered the integration tool");
});

test("an integration is appended to the identity file with the exact text, without any dialog", async () => {
  const run = await integrationRun();
  const bullet = `- [2026-10-24] ${TEXT}`;
  assert.equal(run.after, `${run.before.replace(/\n+$/, "")}\n\n## New Incorporated Principles\n\n${bullet}\n`);
  assert.match(run.transcript, /Added to identity\/self\/soul\.md under \\"## New Incorporated Principles\\"/);
});
