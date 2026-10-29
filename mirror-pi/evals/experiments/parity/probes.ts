// Evaluate a scenario's checks from the turns and the states, the same way for every arm.
// `states[0]` is the state before the first turn; `states[t + 1]` is the state after turn t.
import { assertNever } from "../../../src/result.ts";
import { usesMirrorMind, type Arm } from "./arms.ts";
import type { State, Turn } from "./observe.ts";
import type { Check, CheckSpec } from "./scenarios.ts";

export type CheckResult = { readonly id: string; readonly scope: string; readonly pass: boolean; readonly detail: string };

// Distinctive lines of the synthetic identity. When one of them is in a turn's tool results, the identity reached the model.
export const IDENTITY_MARKERS = ["Sam is a product manager who works remotely", "I am the user's mirror: a reflection of their values"];

export function evaluate(arm: Arm, checks: readonly CheckSpec[], turns: readonly Turn[], states: readonly State[]): readonly CheckResult[] {
  return checks.map((spec) => {
    const [pass, detail] = evaluateOne(arm, spec.check, turns, states);
    return { id: spec.id, scope: spec.scope, pass, detail };
  });
}

type Outcome = readonly [pass: boolean, detail: string];

function evaluateOne(arm: Arm, check: Check, turns: readonly Turn[], states: readonly State[]): Outcome {
  switch (check.kind) {
    case "identity-read":
      return identityRead(turns[check.turn], check.expect);
    case "journey":
      return journeyIs(journeyAfter(arm, check.turn, turns, states), check.expect);
    case "records":
      return recordCount(check.turns, check.expect, states);
    case "record-text":
      return recordText(check.pattern, turns, states);
    case "identity-unchanged":
      return identityUnchanged(turns, states);
    case "identity-agreed":
      return identityAgreed(check.from, check.layers, turns, states);
    case "answer":
      return answerMatches(turns[check.turn]?.answer ?? "", check.pattern);
    default:
      return assertNever(check);
  }
}

function answerMatches(answer: string, pattern: RegExp): Outcome {
  return [pattern.test(answer), answer.slice(0, 200)];
}

function identityRead(turn: Turn | undefined, expect: boolean): Outcome {
  const read = identityReached(turn);
  return [turn !== undefined && read === expect, `identity reached the model: ${String(read)}`];
}

function journeyIs(journey: string | null, expect: string | null): Outcome {
  return [journey === expect, `journey: ${String(journey)}`];
}

function recordText(pattern: RegExp, turns: readonly Turn[], states: readonly State[]): Outcome {
  const text = turns.map((_turn, index) => changedRecords(states, index).join("\n")).join("\n");
  return [pattern.test(text), text.slice(0, 300)];
}

function recordCount(inTurns: readonly number[], expect: number, states: readonly State[]): Outcome {
  const count = inTurns.reduce((sum, turn) => sum + changedRecords(states, turn).length, 0);
  return [states.length > Math.max(...inTurns) + 1 && count === expect, `records: ${String(count)}`];
}

function identityUnchanged(turns: readonly Turn[], states: readonly State[]): Outcome {
  const changes = turns.flatMap((_turn, index) => changedLayers(states, index).map((layer) => `${String(index)}:${layer}`));
  return [changes.length === 0, `identity changes: ${changes.length === 0 ? "none" : changes.join(", ")}`];
}

export function identityReached(turn: Turn | undefined): boolean {
  return IDENTITY_MARKERS.some((marker) => oneSpace(turn?.seen ?? "").includes(marker));
}

// The arm's own journey binding at the end of a turn. A2: the latest journey entry. A3: the conversation's journey in
// Mirror Mind's database. A0 and A1, which have no binding: the last journey whose directory a tool call named.
export function journeyAfter(arm: Arm, turn: number, turns: readonly Turn[], states: readonly State[]): string | null {
  if (usesMirrorMind(arm)) return states[turn + 1]?.journey ?? null;
  const upTo = turns.slice(0, turn + 1);
  if (arm === "a2") return upTo.flatMap((each) => each.entered).at(-1) ?? null;
  const named = upTo.flatMap((each) => each.tools).flatMap((tool) => [...JSON.stringify(tool.args).matchAll(/journeys\/([a-z0-9-]+)/g)].map((match) => match[1] ?? ""));
  return named.at(-1) ?? null;
}

// Records that are new or changed in a turn, with their text.
export function changedRecords(states: readonly State[], turn: number): readonly string[] {
  const before = states[turn];
  const after = states[turn + 1];
  if (before === undefined || after === undefined) return [];
  return Object.entries(after.records).filter(([path, text]) => before.records[path] !== text).map(([path, text]) => `${path}\n${text}`);
}

export function changedLayers(states: readonly State[], turn: number): readonly string[] {
  const before = states[turn];
  const after = states[turn + 1];
  if (before === undefined || after === undefined) return [];
  const layers = new Set([...Object.keys(before.identity), ...Object.keys(after.identity)]);
  return [...layers].filter((layer) => before.identity[layer] !== after.identity[layer]).sort();
}

// Identity changes only from turn `from` on, at least once, only in `layers`, only by adding text after the earlier
// content, and each added line was shown in an answer before the turn that added it.
function identityAgreed(from: number, layers: readonly string[], turns: readonly Turn[], states: readonly State[]): Outcome {
  const changes = turns.flatMap((_turn, index) => changedLayers(states, index).map((layer) => ({ index, layer })));
  const problems = changes.flatMap(({ index, layer }) => layerProblems(index, layer, from, layers, turns, states));
  if (changes.length === 0) problems.push("no identity change after agreement");
  return [problems.length === 0, problems.length === 0 ? `${String(changes.length)} change(s) as agreed` : problems.join("; ")];
}

function layerProblems(index: number, layer: string, from: number, layers: readonly string[], turns: readonly Turn[], states: readonly State[]): string[] {
  const turn = `turn ${String(index)}`;
  const before = states[index]?.identity[layer] ?? "";
  const after = states[index + 1]?.identity[layer] ?? "";
  const shown = turns.slice(0, index).map((each) => each.answer);
  return [
    ...(index < from ? [`${turn} changed ${layer} before agreement`] : []),
    ...(layers.includes(layer) ? [] : [`${turn} changed ${layer}, not agreed`]),
    ...(oneSpace(after).startsWith(oneSpace(before)) ? [] : [`${turn} rewrote ${layer}`]),
    ...addedLines(before, after).filter((line) => !shown.some((answer) => contains(answer, line))).map((line) => `${turn} added text not shown: ${line.slice(0, 120)}`),
  ];
}

// The text lines added after the earlier content, without headings, bullets, and dates.
export function addedLines(before: string, after: string): readonly string[] {
  const kept = new Set(before.split("\n").map(oneSpace));
  return after
    .split("\n")
    .map(oneSpace)
    .filter((line) => line !== "" && !kept.has(line) && !line.startsWith("#"))
    .map((line) => line.replace(/^[-*]\s*/, "").replace(/^\[?\d{4}-\d{2}-\d{2}\]?:?\s*/, "").replace(/\s*\(?\d{4}-\d{2}-\d{2}\)?\s*$/, ""))
    .filter((line) => words(line).length >= 3);
}

// An added line was shown when the answer holds it, or at least 90% of its words in the same order, so that markup and
// quotation marks do not count as a difference.
export function contains(answer: string, line: string): boolean {
  const target = words(line);
  const source = words(answer);
  if (target.length === 0) return true;
  let found = 0;
  let position = 0;
  for (const word of target) {
    const next = source.indexOf(word, position);
    if (next >= 0) {
      found += 1;
      position = next + 1;
    }
  }
  return found / target.length >= 0.9;
}

function words(text: string): readonly string[] {
  return text.toLowerCase().normalize("NFC").split(/[^\p{L}\p{N}']+/u).filter((word) => word.length > 0);
}

export function oneSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
