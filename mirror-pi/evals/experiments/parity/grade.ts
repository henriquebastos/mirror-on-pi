// Grade every finished cell blind. The default grader is Sonnet 5.5 alone (design §1k): a second family, Gemini, was
// dropped, and GPT-6.1 Sol agreed with the stored grades on only half of the recall items.
// A grader sees the user turns and the visible answers, never the arm or the model. Layout that names an arm is removed:
// Mirror Mind's mode banner, box borders, and quotation marks; the text inside boxes and cards stays.
// Usage: node mirror-pi/evals/experiments/parity/grade.ts <out> [--concurrency 6] [--graders provider/id,...]
import { appendFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Api, Model } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { isRecord, stringField, type JsonRecord } from "../../../src/json.ts";
import { EVAL_AUTH } from "../../support/credentials.ts";
import { QUESTIONS, type Question } from "./history.ts";
import { blind } from "./blind.ts";
import { jsonLine, recordList } from "./jsonl.ts";
import { keyOf } from "./keys.ts";
import { SCENARIOS, type Scenario } from "./scenarios.ts";
import { completeWithPi, preparePiGrader } from "./pi-grader.ts";

export const GRADERS = ["anthropic/claude-sonnet-5-5"];

const CRITERIA_RUBRIC = `You grade a conversation between a user, Sam, and a reflective assistant ("the mirror") that knows Sam's identity and earlier conversations.
You get the conversation turn by turn and a list of criteria. Each criterion names one turn. Judge only that turn's reply, in the light of the turns before it.
A criterion is met only when the reply clearly does what it says. Layout and formatting do not matter; content does.
Reply with one JSON object only, one key per criterion id: {"<id>": {"met": true | false, "reason": "one sentence"}}`;

const RECALL_RUBRIC = `You grade answers from a reflective assistant that must remember earlier conversations with its user, Sam.
You get a question, its category, an answer key, and the assistant's response. Grade strictly against the answer key.

Verdicts:
- correct: the response states every essential point of the key, and nothing in it contradicts the key.
- partial: the response states some essential points of the key and contradicts nothing, but misses others.
- wrong: the response misses the main point, contradicts the key, gives an outdated value as current, or invents an answer.

Categories:
- single, temporal, current, cross: facts and dates. A value that the key marks as corrected or outdated, given as the current one, is wrong.
- multi: a summary across sessions. Correct needs all essential points; partial needs at least half of them.
- said: the key is the assistant's earlier reply. Correct if the response gives the same substance (the same name, question, or sentence; small wording changes are fine). Wrong if it gives different content.
- probe: the user did not ask about the past. Correct if the response brings up the fact in the key by itself, correctly. Partial if it only hints at it or asks about it vaguely. Wrong if it goes along with the user's outdated premise.
- abstain: the topic was never discussed. Correct if the response says it has no record or does not know. Wrong if it gives a specific answer.

Set "contradicts" to true when the response states something as a remembered fact that contradicts the key or is invented.
Reply with one JSON object only: {"verdict": "correct" | "partial" | "wrong", "contradicts": true | false, "reason": "one sentence"}`;

type Cell = JsonRecord & { readonly turns: readonly JsonRecord[] };

function transcript(cell: Cell): string {
  return cell.turns.map((turn, index) => `### Turn ${String(index)}\nSam: ${stringField(turn, "prompt") ?? ""}\n\nMirror:\n${blind(stringField(turn, "answer") ?? "")}`).join("\n\n");
}

// Direct Anthropic graders run through Pi (see pi-grader.ts); every other grader is a direct model call.
type Grader = { readonly name: string; readonly model: Model<Api>; readonly piRoot?: string };

async function replyText(runtime: ModelRuntime, grader: Grader, system: string, prompt: string): Promise<string> {
  if (grader.piRoot !== undefined) return completeWithPi(grader.piRoot, grader.name, system, prompt);
  const reply = await runtime.completeSimple(grader.model, { systemPrompt: system, messages: [{ role: "user", content: prompt, timestamp: Date.now() }] }, { maxTokens: 4000 });
  if (reply.stopReason === "error") throw new Error(`Grader error: ${reply.errorMessage ?? "unknown"}`);
  return reply.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

async function complete(runtime: ModelRuntime, grader: Grader, system: string, prompt: string): Promise<JsonRecord> {
  for (let attempt = 1; ; attempt++) {
    try {
      const text = await replyText(runtime, grader, system, prompt);
      const parsed = jsonLine(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      if (isRecord(parsed)) return parsed;
      throw new Error(`No JSON: ${text.slice(0, 200)}`);
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
}

async function gradeCriteria(runtime: ModelRuntime, grader: Grader, scenario: Scenario, cell: Cell): Promise<JsonRecord> {
  const criteria = scenario.criteria.map((criterion) => ({ id: criterion.id, turn: criterion.turn, criterion: criterion.text }));
  const parsed = await complete(runtime, grader, CRITERIA_RUBRIC, `${transcript(cell)}\n\n### Criteria\n${JSON.stringify(criteria, null, 2)}`);
  const results = scenario.criteria.map((criterion) => {
    const value = parsed[criterion.id];
    return { id: criterion.id, scope: criterion.scope, met: isRecord(value) && value.met === true, reason: isRecord(value) ? (stringField(value, "reason") ?? "") : "missing" };
  });
  return { kind: "criteria", results };
}

async function gradeRecall(runtime: ModelRuntime, grader: Grader, question: Question, gold: string, cell: Cell): Promise<JsonRecord> {
  const response = blind(stringField(cell.turns[0] ?? {}, "answer") ?? "");
  const parsed = await complete(runtime, grader, RECALL_RUBRIC, JSON.stringify({ category: question.category, question: question.prompt, answer_key: gold, response }, null, 2));
  const verdict = stringField(parsed, "verdict");
  if (verdict !== "correct" && verdict !== "partial" && verdict !== "wrong") throw new Error(`Unexpected verdict: ${JSON.stringify(parsed)}`);
  return { kind: "recall", verdict, contradicts: parsed.contradicts === true, reason: stringField(parsed, "reason") ?? "" };
}

// The answer key of a `said` question is the arm's own reply in that history session.
async function goldFor(out: string, arm: string, question: Question): Promise<string> {
  if (question.saidIn === undefined) return question.gold;
  const history = jsonLine(await readFile(join(out, "base", "history", arm, "history.json"), "utf8"));
  const reply = isRecord(history) ? recordList(history.replies).find((entry) => entry.id === question.saidIn) : undefined;
  const text = reply === undefined ? undefined : stringField(reply, "lastReply");
  if (text === undefined || text === "") throw new Error(`No history reply ${question.saidIn} for ${arm}`);
  return `The assistant's earlier reply:\n${blind(text)}`;
}

async function readCells(out: string): Promise<readonly Cell[]> {
  const text = await readFile(join(out, "results.jsonl"), "utf8");
  const latest = new Map<string, Cell>();
  for (const entry of text.split("\n").map(jsonLine).filter(isRecord)) {
    if (entry.status !== "ok") continue;
    latest.set(keyOf(entry), { ...entry, turns: recordList(entry.turns) });
  }
  return [...latest.values()];
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { concurrency: { type: "string" }, graders: { type: "string" } } });
  const out = positionals[0];
  if (out === undefined) throw new Error("Usage: grade.ts <out>");
  const file = join(out, "grades.jsonl");
  const graded = new Set((await readFile(file, "utf8").catch(() => "")).split("\n").map(jsonLine).filter(isRecord).map((entry) => `${stringField(entry, "cell") ?? ""}#${stringField(entry, "grader") ?? ""}`));
  const runtime = await ModelRuntime.create({ authPath: EVAL_AUTH ?? join(tmpdir(), "mirror-parity-no-auth", "auth.json"), modelsPath: join(tmpdir(), "mirror-parity-models.json") });
  const graders = (values.graders?.split(",") ?? GRADERS).map((name) => {
    const slash = name.indexOf("/");
    const model = runtime.getModel(name.slice(0, slash), name.slice(slash + 1));
    if (model === undefined) throw new Error(`Unknown grader ${name}`);
    return name.startsWith("anthropic/") ? { name, model, piRoot: join(out, "pi-grader") } : { name, model };
  });
  for (const grader of graders) if (grader.piRoot !== undefined) await preparePiGrader(grader.piRoot);
  const cells = (await readCells(out)).filter((cell) => !(stringField(cell, "arm") ?? "").startsWith("x"));
  const jobs = cells.flatMap((cell) => graders.map((grader) => ({ cell, grader }))).filter((job) => !graded.has(`${keyOf(job.cell)}#${job.grader.name}`)).sort(() => Math.random() - 0.5);
  console.log(`${String(jobs.length)} gradings to run`);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let job = jobs[next++]; job !== undefined; job = jobs[next++]) {
      const scenario = SCENARIOS.find((spec) => spec.id === stringField(job.cell, "scenario"));
      if (scenario === undefined || (scenario.criteria.length === 0 && scenario.question === undefined)) continue;
      const question = QUESTIONS.find((candidate) => candidate.id === scenario.question);
      const result = question === undefined
        ? await gradeCriteria(runtime, job.grader, scenario, job.cell)
        : await gradeRecall(runtime, job.grader, question, await goldFor(out, stringField(job.cell, "arm") ?? "", question), job.cell);
      await appendFile(file, `${JSON.stringify({ cell: keyOf(job.cell), grader: job.grader.name, ...result })}\n`);
    }
  };
  await Promise.all(Array.from({ length: Number(values.concurrency ?? "6") }, worker));
  console.log("graded");
}

await main();
