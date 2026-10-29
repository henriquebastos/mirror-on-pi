// The comparison of the capability gate (capability.ts runs it): a graded A2 run against the committed baseline.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isRecord, numberField, parseJson, stringField, type JsonRecord } from "../../../src/json.ts";
import { REPO } from "../../support/content.ts";
import { fixtureHash } from "./fixture.ts";
import { bootstrap, readRun, scenarioScores, type Cell } from "./scores.ts";

export const GATE_MODELS = ["openai/gpt-6.1-sol", "anthropic/claude-opus-5-5"];
export const GATE_GRADER = "anthropic/claude-sonnet-5-5";
export const BASELINE = join(REPO, "mirror-pi", "evals", "baselines", "capability.json");
export const MARGIN = 0.05;

export type ModelBaseline = { readonly grader: string; readonly runs: number; readonly scenarios: Readonly<Record<string, number>>; readonly checks: Readonly<Record<string, readonly [passes: number, runs: number]>> };
export type Baseline = { readonly fixture: string; readonly pi: string; readonly mirror: string; readonly models: Readonly<Record<string, ModelBaseline>> };

export async function piVersion(): Promise<string> {
  const manifest: unknown = parseJson(await readFile(join(REPO, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"), "utf8"));
  return isRecord(manifest) ? (stringField(manifest, "version") ?? "") : "";
}

// The latest ok A2 results of one model, one per scenario and repetition.
async function latestResults(out: string, model: string): Promise<readonly JsonRecord[]> {
  const lines = (await readFile(join(out, "results.jsonl"), "utf8")).split("\n").filter((line) => line !== "");
  const latest = new Map<string, JsonRecord>();
  for (const line of lines) {
    const entry: unknown = parseJson(line);
    if (isRecord(entry) && entry.status === "ok" && entry.arm === "a2" && entry.model === model) latest.set(`${String(entry.scenario)}|${String(entry.rep)}`, entry);
  }
  return [...latest.values()];
}

// Shared check passes per scenario and check id, as [passes, runs].
async function sharedChecks(out: string, model: string): Promise<Record<string, [number, number]>> {
  const counts: Record<string, [number, number]> = {};
  for (const entry of await latestResults(out, model)) {
    const checks = Array.isArray(entry.checks) ? entry.checks.filter(isRecord) : [];
    for (const check of checks.filter((candidate) => candidate.scope === "shared")) {
      const key = `${stringField(entry, "scenario") ?? ""}/${stringField(check, "id") ?? ""}`;
      const [passes, runs] = counts[key] ?? [0, 0];
      counts[key] = [passes + (check.pass === true ? 1 : 0), runs + 1];
    }
  }
  return counts;
}

// The graders of one model's A2 cells.
async function readGraders(out: string, model: string): Promise<string> {
  const text = await readFile(join(out, "grades.jsonl"), "utf8").catch(() => "");
  const grades = text.split("\n").filter((line) => line !== "").map((line): unknown => parseJson(line)).filter(isRecord);
  return [...new Set(grades.filter((grade) => (stringField(grade, "cell") ?? "").startsWith(`a2|${model}|`)).map((grade) => stringField(grade, "grader") ?? ""))].sort().join(",");
}

const a2Cells = (cells: readonly Cell[], model: string): readonly Cell[] => cells.filter((cell) => cell.arm === "a2" && cell.model === model);

export async function writeBaseline(out: string, mirror: string | undefined, path = BASELINE): Promise<void> {
  const { cells } = await readRun(out);
  const models = [...new Set(cells.filter((cell) => cell.arm === "a2").map((cell) => cell.model))].sort();
  const entries = await Promise.all(models.map(async (model) => {
    const own = a2Cells(cells, model);
    const runs = Math.max(...own.map((cell) => own.filter((other) => other.scenario === cell.scenario).length));
    const scenarios = Object.fromEntries([...scenarioScores(own)].sort(([a], [b]) => a.localeCompare(b)).map(([id, score]) => [id, Math.round(score * 10_000) / 10_000]));
    return [model, { grader: await readGraders(out, model), runs, scenarios, checks: await sharedChecks(out, model) }] as const;
  }));
  const baseline: Baseline = { fixture: await fixtureHash(), pi: await piVersion(), mirror: mirror ?? (await describeMirror()), models: Object.fromEntries(entries) };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Wrote ${path} for ${models.join(", ")}`);
}

async function describeMirror(): Promise<string> {
  const output: Buffer[] = [];
  await new Promise((resolve) => {
    const child = spawn("git", ["-C", REPO, "describe", "--tags", "--always", "--dirty"], { stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.on("close", resolve);
  });
  return Buffer.concat(output).toString("utf8").trim();
}

function readBaseline(value: unknown, path: string): Baseline {
  if (!isRecord(value) || !isRecord(value.models)) throw new Error(`Bad baseline ${path}`);
  const models = Object.fromEntries(Object.entries(value.models).flatMap(([model, entry]) => {
    if (!isRecord(entry) || !isRecord(entry.scenarios) || !isRecord(entry.checks)) return [];
    const scenarios = Object.fromEntries(Object.entries(entry.scenarios).flatMap(([id, score]) => (typeof score === "number" ? [[id, score]] : [])));
    const checks = Object.fromEntries(Object.entries(entry.checks).flatMap(([id, pair]) => (Array.isArray(pair) && typeof pair[0] === "number" && typeof pair[1] === "number" ? [[id, [pair[0], pair[1]] as const]] : [])));
    return [[model, { grader: stringField(entry, "grader") ?? "", runs: numberField(entry, "runs") ?? 0, scenarios, checks }]];
  }));
  return { fixture: stringField(value, "fixture") ?? "", pi: stringField(value, "pi") ?? "", mirror: stringField(value, "mirror") ?? "", models };
}

const pct = (value: number): string => (value * 100).toFixed(0);

async function refusals(baseline: Baseline): Promise<readonly string[]> {
  const pi = await piVersion();
  return [
    ...(baseline.fixture === (await fixtureHash()) ? [] : ["The fixture differs from the baseline's fixture."]),
    ...(baseline.pi === pi ? [] : [`Pi ${pi} differs from the baseline's Pi ${baseline.pi}.`]),
  ];
}

const average = (values: Iterable<number>): number => {
  const list = [...values];
  return list.reduce((sum, value) => sum + value, 0) / Math.max(list.length, 1);
};

// One model's row of the report, and its failures.
async function compareModel(out: string, model: string, before: ModelBaseline | undefined, cells: readonly Cell[]): Promise<{ readonly row?: string; readonly failures: readonly string[] }> {
  if (before === undefined) return { failures: [`${model}: no baseline`] };
  const now = scenarioScores(a2Cells(cells, model));
  const baseline = new Map(Object.entries(before.scenarios));
  const missing = [...baseline.keys()].filter((id) => !now.has(id));
  const result = bootstrap(now, baseline);
  if (result === undefined || missing.length > 0) return { failures: [`${model}: scenarios without a result: ${missing.join(", ")}`] };
  const ok = result.low >= -MARGIN;
  const checks = await sharedChecks(out, model);
  const lost = Object.entries(before.checks).filter(([id, [passes, runs]]) => {
    const [nowPasses, nowRuns] = checks[id] ?? [0, 0];
    return passes === runs && runs > 0 && nowRuns > 0 && nowPasses === 0;
  });
  const row = `| ${model} | ${String(result.n)} | ${pct(average(baseline.values()))}% | ${pct(average(now.values()))}% | ${pct(result.diff)} | ${pct(result.low)} to ${pct(result.high)} | ${ok ? "pass" : "FAIL"} |`;
  return {
    row,
    failures: [
      ...(ok ? [] : [`${model}: lower bound ${pct(result.low)} points`]),
      ...lost.map(([id, [, runs]]) => `${model}: check ${id} passed ${String(runs)}/${String(runs)} in the baseline and fails in every run now`),
    ],
  };
}

// Compare a graded run with the baseline. Returns the Markdown report and whether the gate passed.
export async function compare(out: string, models: readonly string[], path = BASELINE): Promise<{ readonly text: string; readonly pass: boolean }> {
  const baseline = readBaseline(parseJson(await readFile(path, "utf8")), path);
  const refused = await refusals(baseline);
  if (refused.length > 0) return { text: `# Capability gate: refused\n\n${refused.join("\n")} Regenerate the baseline (docs/evals.md).\n`, pass: false };
  const { cells } = await readRun(out);
  const results = await Promise.all(models.map(async (model) => compareModel(out, model, baseline.models[model], cells)));
  const failures = results.flatMap((result) => result.failures);
  const lines = [
    "# Capability gate",
    "",
    `Baseline: Mirror ${baseline.mirror}, Pi ${baseline.pi}. Fails when the 90% lower bound of now − baseline is below −${pct(MARGIN)} points, or a shared check that passed in every baseline run fails in every run now.`,
    "",
    "| model | scenarios | baseline | now | difference | 90% interval | result |",
    "|---|---|---|---|---|---|---|",
    ...results.flatMap((result) => (result.row === undefined ? [] : [result.row])),
    "",
    failures.length === 0 ? "Result: pass." : `Result: FAIL.\n\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    "",
  ];
  return { text: lines.join("\n"), pass: failures.length === 0 };
}

