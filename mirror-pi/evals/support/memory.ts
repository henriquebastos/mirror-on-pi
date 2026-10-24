// Connect evals to the local development AI Memory service. Each run uses its own workspace.
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord, numberField, stringField } from "../../src/json.ts";
import { MemoryClient, type MemoryScope } from "../../src/memory-client.ts";
import { CONFIG_FILE, loadMemoryConfig, readMemoryToken } from "../../src/memory-config.ts";

export const DEV_AGENT_DIR = fileURLToPath(new URL("../../../dev/pi-agent/", import.meta.url));

export type EvalMemory = {
  readonly client: MemoryClient;
  readonly url: string;
  readonly workspace: string;
};

export async function devMemory(): Promise<EvalMemory> {
  const config = await loadMemoryConfig(join(DEV_AGENT_DIR, CONFIG_FILE));
  if (!config.ok) throw new Error(config.error);
  const token = await readMemoryToken(config.value, process.env);
  if (!token.ok) throw new Error(token.error);
  const url = config.value.url;
  useDevelopmentCapture(token.value);
  const client = new MemoryClient(url, token.value);
  const workspace = `eval-${new Date().toISOString().slice(0, 19).replace(/[^0-9]/g, "")}-${randomBytes(3).toString("hex")}`;
  const tools = await client.ping();
  if (!tools.ok) throw new Error(`Development AI Memory is not reachable at ${url}. Run scripts/ai-memory.sh up. (${tools.error.message})`);
  return { client, url, workspace };
}

// The generated AI Memory extension reads its token and spool directory from the environment, as personal Pi does.
// Point both at development values for this process, so no eval event uses a personal token or spool.
function useDevelopmentCapture(token: string | undefined): void {
  delete process.env.AI_MEMORY_SERVER_URL;
  delete process.env.AI_MEMORY_PROJECT_STRATEGY;
  if (token === undefined) delete process.env.AI_MEMORY_AUTH_TOKEN;
  else process.env.AI_MEMORY_AUTH_TOKEN = token;
  process.env.AI_MEMORY_DATA_DIR = mkdtempSync(join(tmpdir(), "mirror-eval-ai-memory-"));
}

export type Observation = { readonly kind: string; readonly body: string };

export async function observations(client: MemoryClient, scope: MemoryScope, sessionId: string): Promise<readonly Observation[]> {
  const result = await client.callTool("memory_read_session_observations", { ...scope, session_id: sessionId, limit: 200 });
  if (!result.ok) {
    if (result.error.kind === "rpc" && /not found/i.test(result.error.message)) return [];
    throw new Error(`memory_read_session_observations failed: ${result.error.kind}: ${result.error.message}`);
  }
  const rows = result.value.observations;
  if (!Array.isArray(rows)) throw new Error(`Unexpected observations payload: ${JSON.stringify(result.value).slice(0, 300)}`);
  return rows.filter(isRecord).map((row) => ({ kind: stringField(row, "kind") ?? "", body: stringField(row, "body") ?? "" }));
}

// The AI Memory extension can deliver the last event of a session just after session_shutdown returns,
// when a drain started by the previous event is finishing. A real `pi` process waits for it; an in-process eval must poll.
export async function observationsWith(client: MemoryClient, scope: MemoryScope, sessionId: string, kind: string, timeoutMs = 5_000): Promise<readonly Observation[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await observations(client, scope, sessionId);
    if (rows.some((row) => row.kind === kind) || Date.now() > deadline) return rows;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export async function observationTotal(client: MemoryClient, scope: MemoryScope, sessionId: string): Promise<number> {
  const result = await client.callTool("memory_read_session_observations", { ...scope, session_id: sessionId, limit: 1 });
  if (!result.ok) return 0;
  return numberField(result.value, "total") ?? 0;
}
