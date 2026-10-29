// Summarize a parity run as Markdown: per arm and model, the shared and own checks, the graders' criteria, recall,
// cost, and paired differences between arms with a bootstrap interval over scenarios. Scores: see scores.ts.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { bootstrap, mean, readRun, scenarioScores, type Cell } from "./scores.ts";

const pct = (value: number | undefined): string => (value === undefined ? "–" : `${(value * 100).toFixed(0)}%`);

// Paired difference of two arms on one model (see bootstrap in scores.ts).
function paired(cells: readonly Cell[], model: string, left: string, right: string): ReturnType<typeof bootstrap> {
  const of = (arm: string): readonly Cell[] => cells.filter((cell) => cell.model === model && cell.arm === arm);
  return bootstrap(scenarioScores(of(left)), scenarioScores(of(right)));
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
  const { cells, errors } = await readRun(out);
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
