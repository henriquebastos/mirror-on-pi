// Ask every question in a new session of each strategy's vault, several runs each, in shuffled order.
// S1 loads only the recall extension; S2 and S3 load no extension. Question sessions are kept in memory,
// so no question session becomes part of any strategy's record.
// Usage: node mirror-pi/evals/experiments/memory/ask.ts <output-dir> [runs] [concurrency]
import { appendFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { isRecord, parseJson } from "../../../src/json.ts";
import { devMemory, type EvalMemory } from "../../support/memory.ts";
import { openMirrorSession } from "../../support/session.ts";
import type { HistoryState } from "./generate.ts";
import { QUESTIONS, type Question } from "./questions.ts";
import { answerKey, readJsonl, type Answer } from "./results.ts";
import { buildVault, STRATEGIES, type Strategy } from "./strategies.ts";

type Task = { readonly strategy: Strategy; readonly run: number; readonly question: Question };

async function ask(memory: EvalMemory, state: HistoryState, cwd: string, task: Task): Promise<Answer> {
  const started = Date.now();
  const opened = await openMirrorSession({
    cwd, client: memory.client, model: state.model, sessionManager: SessionManager.inMemory(cwd),
    extensions: task.strategy === "s1-ai-memory" ? "recall" : "none",
  });
  try {
    await opened.session.prompt(task.question.prompt);
    return { strategy: task.strategy, run: task.run, question: task.question.id, answer: opened.session.getLastAssistantText() ?? "", ...measure(opened.session), ms: Date.now() - started };
  } finally {
    await opened.close();
  }
}

function measure(session: AgentSession): Pick<Answer, "tools" | "turns" | "usage"> {
  const tools: { name: string; args: unknown }[] = [];
  const usage = { input: 0, output: 0, cacheRead: 0, cost: 0 };
  let turns = 0;
  for (const message of session.messages) {
    if (message.role !== "assistant") continue;
    turns++;
    for (const part of message.content) if (part.type === "toolCall") tools.push({ name: part.name, args: part.arguments });
    usage.input += message.usage.input;
    usage.output += message.usage.output;
    usage.cacheRead += message.usage.cacheRead;
    usage.cost += message.usage.cost.total;
  }
  return { tools, turns, usage };
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a !== undefined && b !== undefined) [copy[i], copy[j]] = [b, a];
  }
  return copy;
}

async function main(output: string, runs: number, concurrency: number): Promise<void> {
  const state = parseJson(await readFile(join(output, "history.json"), "utf8")) as HistoryState; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- written by generate.ts in this experiment
  const memory = await devMemory();
  const root = await mkdtemp(join(tmpdir(), "mirror-memexp-vaults-"));
  const cwds = new Map<Strategy, string>();
  for (const strategy of STRATEGIES) cwds.set(strategy, await buildVault(state.vault, join(root, strategy), strategy));
  const file = join(output, "answers.jsonl");
  const done = new Set((await readJsonl(file)).filter((entry) => isRecord(entry) && entry.error === undefined).map((entry) => answerKey(entry as Answer))); // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- written by this script
  const tasks = shuffle(STRATEGIES.flatMap((strategy) => QUESTIONS.flatMap((question) => Array.from({ length: runs }, (_, index) => ({ strategy, run: index + 1, question })))))
    .filter((task) => !done.has(answerKey({ strategy: task.strategy, run: task.run, question: task.question.id })));
  console.log(`vaults: ${root}; ${String(tasks.length)} questions to ask`);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let task = tasks[next++]; task !== undefined; task = tasks[next++]) {
      const answer = await ask(memory, state, cwds.get(task.strategy) ?? "", task).catch((error: unknown) => ({ strategy: task.strategy, run: task.run, question: task.question.id, answer: "", tools: [], turns: 0, usage: { input: 0, output: 0, cacheRead: 0, cost: 0 }, ms: 0, error: String(error) }));
      await appendFile(file, `${JSON.stringify(answer)}\n`);
      console.log(`${String(next)}/${String(tasks.length)} ${answerKey(answer)} ${answer.error ?? `${String(answer.turns)} turns, $${answer.usage.cost.toFixed(4)}`}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

const [output, runs = "3", concurrency = "6"] = process.argv.slice(2);
if (output === undefined) throw new Error("Usage: ask.ts <output-dir> [runs] [concurrency]");
await main(output, Number(runs), Number(concurrency));
