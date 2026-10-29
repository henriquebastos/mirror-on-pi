// The score of a parity cell, shared by the report and the capability gate.
// A cell's shared score is the mean of its shared checks and its shared criteria (the graders averaged), or for a recall
// question its verdict (correct 1, partial 0.5, wrong 0, the graders averaged).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord, numberField, stringField, type JsonRecord } from "../../../src/json.ts";
import { jsonLine, recordList } from "./jsonl.ts";
import { keyOf } from "./keys.ts";
import { SCENARIOS } from "./scenarios.ts";

export type Cell = { readonly key: string; readonly arm: string; readonly model: string; readonly scenario: string; readonly family: string; readonly cost: number; readonly seconds: number; readonly shared: number | undefined; readonly ours: number | undefined; readonly criteria: number | undefined; readonly recall: number | undefined; readonly score: number | undefined };

const VERDICT: Readonly<Record<string, number>> = { correct: 1, partial: 0.5, wrong: 0 };

export function mean(values: readonly (number | undefined)[]): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length === 0 ? undefined : present.reduce((sum, value) => sum + value, 0) / present.length;
}

function rate(checks: readonly JsonRecord[], scope: string): number | undefined {
  return mean(checks.filter((check) => check.scope === scope).map((check) => (check.pass === true ? 1 : 0)));
}

// Shared checks and shared criteria together, each criterion weighted as one check.
function combined(checks: readonly JsonRecord[], criteriaMean: number | undefined, sharedCriteria: number): number | undefined {
  const shared = checks.filter((check) => check.scope === "shared");
  if (criteriaMean === undefined) return rate(checks, "shared");
  return (shared.filter((check) => check.pass === true).length + criteriaMean * sharedCriteria) / (shared.length + sharedCriteria);
}

function criteriaScore(grades: readonly JsonRecord[]): number | undefined {
  return mean(grades.filter((grade) => grade.kind === "criteria").map((grade) => mean(recordList(grade.results).filter((result) => result.scope === "shared").map((result) => (result.met === true ? 1 : 0)))));
}

const text = (entry: JsonRecord, key: string): string => stringField(entry, key) ?? "";
const number = (entry: JsonRecord, key: string): number => numberField(entry, key) ?? 0;

// What a cell's score depends on in its scenario.
function scenarioFacts(id: string): { readonly family: string; readonly sharedCriteria: number; readonly recall: boolean } {
  const scenario = SCENARIOS.find((spec) => spec.id === id);
  if (scenario === undefined) return { family: "", sharedCriteria: 0, recall: false };
  return { family: scenario.family, sharedCriteria: scenario.criteria.filter((criterion) => criterion.scope === "shared").length, recall: scenario.question !== undefined };
}

export function cellOf(entry: JsonRecord, grades: readonly JsonRecord[]): Cell {
  const facts = scenarioFacts(text(entry, "scenario"));
  const checks = recordList(entry.checks);
  const recall = mean(grades.filter((grade) => grade.kind === "recall").map((grade) => VERDICT[text(grade, "verdict")]));
  const criteriaMean = criteriaScore(grades);
  return {
    key: keyOf(entry),
    arm: text(entry, "arm"),
    model: text(entry, "model"),
    scenario: text(entry, "scenario"),
    family: facts.family,
    cost: number(entry, "cost"),
    seconds: number(entry, "durationMs") / 1000,
    shared: rate(checks, "shared"),
    ours: rate(checks, "ours"),
    criteria: criteriaMean,
    recall,
    score: facts.recall ? recall : combined(checks, criteriaMean, facts.sharedCriteria),
  };
}

// The latest ok result of every cell of a run, scored with its grades, and the number of error records.
export async function readRun(out: string): Promise<{ readonly cells: readonly Cell[]; readonly errors: number }> {
  const results = (await readFile(join(out, "results.jsonl"), "utf8")).split("\n").map(jsonLine).filter(isRecord);
  const grades = (await readFile(join(out, "grades.jsonl"), "utf8").catch(() => "")).split("\n").map(jsonLine).filter(isRecord);
  const latest = new Map<string, JsonRecord>();
  for (const entry of results) if (entry.status === "ok") latest.set(keyOf(entry), entry);
  const cells = [...latest.values()].filter((entry) => !(stringField(entry, "arm") ?? "").startsWith("x")).map((entry) => cellOf(entry, grades.filter((grade) => grade.cell === keyOf(entry))));
  return { cells, errors: results.filter((entry) => entry.status !== "ok").length };
}

// The mean score of each scenario over its repetitions.
export function scenarioScores(cells: readonly Cell[]): ReadonlyMap<string, number> {
  const groups = new Map<string, number[]>();
  for (const cell of cells) if (cell.score !== undefined) groups.set(cell.scenario, [...(groups.get(cell.scenario) ?? []), cell.score]);
  return new Map([...groups].map(([scenario, values]) => [scenario, mean(values) ?? 0]));
}

// The mean of paired per-scenario differences, with a 90% percentile bootstrap interval that resamples scenarios.
export function bootstrap(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): { readonly n: number; readonly diff: number; readonly low: number; readonly high: number } | undefined {
  const diffs = [...left].flatMap(([scenario, score]) => (right.has(scenario) ? [score - (right.get(scenario) ?? 0)] : []));
  if (diffs.length === 0) return undefined;
  let seed = 7;
  const random = (): number => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
  const samples = Array.from({ length: 4000 }, () => mean(diffs.map(() => diffs[Math.floor(random() * diffs.length)] ?? 0)) ?? 0).sort((x, y) => x - y);
  return { n: diffs.length, diff: mean(diffs) ?? 0, low: samples[Math.floor(samples.length * 0.05)] ?? 0, high: samples[Math.floor(samples.length * 0.95)] ?? 0 };
}
