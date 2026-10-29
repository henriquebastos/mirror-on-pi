// The capability gate's comparison, on synthetic runs: it passes a run equal to its baseline, fails a run that lost
// capability, and refuses a baseline of another fixture.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { tempDir } from "../../support/content.ts";
import { compare, writeBaseline } from "./gate.ts";
import { SCENARIOS } from "./scenarios.ts";

const MODEL = "test/model";
const IDS = SCENARIOS.filter((scenario) => scenario.question === undefined).map((scenario) => scenario.id);
const RECALL = SCENARIOS.filter((scenario) => scenario.question !== undefined).map((scenario) => scenario.id);

// A run of every scenario, three repetitions each, as the gate runs them: `pass` decides each shared check, and every
// recall answer is graded correct.
async function run(pass: (scenario: string, rep: number) => boolean): Promise<string> {
  const out = await tempDir();
  const lines = IDS.flatMap((scenario) => [1, 2, 3].map((rep) => JSON.stringify({ arm: "a2", model: MODEL, scenario, rep, status: "ok", checks: [{ id: "c", scope: "shared", pass: pass(scenario, rep) }, { id: "d", scope: "shared", pass: true }] })));
  const recall = RECALL.flatMap((scenario) => [1, 2, 3].map((rep) => JSON.stringify({ arm: "a2", model: MODEL, scenario, rep, status: "ok", checks: [] })));
  const grades = RECALL.flatMap((scenario) => [1, 2, 3].map((rep) => JSON.stringify({ cell: `a2|${MODEL}|${scenario}|${String(rep)}`, grader: "g", kind: "recall", verdict: "correct" })));
  await writeFile(join(out, "results.jsonl"), `${[...lines, ...recall].join("\n")}\n`);
  await writeFile(join(out, "grades.jsonl"), `${grades.join("\n")}\n`);
  return out;
}

async function baselineOf(out: string): Promise<string> {
  const path = join(await tempDir(), "capability.json");
  await writeBaseline(out, "test", path);
  return path;
}

test("a run equal to its baseline passes", async () => {
  const out = await run(() => true);
  const result = await compare(out, [MODEL], await baselineOf(out));
  assert.equal(result.pass, true, result.text);
});

test("a run that lost a check everywhere fails, on the score and on the check", async () => {
  const baseline = await baselineOf(await run(() => true));
  const result = await compare(await run(() => false), [MODEL], baseline);
  assert.equal(result.pass, false);
  assert.match(result.text, /lower bound -\d+ points/);
  assert.match(result.text, new RegExp(`check ${IDS[0] ?? ""}/c passed 3/3 in the baseline and fails in every run now`));
});

test("one failed run in one scenario stays inside the margin", async () => {
  const baseline = await baselineOf(await run(() => true));
  const result = await compare(await run((scenario, rep) => scenario !== IDS[0] || rep !== 1), [MODEL], baseline);
  assert.equal(result.pass, true, result.text);
});

test("a baseline of another fixture is refused", async () => {
  const out = await run(() => true);
  const path = await baselineOf(out);
  const baseline: unknown = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...(typeof baseline === "object" ? baseline : {}), fixture: "other" }));
  const result = await compare(out, [MODEL], path);
  assert.equal(result.pass, false);
  assert.match(result.text, /refused/);
});
