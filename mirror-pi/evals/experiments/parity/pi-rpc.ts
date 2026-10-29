// Run one scripted conversation in one real Pi process, in RPC mode, as one session with one lifetime:
// session_start once, every user turn, then session_shutdown when stdin closes. Pi gets only the given environment.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { isRecord, stringField } from "../../../src/json.ts";
import { jsonLine } from "./jsonl.ts";

export const PI = process.env.PARITY_PI ?? join(homedir(), ".local", "share", "pnpm", "pi");

export type ConversationOptions = {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly args: readonly string[];
  readonly prompts: readonly string[];
  readonly turnTimeoutMs: number;
  // Called after each turn settles, while Pi still runs, to record the state of the arm.
  readonly afterTurn: (turn: number) => Promise<void>;
};

export type ConversationResult = { readonly sessionFile: string | undefined; readonly errors: readonly string[]; readonly stderr: string };

type Pending = { readonly resolve: (record: Readonly<Record<string, unknown>>) => void; readonly match: (record: Readonly<Record<string, unknown>>) => boolean };

export async function runConversation(options: ConversationOptions): Promise<ConversationResult> {
  const child = spawn(PI, ["--mode", "rpc", ...options.args], { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
  const errors: string[] = [];
  const stderr: Buffer[] = [];
  const waiting: Pending[] = [];
  let buffer = "";
  const exited = new Promise<void>((resolve) => child.on("close", () => { resolve(); }));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
      const line = buffer.slice(0, end).replace(/\r$/, "");
      buffer = buffer.slice(end + 1);
      const record = jsonLine(line);
      if (isRecord(record)) onRecord(record);
    }
  });
  const send = (record: Readonly<Record<string, unknown>>): void => { child.stdin.write(`${JSON.stringify(record)}\n`); };
  const onRecord = (record: Readonly<Record<string, unknown>>): void => {
    // No UI: every dialog is cancelled, as when the user has no way to answer it.
    if (record.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(stringField(record, "method") ?? "")) send({ type: "extension_ui_response", id: record.id, cancelled: true });
    for (const pending of waiting.filter((item) => item.match(record))) {
      waiting.splice(waiting.indexOf(pending), 1);
      pending.resolve(record);
    }
  };
  const next = async (match: Pending["match"], timeoutMs: number): Promise<Readonly<Record<string, unknown>> | undefined> =>
    Promise.race([
      new Promise<Readonly<Record<string, unknown>>>((resolve) => waiting.push({ resolve, match })),
      new Promise<undefined>((resolve) => setTimeout(() => { resolve(undefined); }, timeoutMs).unref()),
      exited.then(() => undefined),
    ]);

  let sessionFile: string | undefined;
  try {
    for (const [index, message] of options.prompts.entries()) {
      const settled = next((record) => record.type === "agent_settled", options.turnTimeoutMs);
      const accepted = next((record) => record.type === "response" && record.id === `p${String(index)}`, 60_000);
      send({ id: `p${String(index)}`, type: "prompt", message });
      const response = await accepted;
      if (response?.success !== true) {
        errors.push(`turn ${String(index)}: prompt not accepted: ${JSON.stringify(response ?? "no response")}`);
        break;
      }
      if ((await settled) === undefined) {
        errors.push(`turn ${String(index)}: no agent_settled within ${String(options.turnTimeoutMs)} ms`);
        break;
      }
      await options.afterTurn(index);
    }
    const stateResponse = next((record) => record.type === "response" && record.id === "state", 30_000);
    send({ id: "state", type: "get_state" });
    const state = await stateResponse;
    const data = state !== undefined && isRecord(state.data) ? state.data : undefined;
    sessionFile = data === undefined ? undefined : stringField(data, "sessionFile");
  } finally {
    child.stdin.end();
    const done = await Promise.race([exited.then(() => true), new Promise<false>((resolve) => setTimeout(() => { resolve(false); }, 60_000).unref())]);
    if (!done) {
      errors.push("Pi did not exit within 60 s after stdin closed");
      child.kill("SIGKILL");
    }
  }
  return { sessionFile, errors, stderr: Buffer.concat(stderr).toString("utf8").slice(-4000) };
}
