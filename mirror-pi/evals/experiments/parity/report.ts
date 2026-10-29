// Summarize a parity run as Markdown: per arm and model, the shared and own checks, the graders' criteria, recall,
// cost, and paired differences between arms with a bootstrap interval over scenarios.
// A cell's shared score is the mean of its shared checks and its shared criteria (both graders averaged), or for a recall
// question its verdict (correct 1, partial 0.5, wrong 0, both graders averaged).
// Usage: node mirror-pi/evals/experiments/parity/report.ts <out> [--margin 0.05]
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isRecord, numberField, stringField, type JsonRecord } from "../../../src/json.ts";
import { jsonLine, recordList } from "./jsonl.ts";
import { keyOf } from "./keys.ts";
import { SCENARIOS } from "./scenarios.ts";

type Cell = { readonly key: string; readonly arm: string; readonly model: string; readonly scenario: string; readonly family: string; readonly cost: number; readonly seconds: number; readonly shared: number | undefined; readonly ours: number | undefined; readonly criteria: number | undefined; readonly recall: number | undefined; readonly score: number | undefined };

const VERDICT: Readonly<Record<string, number>> = { correct: 1, partial: 0.5, wrong: 0 };

function mean(values: readonly (number | undefined)[]): number | undefined {
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

function cellOf(entry: JsonRecord, grades: readonly JsonRecord[]): Cell {
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

const pct = (value: number | undefined): string => (value === undefined ? "–" : `${(value * 100).toFixed(0)}%`);

// Paired difference of two arms on one model: per scenario the mean score over repetitions, then the mean of the
// per-scenario differences, with a 90% percentile bootstrap interval that resamples scenarios.
function paired(cells: readonly Cell[], model: string, left: string, right: string): { readonly n: number; readonly diff: number; readonly low: number; readonly high: number } | undefined {
  const byScenario = (arm: string): Map<string, number> => {
    const groups = new Map<string, number[]>();
    for (const cell of cells) if (cell.model === model && cell.arm === arm && cell.score !== undefined) groups.set(cell.scenario, [...(groups.get(cell.scenario) ?? []), cell.score]);
    return new Map([...groups].map(([scenario, scores]) => [scenario, mean(scores) ?? 0]));
  };
  const a = byScenario(left);
  const b = byScenario(right);
  const diffs = [...a].flatMap(([scenario, score]) => (b.has(scenario) ? [score - (b.get(scenario) ?? 0)] : []));
  if (diffs.length === 0) return undefined;
  let seed = 7;
  const random = (): number => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
  const samples = Array.from({ length: 4000 }, () => mean(diffs.map(() => diffs[Math.floor(random() * diffs.length)] ?? 0)) ?? 0).sort((x, y) => x - y);
  return { n: diffs.length, diff: mean(diffs) ?? 0, low: samples[Math.floor(samples.length * 0.05)] ?? 0, high: samples[Math.floor(samples.length * 0.95)] ?? 0 };
}

function verdict(low: number, high: number, margin: number): string {
  if (low >= -margin && high <= margin) return "equivalent within margin";
  if (low > 0) return "left better";
  if (high < 0) return "right better";
  return "inconclusive";
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { margin: { type: "string" } } });
  const out = positionals[0];
  if (out === undefined) throw new Error("Usage: report.ts <out>");
  const margin = Number(values.margin ?? "0.05");
  const results = (await readFile(join(out, "results.jsonl"), "utf8")).split("\n").map(jsonLine).filter(isRecord);
  const grades = (await readFile(join(out, "grades.jsonl"), "utf8").catch(() => "")).split("\n").map(jsonLine).filter(isRecord);
  const latest = new Map<string, JsonRecord>();
  for (const entry of results) if (entry.status === "ok") latest.set(keyOf(entry), entry);
  const errors = results.filter((entry) => entry.status !== "ok").length;
  const cells = [...latest.values()].filter((entry) => !(stringField(entry, "arm") ?? "").startsWith("x")).map((entry) => cellOf(entry, grades.filter((grade) => grade.cell === keyOf(entry))));
  const arms = [...new Set(cells.map((cell) => cell.arm))].sort();
  const models = [...new Set(cells.map((cell) => cell.model))].sort();
  const lines: string[] = [`# Parity run ${out}`, "", `Cells: ${String(cells.length)} ok, ${String(errors)} error records (rerun). Margin for equivalence: ±${String(margin * 100)} points.`, ""];
  const of = (arm: string, model: string): readonly Cell[] => cells.filter((cell) => cell.arm === arm && cell.model === model);
  lines.push("## Scores by arm and model", "", table(["model", "arm", "cells", "shared score", "shared checks", "own checks", "shared criteria", "recall", "$/cell", "s/cell"], models.flatMap((model) => arms.map((arm) => {
    const group = of(arm, model);
    return [model, arm, String(group.length), pct(mean(group.map((cell) => cell.score))), pct(mean(group.map((cell) => cell.shared))), pct(mean(group.map((cell) => cell.ours))), pct(mean(group.map((cell) => cell.criteria))), pct(mean(group.map((cell) => cell.recall))), (mean(group.map((cell) => cell.cost)) ?? 0).toFixed(3), (mean(group.map((cell) => cell.seconds)) ?? 0).toFixed(0)];
  }))), "");
  const families = [...new Set(cells.map((cell) => cell.family))].sort();
  lines.push("## Shared score by family (all models)", "", table(["family", ...arms], families.map((family) => [family, ...arms.map((arm) => pct(mean(cells.filter((cell) => cell.arm === arm && cell.family === family).map((cell) => cell.score))))])), "");
  const pairs = [["a2", "a3"], ["a1", "a2"], ["a0", "a2"], ["a1", "a3"]] as const;
  lines.push("## Paired differences (left − right), 90% bootstrap interval over scenarios", "", table(["model", "pair", "scenarios", "difference", "interval", "reading"], models.flatMap((model) => pairs.flatMap(([left, right]) => {
    const result = paired(cells, model, left, right);
    return result === undefined ? [] : [[model, `${left} − ${right}`, String(result.n), pct(result.diff), `${pct(result.low)} to ${pct(result.high)}`, verdict(result.low, result.high, margin)]];
  }))), "");
  const failing = cells.filter((cell) => (cell.shared ?? 1) < 1 || (cell.ours ?? 1) < 1);
  lines.push("## Cells with a failed check", "", table(["cell", "shared", "own"], failing.map((cell) => [cell.key, pct(cell.shared), pct(cell.ours)])), "");
  lines.push(`Total chat cost of the listed cells: $${cells.reduce((sum, cell) => sum + cell.cost, 0).toFixed(2)}.`);
  const text = `${lines.join("\n")}\n`;
  await writeFile(join(out, "report.md"), text);
  console.log(text);
}

await main();
