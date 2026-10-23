// AI Memory consolidates each journey's sessions with a real model through the Pi model bridge.
// Needs: scripts/ai-memory.sh up --llm and scripts/model-bridge.sh start.
// The chat model is scripted; the consolidation model is real. This tests what later sessions can recall.
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { fauxAssistantMessage, type FauxResponseStep, type TranscriptContext } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { MemoryScope } from "../../src/memory-client.ts";
import { tempContent } from "../support/content.ts";
import { devMemory } from "../support/memory.ts";
import { openMirrorSession } from "../support/session.ts";

const memory = await devMemory();
const CONSOLIDATION_TIMEOUT_MS = 180_000;

async function converse(content: string, journey: string, prompts: readonly string[], responses?: FauxResponseStep[]): Promise<string> {
  const session = await openMirrorSession({
    contentDir: content, workspace: memory.workspace, journey, client: memory.client,
    sessionManager: SessionManager.inMemory(content),
    responses: responses ?? prompts.map(() => fauxAssistantMessage("I hear you.")),
  });
  const id = session.session.sessionManager.getSessionId();
  for (const prompt of prompts) await session.session.prompt(prompt);
  await session.close();
  return id;
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
  const content = await tempContent();
  const health: MemoryScope = { workspace: memory.workspace, project: "health" };
  const career: MemoryScope = { workspace: memory.workspace, project: "career" };
  const marker = `orchid-${memory.workspace}`;

  const first = await converse(content, "health", [
    "Since the late work calls started on Tuesdays, I sleep badly.",
    "Correction: the late work calls are on Wednesdays, not Tuesdays.",
  ]);
  const careerSession = await converse(content, "career", [`I keep thinking about teaching. Marker ${marker}.`]);
  const second = await converse(content, "health", ["I decided to stop drinking coffee after 2pm."]);

  const firstPage = await consolidatedPage(health, first);
  const secondPage = await consolidatedPage(health, second);
  const careerPage = await consolidatedPage(career, careerSession);
  assert.match(firstPage, /Wednesday/);
  assert.match(secondPage, /2\s?pm|14:00/i);
  assert.match(careerPage, /teach/i);
  assert.ok(!firstPage.includes(marker) && !secondPage.includes(marker), "career content does not reach health pages");

  const seen: TranscriptContext[] = [];
  await converse(content, "health", ["Which day are the late work calls, and what did I decide about coffee?"], [
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
