// Summarize answers and grades per strategy: score, score per category, contradictions, cost, tokens, tools, and time.
// S1's build cost is AI Memory's consolidation, read from the model bridge's usage log for the history window.
// Usage: node mirror-pi/evals/experiments/memory/report.ts <output-dir>
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord, numberField, parseJson, stringField } from "../../../src/json.ts";
import type { HistoryState } from "./generate.ts";
import { answerKey, GRADER, readJsonl, type Answer, type Grade } from "./results.ts";
import { QUESTIONS, type Category } from "./questions.ts";
import { STRATEGIES } from "./strategies.ts";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const POINTS: Readonly<Record<Grade["verdict"], number>> = { correct: 1, partial: 0.5, wrong: 0 };
const CATEGORIES: readonly Category[] = ["single", "multi", "temporal", "current", "said", "probe", "abstain"];

type Row = Answer & { readonly grade: Grade; readonly category: Category };

const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);
const pct = (value: number): string => `${(value * 100).toFixed(0)}%`;
const median = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

function strategyLine(rows: readonly Row[]): string[] {
  const runs = [...new Set(rows.map((row) => row.run))].sort();
  const perRun = runs.map((run) => mean(rows.filter((row) => row.run === run).map((row) => POINTS[row.grade.verdict])));
  const cells = [
    pct(mean(rows.map((row) => POINTS[row.grade.verdict]))),
    perRun.map(pct).join(" / "),
    ...CATEGORIES.map((category) => pct(mean(rows.filter((row) => row.category === category).map((row) => POINTS[row.grade.verdict])))),
    String(rows.filter((row) => row.grade.contradicts).length),
  ];
  const usage = [
    `$${mean(rows.map((row) => row.usage.cost)).toFixed(4)}`,
    `${(mean(rows.map((row) => row.usage.input + row.usage.cacheRead)) / 1000).toFixed(1)}k`,
    mean(rows.map((row) => row.tools.length)).toFixed(1),
    `${(median(rows.map((row) => row.ms)) / 1000).toFixed(0)} s`,
  ];
  return [cells.join(" | "), usage.join(" | ")];
}

async function buildCost(state: HistoryState): Promise<{ calls: number; cost: number; tokens: number }> {
  const start = Date.parse(state.startedAt);
  const end = Date.parse(state.consolidatedAt);
  const lines = await readJsonl(join(ROOT, "dev/pi-model-bridge/run/usage.jsonl"));
  const inWindow = lines.filter(isRecord).filter((line) => {
    const at = Date.parse(stringField(line, "at") ?? "");
    return at >= start && at <= end;
  });
  const usage = inWindow.map((line) => (isRecord(line.usage) ? line.usage : {}));
  return {
    calls: inWindow.length,
    cost: usage.reduce((sum, item) => sum + (isRecord(item.cost) ? numberField(item.cost, "total") ?? 0 : 0), 0),
    tokens: usage.reduce((sum, item) => sum + (numberField(item, "input") ?? 0) + (numberField(item, "cacheRead") ?? 0) + (numberField(item, "output") ?? 0), 0),
  };
}

function perQuestion(rows: readonly Row[]): string[] {
  return QUESTIONS.map((question) => {
    const cells = STRATEGIES.map((strategy) => {
      const points = rows.filter((row) => row.strategy === strategy && row.question === question.id).map((row) => POINTS[row.grade.verdict]);
      return points.reduce((sum, value) => sum + value, 0).toString();
    });
    return `| ${question.id} | ${question.category} | ${question.prompt.replace(/\|/g, "/")} | ${cells.join(" | ")} |`;
  });
}

async function main(output: string): Promise<void> {
  const state = parseJson(await readFile(join(output, "history.json"), "utf8")) as HistoryState; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- written by generate.ts in this experiment
  const grades = new Map(((await readJsonl(join(output, "grades.jsonl"))) as Grade[]).map((grade) => [grade.key, grade])); // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- written by grade.ts in this experiment
  const answers = (await readJsonl(join(output, "answers.jsonl"))) as Answer[]; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- written by ask.ts in this experiment
  const rows: Row[] = answers.flatMap((answer) => {
    const grade = grades.get(answerKey(answer));
    const category = QUESTIONS.find((question) => question.id === answer.question)?.category;
    return answer.error === undefined && grade !== undefined && category !== undefined ? [{ ...answer, grade, category }] : [];
  });
  const build = await buildCost(state);
  const runs = Math.max(...rows.map((row) => row.run));
  const lines = [
    "# Memory strategies: results",
    "",
    `Chat model ${state.model.kind === "real" ? `${state.model.provider}/${state.model.id}` : "scripted"}; grader ${GRADER.provider}/${GRADER.id}; ${String(QUESTIONS.length)} questions × ${String(runs)} runs per strategy; ${String(rows.length)} graded answers (${String(answers.length - rows.length)} missing or failed).`,
    `S1 build: AI Memory consolidation of ${String(state.sessions.length)} sessions, ${String(build.calls)} model calls, ${(build.tokens / 1000).toFixed(0)}k tokens, $${build.cost.toFixed(2)}. S2 and S3 build nothing.`,
    "",
    "## Score",
    "",
    `| Strategy | All | Per run | ${CATEGORIES.join(" | ")} | Contradictions |`,
    `|---|---|---|${CATEGORIES.map(() => "---|").join("")}---|`,
    ...STRATEGIES.map((strategy) => `| ${strategy} | ${strategyLine(rows.filter((row) => row.strategy === strategy))[0] ?? ""} |`),
    "",
    "## Cost per question",
    "",
    "| Strategy | Cost | Input tokens | Tool calls | Median time |",
    "|---|---|---|---|---|",
    ...STRATEGIES.map((strategy) => `| ${strategy} | ${strategyLine(rows.filter((row) => row.strategy === strategy))[1] ?? ""} |`),
    "",
    `## Points per question (sum over ${String(runs)} runs)`,
    "",
    `| ID | Category | Question | ${STRATEGIES.join(" | ")} |`,
    `|---|---|---|${STRATEGIES.map(() => "---|").join("")}`,
    ...perQuestion(rows),
    "",
  ];
  await writeFile(join(output, "report.md"), lines.join("\n"));
  console.log(lines.join("\n"));
}

const output = process.argv[2];
if (output === undefined) throw new Error("Usage: report.ts <output-dir>");
await main(output);
