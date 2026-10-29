// The parity comparison runner. Run directories must be outside every Git repository with an AGENTS.md above them,
// because Pi loads context files from the working directory upward; the default is under /tmp.
// Usage:
//   node mirror-pi/evals/experiments/parity/run.ts prepare <out> [--arms a0,a1,a2,a3] [--history | --fixture]
//   node mirror-pi/evals/experiments/parity/run.ts freeze <out>
//   node mirror-pi/evals/experiments/parity/run.ts cells <out> --models openai/gpt-6-astra,... [--arms ...] [--scenarios ...] [--repeat 1] [--concurrency 6]
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isRecord, stringField } from "../../../src/json.ts";
import { jsonLine, recordList } from "./jsonl.ts";
import { cellId } from "./keys.ts";
import { ANTHROPIC_PATCH, EVAL_AUTH, keyEnv, needsAnthropicPatch } from "../../support/credentials.ts";
import { ALL_ARMS, ARMS, armDirs, armEnv, linkAuth, prepareArm, sessionDirName, TOOL_PATH, usesMirrorMind, type Arm, type ArmDirs } from "./arms.ts";
import { freeze, materialize } from "./fixture.ts";
import { firstPrompt, HISTORY } from "./history.ts";
import { mirrorMindCost, readTurns, snapshot, type State, type Turn } from "./observe.ts";
import { PI, runConversation } from "./pi-rpc.ts";
import { changedLayers, changedRecords, evaluate, journeyAfter } from "./probes.ts";
import { exec } from "./process.ts";
import { installMirrorMind } from "./reference.ts";
import { SCENARIOS, type Scenario } from "./scenarios.ts";

export const HISTORY_MODEL = "openai/gpt-6-astra";
const TURN_TIMEOUT_MS = 15 * 60_000;

export type HistoryReply = { readonly id: string; readonly lastReply: string; readonly errors: readonly string[] };

function modelArgs(model: string): readonly string[] {
  const slash = model.indexOf("/");
  if (slash < 1) throw new Error(`Model must be provider/id: ${model}`);
  const provider = model.slice(0, slash);
  const patch = needsAnthropicPatch(provider) ? ["-e", ANTHROPIC_PATCH] : [];
  return ["--provider", provider, "--model", model.slice(slash + 1), "--thinking", "medium", "--no-mcp", "--offline", "-a", ...patch];
}

// Mirror Mind's own model calls go through OpenRouter: the key from the environment, or from the named auth file.
async function openRouterKey(arms: readonly Arm[]): Promise<string | undefined> {
  if (!arms.some(usesMirrorMind)) return undefined;
  const fromEnv = keyEnv().OPENROUTER_API_KEY;
  if (fromEnv !== undefined || EVAL_AUTH === undefined) return fromEnv;
  const agent = await mkdtemp(join(tmpdir(), "mirror-parity-key-"));
  try {
    await symlink(EVAL_AUTH, join(agent, "auth.json"));
    return (await exec(PI, ["auth", "print-api-key", "--provider", "openrouter"], { env: { HOME: agent, PATH: TOOL_PATH.join(":"), PI_CODING_AGENT_DIR: agent } })).trim();
  } finally {
    await rm(agent, { recursive: true, force: true });
  }
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}

async function newestSession(dir: string): Promise<string | undefined> {
  const names = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith(".jsonl")).sort();
  const last = names.at(-1);
  return last === undefined ? undefined : join(dir, last);
}

// Each arm without history (`fresh`), then the same arm after the history (`history`): replayed with the history model,
// or, for A2 only, materialized from the frozen fixture without a model call.
async function prepare(out: string, arms: readonly Arm[], history: "none" | "replay" | "fixture"): Promise<void> {
  if (history === "fixture" && arms.some((arm) => arm !== "a2")) throw new Error("--fixture has only an A2 history");
  if (arms.some(usesMirrorMind)) await installMirrorMind();
  const key = await openRouterKey(arms);
  await Promise.all(arms.map(async (arm) => {
    // An arm is prepared once: preparing it again would add Mirror's text a second time.
    const freshRoot = join(out, "base", "fresh", arm);
    const fresh = (await exists(freshRoot)) ? armDirs(arm, freshRoot) : await prepareArm(arm, freshRoot);
    if (history === "replay") await replayHistory(arm, fresh, join(out, "base", "history", arm), key);
    if (history === "fixture") await materialize(freshRoot, join(out, "base", "history", arm));
  }));
}

async function replayHistory(arm: Arm, fresh: ArmDirs, target: string, key: string | undefined): Promise<void> {
  await cp(fresh.root, target, { recursive: true, verbatimSymlinks: true });
  const dirs = armDirs(arm, target);
  const replies: HistoryReply[] = [];
  for (const session of HISTORY) {
    const [first = "", ...rest] = session.turns;
    const result = await runConversation({ cwd: dirs.cwd, env: armEnv(arm, dirs, key), args: modelArgs(HISTORY_MODEL), prompts: [firstPrompt(session, first), ...rest], turnTimeoutMs: TURN_TIMEOUT_MS, afterTurn: async () => Promise.resolve() });
    const turns = result.sessionFile === undefined ? [] : await readTurns(result.sessionFile);
    replies.push({ id: session.id, lastReply: turns.at(-1)?.answer ?? "", errors: [...result.errors, ...turns.flatMap((turn) => turn.errors)] });
    console.log(`${arm} ${session.id}: ${(turns.at(-1)?.answer ?? "").slice(0, 70).replace(/\s+/g, " ")}`);
  }
  if (usesMirrorMind(arm)) await finishMirrorMind(dirs, key);
  await writeFile(join(target, "history.json"), `${JSON.stringify({ model: HISTORY_MODEL, cwd: dirs.cwd, replies }, null, 2)}\n`);
}

// Mirror Mind extracts a conversation at the next session start. After the last history session, run that maintenance
// until nothing is carried over, as the user's next sessions would.
async function finishMirrorMind(dirs: ArmDirs, key: string | undefined): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  for (let round = 0; round < 10; round++) {
    const output = await exec("mirror", ["conversation-logger", "session-maintenance"], { env: armEnv("a3", dirs, key) });
    console.log(`a3 maintenance ${String(round)}: ${output.replace(/\s+/g, " ").slice(0, 300)}`);
    if (!output.includes("carried over") && /Extracted pending conversations: 0\b/.test(output)) return;
  }
}

type CellKey = { readonly arm: Arm; readonly model: string; readonly scenario: string; readonly rep: number };

// Copy the arm's base into the cell, and move its earlier sessions to the session directory of the cell's vault.
// Mirror Mind's memory is its database: its copies of Pi session files are left out, so its maintenance does not import them again.
async function cloneBase(out: string, key: CellKey, scenario: Scenario): Promise<ArmDirs> {
  const source = join(out, "base", scenario.history ? "history" : "fresh", key.arm);
  const root = join(out, "cells", key.arm, key.model.replace(/\//g, "_"), scenario.id, String(key.rep));
  await rm(root, { recursive: true, force: true });
  await cp(source, root, { recursive: true, verbatimSymlinks: true });
  const dirs = armDirs(key.arm, root);
  await linkAuth(dirs.agent);
  const sessions = join(dirs.agent, "sessions");
  for (const name of await readdir(sessions)) {
    if (usesMirrorMind(key.arm)) await rm(join(sessions, name), { recursive: true, force: true });
    else await rename(join(sessions, name), join(sessions, sessionDirName(dirs.cwd)));
  }
  return dirs;
}

async function runCell(out: string, key: CellKey, scenario: Scenario, openRouter: string | undefined): Promise<Readonly<Record<string, unknown>>> {
  const started = Date.now();
  const dirs = await cloneBase(out, key, scenario);
  const since = new Date(started - 1000).toISOString();
  const states: State[] = [await snapshot(key.arm, dirs.cwd, dirs.mirrorHome, since)];
  const before = new Set(await readdir(join(dirs.agent, "sessions", sessionDirName(dirs.cwd))).catch(() => []));
  const result = await runConversation({
    cwd: dirs.cwd,
    env: armEnv(key.arm, dirs, openRouter),
    args: modelArgs(key.model),
    prompts: scenario.turns,
    turnTimeoutMs: TURN_TIMEOUT_MS,
    afterTurn: async () => { states.push(await snapshot(key.arm, dirs.cwd, dirs.mirrorHome, since)); },
  });
  const sessionFile = result.sessionFile ?? (await newSession(dirs, before));
  const turns = sessionFile === undefined ? [] : await readTurns(sessionFile);
  const errors = [...result.errors, ...turns.flatMap((turn, index) => turn.errors.map((error) => `turn ${String(index)}: ${error}`))];
  const backgroundCost = usesMirrorMind(key.arm) ? await new Promise((resolve) => setTimeout(resolve, 5000)).then(() => mirrorMindCost(dirs.mirrorHome, since)) : 0;
  // The full states, so that a later report can evaluate changed checks without a new run.
  await writeFile(join(dirs.root, "states.json"), `${JSON.stringify(states)}\n`);
  if (turns.length !== scenario.turns.length) errors.push(`expected ${String(scenario.turns.length)} turns, got ${String(turns.length)}`);
  return {
    ...key,
    status: errors.length === 0 ? "ok" : "error",
    errors,
    durationMs: Date.now() - started,
    cost: turns.reduce((sum, turn) => sum + turn.usage.cost, 0) + backgroundCost,
    backgroundCost,
    checks: evaluate(key.arm, scenario.checks, turns, states),
    turns: turns.map((turn, index) => summarizeTurn(key.arm, turn, index, turns, states)),
    sessionFile,
    stderr: result.stderr.slice(-1000),
  };
}

async function newSession(dirs: ArmDirs, before: ReadonlySet<string>): Promise<string | undefined> {
  const dir = join(dirs.agent, "sessions", sessionDirName(dirs.cwd));
  const created = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith(".jsonl") && !before.has(name)).sort();
  return created.length === 0 ? newestSession(dir) : join(dir, created.at(-1) ?? "");
}

function summarizeTurn(arm: Arm, turn: Turn, index: number, turns: readonly Turn[], states: readonly State[]): Readonly<Record<string, unknown>> {
  return {
    prompt: turn.prompt,
    answer: turn.answer,
    tools: turn.tools.map((tool) => ({ name: tool.name, args: JSON.stringify(tool.args).slice(0, 400) })),
    usage: turn.usage,
    journey: journeyAfter(arm, index, turns, states),
    identityChanges: changedLayers(states, index),
    records: changedRecords(states, index).map((record) => record.slice(0, 600)),
  };
}

async function done(file: string): Promise<ReadonlySet<string>> {
  const text = await readFile(file, "utf8").catch(() => "");
  const ids = text.split("\n").map(jsonLine).filter(isRecord).filter((entry) => entry.status === "ok").map((entry) => cellId({ arm: stringField(entry, "arm") ?? "", model: stringField(entry, "model") ?? "", scenario: stringField(entry, "scenario") ?? "", rep: Number(entry.rep) }));
  return new Set(ids);
}

async function cells(out: string, options: { arms: readonly Arm[]; models: readonly string[]; scenarios: readonly Scenario[]; repeat: number; concurrency: number }): Promise<void> {
  const file = join(out, "results.jsonl");
  const finished = await done(file);
  const keys: (CellKey & { readonly spec: Scenario })[] = [];
  for (let rep = 1; rep <= options.repeat; rep++)
    for (const model of options.models) for (const spec of options.scenarios) for (const arm of options.arms) keys.push({ arm, model, scenario: spec.id, rep, spec });
  const pending = keys.filter((key) => !finished.has(cellId(key)));
  console.log(`${String(pending.length)} cells to run (${String(keys.length - pending.length)} already done)`);
  const key = await openRouterKey(options.arms);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let cell = pending[next++]; cell !== undefined; cell = pending[next++]) {
      const result: Readonly<Record<string, unknown>> = await runCell(out, cell, cell.spec, key).catch((error: unknown) => ({ ...cell, status: "error", errors: [String(error)] }));
      await appendFile(file, `${JSON.stringify({ ...result, spec: undefined })}\n`);
      const checks = recordList(result.checks);
      const cost = typeof result.cost === "number" ? result.cost : 0;
      console.log(`${cellId(cell)} ${String(result.status)} checks ${String(checks.filter((check) => check.pass === true).length)}/${String(checks.length)} $${cost.toFixed(3)}`);
    }
  };
  await Promise.all(Array.from({ length: options.concurrency }, worker));
}

function historyMode(values: { readonly history?: boolean; readonly fixture?: boolean }): "none" | "replay" | "fixture" {
  if (values.fixture === true) return "fixture";
  return values.history === true ? "replay" : "none";
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { arms: { type: "string" }, models: { type: "string" }, scenarios: { type: "string" }, repeat: { type: "string" }, concurrency: { type: "string" }, history: { type: "boolean" }, fixture: { type: "boolean" } } });
  const [command, target] = positionals;
  if (target === undefined) throw new Error("Usage: run.ts prepare|freeze|cells <out> [options]");
  await mkdir(target, { recursive: true });
  const out = await realpath(target);
  const arms = values.arms === undefined ? ARMS : values.arms.split(",").filter((arm): arm is Arm => ALL_ARMS.some((known) => known === arm));
  if (command === "prepare") return prepare(out, arms, historyMode(values));
  // Write the A2 history of this run as the repository's fixture, after a replay (see fixture.ts).
  if (command === "freeze") {
    await freeze(join(out, "base", "fresh", "a2"), join(out, "base", "history", "a2"));
    return;
  }
  if (command !== "cells" || values.models === undefined) throw new Error("cells needs --models");
  const wanted = values.scenarios?.split(",");
  const scenarios = SCENARIOS.filter((spec) => wanted === undefined || wanted.includes(spec.id) || wanted.includes(spec.family));
  await cells(out, { arms, models: values.models.split(","), scenarios, repeat: Number(values.repeat ?? "1"), concurrency: Number(values.concurrency ?? "6") });
}

await main();
