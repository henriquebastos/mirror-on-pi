// Grade every answer blind: the grader sees the question, its category, the answer key, and the response,
// never the strategy. The grader is a different model family from the chat model.
// Usage: node mirror-pi/evals/experiments/memory/grade.ts <output-dir> [concurrency]
import { appendFile, readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { isRecord, parseJson, stringField } from "../../../src/json.ts";
import { answerKey, GRADER, readJsonl, type Answer, type Grade } from "./results.ts";
import type { HistoryState } from "./generate.ts";
import { QUESTIONS, type Question } from "./questions.ts";

const RUBRIC = `You grade answers from a reflective assistant that must remember earlier conversations with its user, Sam.
You get a question, its category, an answer key, and the assistant's response. Grade strictly against the answer key.

Verdicts:
- correct: the response states every essential point of the key, and nothing in it contradicts the key.
- partial: the response states some essential points of the key and contradicts nothing, but misses others.
- wrong: the response misses the main point, contradicts the key, gives an outdated value as current, or invents an answer.

Categories:
- single, temporal, current: facts and dates. A value that the key marks as corrected or outdated, given as the current one, is wrong.
- multi: a summary across sessions. Correct needs all essential points; partial needs at least half of them.
- said: the key is the assistant's earlier reply. Correct if the response gives the same substance (the same name, question, or sentence; small wording changes are fine). Wrong if it gives different content.
- probe: the user did not ask about the past. Correct if the response brings up the fact in the key by itself, correctly. Partial if it only hints at it or asks about it vaguely. Wrong if it goes along with the user's outdated premise.
- abstain: the topic was never discussed. Correct if the response says it has no record or does not know. Wrong if it gives a specific answer.

Set "contradicts" to true when the response states something as a remembered fact that contradicts the key or is invented.
Reply with one JSON object only: {"verdict": "correct" | "partial" | "wrong", "contradicts": true | false, "reason": "one sentence"}`;

function goldFor(question: Question, state: HistoryState): string {
  if (question.saidIn === undefined) return question.gold;
  const said = state.sessions.find((session) => session.id === question.saidIn);
  if (said === undefined) throw new Error(`No history session ${question.saidIn}`);
  return `The assistant's earlier reply:\n${said.lastReply}`;
}

// The grader occasionally answers without JSON. Ask again, up to three times.
async function grade(runtime: ModelRuntime, model: Model<Api>, question: Question, gold: string, answer: Answer): Promise<Grade> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await gradeOnce(runtime, model, question, gold, answer);
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
}

async function gradeOnce(runtime: ModelRuntime, model: Model<Api>, question: Question, gold: string, answer: Answer): Promise<Grade> {
  const prompt = JSON.stringify({ category: question.category, question: question.prompt, answer_key: gold, response: answer.answer }, null, 2);
  const reply = await runtime.completeSimple(model, { systemPrompt: RUBRIC, messages: [{ role: "user", content: prompt, timestamp: Date.now() }] }, { maxTokens: 1000 });
  const text = reply.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  const parsed = parseJson(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const verdict = isRecord(parsed) ? stringField(parsed, "verdict") : undefined;
  if (verdict !== "correct" && verdict !== "partial" && verdict !== "wrong") throw new Error(`Unexpected grade: ${text}`);
  return { key: answerKey(answer), verdict, contradicts: isRecord(parsed) && parsed.contradicts === true, reason: (isRecord(parsed) ? stringField(parsed, "reason") : undefined) ?? "" };
}

async function main(output: string, concurrency: number): Promise<void> {
  const state = parseJson(await readFile(join(output, "history.json"), "utf8")) as HistoryState; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- written by generate.ts in this experiment
  const answers = (await readJsonl(join(output, "answers.jsonl"))).filter((entry) => isRecord(entry) && entry.error === undefined) as Answer[]; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- written by ask.ts in this experiment
  const file = join(output, "grades.jsonl");
  const graded = new Set((await readJsonl(file)).map((entry) => (isRecord(entry) ? stringField(entry, "key") : undefined)));
  const runtime = await ModelRuntime.create({ authPath: join(homedir(), ".pi", "agent", "auth.json"), modelsPath: join(tmpdir(), "mirror-memexp-models.json") });
  const model = runtime.getModel(GRADER.provider, GRADER.id);
  if (model === undefined) throw new Error(`Unknown grader model ${GRADER.provider}/${GRADER.id}`);
  const pending = answers.filter((answer) => !graded.has(answerKey(answer))).sort(() => Math.random() - 0.5);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let answer = pending[next++]; answer !== undefined; answer = pending[next++]) {
      const question = QUESTIONS.find((candidate) => candidate.id === answer.question);
      if (question === undefined) throw new Error(`Unknown question ${answer.question}`);
      const result = await grade(runtime, model, question, goldFor(question, state), answer);
      await appendFile(file, `${JSON.stringify(result)}\n`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`graded ${String(pending.length)} answers`);
}

const [output, concurrency = "6"] = process.argv.slice(2);
if (output === undefined) throw new Error("Usage: grade.ts <output-dir> [concurrency]");
await main(output, Number(concurrency));
