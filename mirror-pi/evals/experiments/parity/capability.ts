// The capability gate: Mirror's A2 arm with the frozen history (fixture.ts), on the gate models, graded blind by
// Sonnet 5.5, and compared with the committed baseline. The gate fails when Mirror lost capability on a model:
// - the 90% lower bound of the paired per-scenario difference (now − baseline) is below −5 points, or
// - a shared check that passed in every baseline run fails in every run now.
// It refuses to compare when the fixture or the Pi version differs from the baseline's, because the baseline then
// measured something else: regenerate both together (docs/evals.md).
// Usage:
//   node mirror-pi/evals/experiments/parity/capability.ts run [<out>] [--models provider/id,...] [--repeat 3] [--concurrency 6]
//   node mirror-pi/evals/experiments/parity/capability.ts compare <out>
//   node mirror-pi/evals/experiments/parity/capability.ts baseline <out> [--mirror <the Mirror version that ran the cells>]
import { spawn } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { compare, GATE_GRADER, GATE_MODELS, writeBaseline } from "./gate.ts";

const HERE = import.meta.dirname;

async function step(script: string, args: readonly string[]): Promise<void> {
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, [join(HERE, script), ...args], { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (code !== 0) throw new Error(`${script} ${args.join(" ")} exited with ${String(code)}`);
}

async function gate(out: string, models: readonly string[], repeat: string, concurrency: string): Promise<boolean> {
  await step("run.ts", ["prepare", out, "--arms", "a2", "--fixture"]);
  const cellArgs = ["cells", out, "--arms", "a2", "--models", models.join(","), "--repeat", repeat, "--concurrency", concurrency];
  await step("run.ts", cellArgs);
  // A cell that failed on a provider error runs once more; `cells` skips every finished cell.
  await step("run.ts", cellArgs);
  await step("grade.ts", [out, "--graders", GATE_GRADER, "--concurrency", concurrency]);
  const result = await compare(out, models);
  await writeFile(join(out, "capability.md"), result.text);
  console.log(result.text);
  return result.pass;
}

async function runGate(target: string | undefined, models: readonly string[], values: { readonly repeat?: string; readonly concurrency?: string }): Promise<void> {
  const out = target ?? join(tmpdir(), `mirror-capability-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(out, { recursive: true });
  process.exitCode = (await gate(await realpath(out), models, values.repeat ?? "3", values.concurrency ?? "6")) ? 0 : 1;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { models: { type: "string" }, repeat: { type: "string" }, concurrency: { type: "string" }, mirror: { type: "string" } } });
  const [command, target] = positionals;
  const models = values.models?.split(",") ?? GATE_MODELS;
  if (command === "run") return runGate(target, models, values);
  if (target === undefined) throw new Error("Usage: capability.ts run [<out>] | compare <out> | baseline <out>");
  if (command === "baseline") return writeBaseline(target, values.mirror);
  if (command !== "compare") throw new Error(`Unknown command ${String(command)}`);
  const result = await compare(target, models);
  console.log(result.text);
  process.exitCode = result.pass ? 0 : 1;
}

await main();
