import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { parseMarkdown } from "../../src/markdown.ts";
import { recordCorrection, saveJournal, type RecordContext } from "../../src/records.ts";
import { tempVault } from "../support/content.ts";

const fixed = (): Date => new Date("2026-10-23T08:30:00Z");

async function context(): Promise<RecordContext> {
  const vault = await tempVault();
  return { journey: { dir: vault.journey("health"), slug: "health" }, sessionId: "s1", now: fixed };
}

test("a journal entry is written to the vault without overwriting an earlier entry", async () => {
  const ctx = await context();
  const first = await saveJournal(ctx, { title: "Noite difícil", body: "Dormi às 2h." });
  const second = await saveJournal(ctx, { title: "Noite difícil", body: "Outra noite." });
  assert.ok(first.ok && second.ok);
  const files = (await readdir(join(ctx.journey.dir, "journal"))).sort();
  assert.deepEqual(files, ["2026-10-23-noite-dificil-2.md", "2026-10-23-noite-dificil.md"]);
  const document = parseMarkdown(await readFile(join(ctx.journey.dir, "journal", files[1] ?? ""), "utf8"));
  assert.ok(document.ok);
  assert.equal(document.value.frontmatter.journey, "health");
  assert.equal(document.value.frontmatter.session, "s1");
  assert.equal(document.value.body, "# Noite difícil\n\nDormi às 2h.\n\n_Journal entry, 2026-10-23._");
  assert.match(await readFile(join(ctx.journey.dir, "journal", files[0] ?? ""), "utf8"), /Outra noite/);
});

test("a correction states what is true now before what was believed", async () => {
  const ctx = await context();
  const receipt = await recordCorrection(ctx, { topic: "Late calls", previous: "Tuesdays", corrected: "Wednesdays", note: "Moved by Priya." });
  assert.ok(receipt.ok);
  assert.equal(receipt.value.file, join(ctx.journey.dir, "corrections", "2026-10-23-late-calls.md"));
  const text = await readFile(receipt.value.file, "utf8");
  assert.match(text, /\*\*Now true:\*\* Wednesdays\n\n- \*\*Previously recorded:\*\* Tuesdays\n- \*\*Recorded:\*\* 2026-10-23T08:30:00.000Z\n\nMoved by Priya\./);
});

test("empty records are rejected before anything is written", async () => {
  const ctx = await context();
  assert.ok(!(await saveJournal(ctx, { title: " ", body: "x" })).ok);
  assert.ok(!(await recordCorrection(ctx, { topic: "t", previous: "", corrected: "c", note: undefined })).ok);
  await assert.rejects(readdir(join(ctx.journey.dir, "journal")));
  await assert.rejects(readdir(join(ctx.journey.dir, "corrections")));
});
