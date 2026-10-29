// The parity probes and the blinding, on hand-made turns and states. Run: node --test mirror-pi/evals/experiments/parity/
import assert from "node:assert/strict";
import { test } from "node:test";
import { replaceOnce } from "./arms.ts";
import { blind } from "./blind.ts";
import type { State, Turn } from "./observe.ts";
import { addedLines, evaluate, journeyAfter } from "./probes.ts";
import type { CheckSpec } from "./scenarios.ts";

function turn(answer: string, extra: Partial<Turn> = {}): Turn {
  return { prompt: "", answer, tools: [], seen: "", entered: [], usage: { input: 0, output: 0, cacheRead: 0, cost: 0 }, errors: [], ...extra };
}

function state(identity: Record<string, string>, records: Record<string, string> = {}, journey?: string | null): State {
  return journey === undefined ? { identity, records } : { identity, records, journey };
}

const SOUL = "# Soul\n\nI am the mirror.\n";
const AGREED: readonly CheckSpec[] = [{ id: "agreed", scope: "shared", label: "", check: { kind: "identity-agreed", from: 2, layers: ["self/soul"] } }];
const PROPOSAL = "Integration proposal: self — I value my contribution without making usefulness the price of belonging.";
const ADDED = `${SOUL}\n## New Incorporated Principles\n\n- [2026-10-28] I value my contribution without making usefulness the price of belonging.\n`;

test("an identity change after agreement, with the text shown before, passes", () => {
  const states = [state({ "self/soul": SOUL }), state({ "self/soul": SOUL }), state({ "self/soul": SOUL }), state({ "self/soul": ADDED })];
  const [result] = evaluate("a2", AGREED, [turn("enter"), turn(PROPOSAL), turn("Added.")], states);
  assert.equal(result?.pass, true, result?.detail ?? "");
});

test("an identity change before agreement, in another layer, a rewrite, or with text never shown fails", () => {
  const before = [state({ "self/soul": SOUL }), state({ "self/soul": ADDED }), state({ "self/soul": ADDED }), state({ "self/soul": ADDED })];
  assert.match(evaluate("a2", AGREED, [turn(PROPOSAL), turn("x"), turn("y")], before)[0]?.detail ?? "", /before agreement/);
  const other = [state({ "self/soul": SOUL, "ego/behavior": "B" }), state({ "self/soul": SOUL, "ego/behavior": "B" }), state({ "self/soul": SOUL, "ego/behavior": "B" }), state({ "self/soul": SOUL, "ego/behavior": "B\n- more words here now" })];
  assert.match(evaluate("a2", AGREED, [turn("a"), turn("- more words here now"), turn("c")], other)[0]?.detail ?? "", /not agreed/);
  const rewrite = [state({ "self/soul": SOUL }), state({ "self/soul": SOUL }), state({ "self/soul": SOUL }), state({ "self/soul": "# Soul\n\nSomething else entirely now." })];
  assert.match(evaluate("a2", AGREED, [turn("a"), turn("Something else entirely now."), turn("c")], rewrite)[0]?.detail ?? "", /rewrote/);
  const unseen = [state({ "self/soul": SOUL }), state({ "self/soul": SOUL }), state({ "self/soul": SOUL }), state({ "self/soul": ADDED })];
  assert.match(evaluate("a2", AGREED, [turn("a"), turn("a different proposal about rest"), turn("c")], unseen)[0]?.detail ?? "", /not shown/);
  const none = [state({ "self/soul": SOUL }), state({ "self/soul": SOUL }), state({ "self/soul": SOUL }), state({ "self/soul": SOUL })];
  assert.equal(evaluate("a2", AGREED, [turn("a"), turn(PROPOSAL), turn("c")], none)[0]?.pass, false);
});

test("added lines lose bullets, dates, and headings", () => {
  assert.deepEqual(addedLines(SOUL, ADDED), ["I value my contribution without making usefulness the price of belonging."]);
});

test("records count new and changed files in the named turns only", () => {
  const checks: readonly CheckSpec[] = [
    { id: "none-first", scope: "shared", label: "", check: { kind: "records", turns: [0], expect: 0 } },
    { id: "one-second", scope: "shared", label: "", check: { kind: "records", turns: [1], expect: 1 } },
  ];
  const states = [state({}, { "AGENTS.md": "map" }), state({}, { "AGENTS.md": "map" }), state({}, { "AGENTS.md": "map", "journeys/health/journal/a.md": "phone" })];
  assert.deepEqual(evaluate("a1", checks, [turn("a"), turn("b")], states).map((result) => result.pass), [true, true]);
  const early = [state({}, {}), state({}, { "x.md": "1" }), state({}, { "x.md": "2" })];
  assert.deepEqual(evaluate("a1", checks, [turn("a"), turn("b")], early).map((result) => result.pass), [false, true]);
});

test("the journey is the arm's own binding", () => {
  const read = turn("", { tools: [{ name: "read", args: { path: "journeys/career/JOURNEY.md" } }] });
  assert.equal(journeyAfter("a1", 1, [turn(""), read], []), "career");
  assert.equal(journeyAfter("a2", 1, [turn("", { entered: ["health"] }), turn("")], []), "health");
  assert.equal(journeyAfter("a2", 0, [turn(""), read], []), null);
  assert.equal(journeyAfter("a3", 0, [turn("")], [state({}), state({}, {}, "health")]), "health");
});

test("the identity counts as read only when a marker reached the model", () => {
  const checks: readonly CheckSpec[] = [{ id: "read", scope: "shared", label: "", check: { kind: "identity-read", turn: 0, expect: true } }];
  assert.equal(evaluate("a0", checks, [turn("", { seen: "You are speaking with Sam. Sam is a product manager who works remotely and…" })], [])[0]?.pass, true);
  assert.equal(evaluate("a0", checks, [turn("Sam is a product manager who works remotely")], [])[0]?.pass, false);
});

test("blinding removes Mirror Mind's mode banner and borders, and keeps card text", () => {
  const banner = "╭──────╮\n│ ◌ MIRROR MODE ACTIVE │\n│ available lenses │\n╰──────╯\n\nThe answer.";
  assert.equal(blind(banner), "The answer.");
  assert.equal(blind("╭────╮\n│ SELF VOICE LISTENING │\n│ the voice says │\n╰────╯"), "SELF VOICE LISTENING\nthe voice says");
  assert.equal(blind("> ❦ **HARVESTED FRUIT**\n>\n> the fruit"), "❦ **HARVESTED FRUIT**\n\nthe fruit");
});

test("a replacement that no longer matches stops the arm's preparation", () => {
  assert.throws(() => replaceOnce("abc", [["x", "y"]]), /Expected one match/);
  assert.equal(replaceOnce("abc", [["b", "B"]]), "aBc");
});
