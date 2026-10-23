// AI Memory consolidates each journey's sessions with a real model through the Pi model bridge.
// Needs: scripts/ai-memory.sh up --llm and scripts/model-bridge.sh start.
// The chat model is scripted; the consolidation model is real. This tests what later sessions can recall.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { fauxAssistantMessage, type FauxResponseStep, type TranscriptContext } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { MemoryScope } from "../../src/memory-client.ts";
import { tempVault, type EvalVault } from "../support/content.ts";
import { devMemory } from "../support/memory.ts";
import { openMirrorSession } from "../support/session.ts";

const memory = await devMemory();
const CONSOLIDATION_TIMEOUT_MS = 180_000;
const BRIDGE_PORT = "49391";

async function converse(vault: EvalVault, journey: string, prompts: readonly string[], responses?: FauxResponseStep[]): Promise<string> {
  const cwd = vault.journey(journey);
  const session = await openMirrorSession({
    cwd, client: memory.client,
    sessionManager: SessionManager.inMemory(cwd),
    model: { kind: "scripted", responses: responses ?? prompts.map(() => fauxAssistantMessage("I hear you.")) },
  });
  const id = session.session.sessionManager.getSessionId();
  for (const prompt of prompts) await session.session.prompt(prompt);
  await session.close();
  return id;
}

// One question to the consolidation model through the local bridge.
async function askBridge(question: string): Promise<string> {
  const env = await readFile(fileURLToPath(new URL("../../../dev/ai-memory/.env", import.meta.url)), "utf8");
  const token = /^MIRROR_BRIDGE_TOKEN=(\S+)$/m.exec(env)?.[1] ?? "";
  const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "pi-bridge", max_tokens: 20, messages: [{ role: "user", content: question }] }),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return /"content":"([^"]*)"/.exec(text)?.[1] ?? text;
}

async function consolidatedPage(scope: MemoryScope, sessionId: string): Promise<string> {
  const deadline = Date.now() + CONSOLIDATION_TIMEOUT_MS;
  for (;;) {
    const page = await memory.client.readPage(scope, `sessions/${sessionId}.md`);
    // AI Memory marks LLM-written session pages with `consolidated: true`; rule-based summaries lack it.
    if (page.ok && page.value.frontmatter.consolidated === true) return page.value.body;
    if (Date.now() > deadline) throw new Error(`Session ${sessionId} was not consolidated by the LLM within ${String(CONSOLIDATION_TIMEOUT_MS / 1000)}s`);
    await sleep(3_000);
  }
}

test("consolidated journey memory keeps corrections and decisions and stays within its journey", { timeout: 600_000 }, async () => {
  const vault = await tempVault(memory.workspace);
  const health: MemoryScope = { workspace: memory.workspace, project: "health" };
  const career: MemoryScope = { workspace: memory.workspace, project: "career" };
  const marker = `orchid-${memory.workspace}`;

  const first = await converse(vault, "health", [
    "Since the late work calls started on Tuesdays, I sleep badly.",
    "Correction: the late work calls are on Wednesdays, not Tuesdays.",
  ]);
  const careerSession = await converse(vault, "career", [`I keep thinking about teaching. Marker ${marker}.`]);
  const second = await converse(vault, "health", ["I decided to stop drinking coffee after 2pm."]);

  const firstPage = await consolidatedPage(health, first);
  const secondPage = await consolidatedPage(health, second);
  const careerPage = await consolidatedPage(career, careerSession);
  assert.match(firstPage, /Wednesday/);
  // The page may quote the first prompt ("Tuesdays") as history. A grader reads the page and names the current day.
  assert.match(await askBridge(`Read this note and answer with one weekday only: on which day are the late work calls currently?\n\n${firstPage}`), /^\W*Wednesday/i);
  assert.match(secondPage, /2\s?pm|14:00/i);
  assert.match(careerPage, /teach/i);
  assert.ok(!firstPage.includes(marker) && !secondPage.includes(marker), "career content does not reach health pages");

  const seen: TranscriptContext[] = [];
  await converse(vault, "health", ["Which day are the late work calls, and what did I decide about coffee?"], [
    (context) => {
      seen.push(context);
      return fauxAssistantMessage("ok");
    },
  ]);
  const recalled = JSON.stringify(seen[0]?.messages ?? []);
  assert.match(recalled, /Recalled memory for journey/);
  assert.match(recalled, /Wednesday/);
  assert.match(recalled, /coffee/i);
  assert.ok(!recalled.includes(marker));
});
