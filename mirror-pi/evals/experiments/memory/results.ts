// Shared record shapes and file helpers for the memory-strategy experiment. No side effects.
import { readFile } from "node:fs/promises";
import { parseJson } from "../../../src/json.ts";
import type { Strategy } from "./strategies.ts";

export type Usage = { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cost: number };

export type Answer = {
  readonly strategy: Strategy;
  readonly run: number;
  readonly question: string;
  readonly answer: string;
  readonly tools: readonly { readonly name: string; readonly args: unknown }[];
  readonly turns: number;
  readonly usage: Usage;
  readonly ms: number;
  readonly error?: string;
};

export type Verdict = "correct" | "partial" | "wrong";
export type Grade = { readonly key: string; readonly verdict: Verdict; readonly contradicts: boolean; readonly reason: string };

export const GRADER = { provider: "anthropic", id: "claude-sonnet-5-5" } as const;

export function answerKey(answer: { readonly strategy: string; readonly run: number; readonly question: string }): string {
  return `${answer.strategy}|${String(answer.run)}|${answer.question}`;
}

export async function readJsonl(path: string): Promise<readonly unknown[]> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text.split("\n").filter((line) => line.trim() !== "").map(parseJson);
}
