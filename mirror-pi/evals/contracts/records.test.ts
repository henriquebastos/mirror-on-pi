import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { parseMarkdown } from "../../src/markdown.ts";
import { MemoryClient } from "../../src/memory-client.ts";
import { recordCorrection, saveJournal, type RecordContext } from "../../src/records.ts";
import { tempContent } from "../support/content.ts";

const fixed = (): Date => new Date("2026-10-23T08:30:00Z");

function memory(fail: boolean): { client: MemoryClient; writes: unknown[] } {
  const writes: unknown[] = [];
  const client = new MemoryClient("http://memory.test", undefined, (_url, init) => {
    const body: unknown = JSON.parse(typeof init.body === "string" ? init.body : "null");
    writes.push(body);
    if (fail) return Promise.reject(new Error("offline"));
    return Promise.resolve(Response.json({ result: { content: [{ type: "text", text: JSON.stringify({ page_id: "p1", path: "journal/x.md" }) }] } }));
  });
  return { client, writes };
}

async function context(): Promise<RecordContext> {
  return { contentDir: await tempContent(), journey: "health", scope: { workspace: "mirror", project: "health" }, sessionId: "s1", now: fixed };
}

test("a journal entry is written to the vault without overwriting an earlier entry, then published", async () => {
  const ctx = await context();
  const { client, writes } = memory(false);
  const first = await saveJournal(client, ctx, { title: "Noite difícil", body: "Dormi às 2h." });
  const second = await saveJournal(client, ctx, { title: "Noite difícil", body: "Outra noite." });
  assert.ok(first.ok && second.ok);
  const files = (await readdir(join(ctx.contentDir, "journeys/health/journal"))).sort();
  assert.deepEqual(files, ["2026-10-23-noite-dificil-2.md", "2026-10-23-noite-dificil.md"]);
  const document = parseMarkdown(await readFile(join(ctx.contentDir, "journeys/health/journal", files[1] ?? ""), "utf8"));
  assert.ok(document.ok);
  assert.equal(document.value.frontmatter.journey, "health");
  assert.equal(document.value.body, "# Noite difícil\n\nDormi às 2h.\n\n_Journal entry, 2026-10-23._");
  assert.doesNotMatch(JSON.stringify(writes[0]), /type: journal/, "vault frontmatter is not published as page text");
  assert.equal(writes.length, 2);
  assert.match(JSON.stringify(writes[0]), /"create_only":true/);
  assert.match(JSON.stringify(writes[0]), /"path":"journal\/2026-10-23-noite-dificil.md"/);
});

test("a correction is pinned semantic memory and keeps the vault file when publishing fails", async () => {
  const ctx = await context();
  const { client } = memory(true);
  const receipt = await recordCorrection(client, ctx, { topic: "Late calls", previous: "Tuesdays", corrected: "Wednesdays", note: undefined });
  assert.ok(receipt.ok);
  assert.equal(receipt.value.memory.ok, false);
  const text = await readFile(receipt.value.file, "utf8");
  assert.match(text, /\*\*Now true:\*\* Wednesdays\n\n- \*\*Previously recorded:\*\* Tuesdays/);
});

test("empty records are rejected before anything is written", async () => {
  const ctx = await context();
  const { client, writes } = memory(false);
  assert.ok(!(await saveJournal(client, ctx, { title: " ", body: "x" })).ok);
  assert.ok(!(await recordCorrection(client, ctx, { topic: "t", previous: "", corrected: "c", note: undefined })).ok);
  assert.equal(writes.length, 0);
});
