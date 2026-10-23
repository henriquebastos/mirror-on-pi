// Connect evals to the local development AI Memory service. Each run uses its own workspace.
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadProfile, readMemoryToken } from "../../src/config.ts";
import { isRecord, numberField, stringField } from "../../src/json.ts";
import { MemoryClient, type MemoryScope } from "../../src/memory-client.ts";

const DEV_PROFILE = fileURLToPath(new URL("../../../config/dev.json", import.meta.url));

export type EvalMemory = {
  readonly client: MemoryClient;
  readonly url: string;
  readonly workspace: string;
};

export async function devMemory(): Promise<EvalMemory> {
  const profile = await loadProfile(DEV_PROFILE);
  if (!profile.ok) throw new Error(profile.error);
  const token = await readMemoryToken(profile.value.memory, process.env);
  if (!token.ok) throw new Error(token.error);
  const client = new MemoryClient(profile.value.memory.url, token.value);
  const workspace = `eval-${new Date().toISOString().slice(0, 19).replace(/[^0-9]/g, "")}-${randomBytes(3).toString("hex")}`;
  const tools = await client.ping();
  if (!tools.ok) throw new Error(`Development AI Memory is not reachable at ${profile.value.memory.url}. Run scripts/ai-memory.sh up. (${tools.error.message})`);
  return { client, url: profile.value.memory.url, workspace };
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

export async function observationTotal(client: MemoryClient, scope: MemoryScope, sessionId: string): Promise<number> {
  const result = await client.callTool("memory_read_session_observations", { ...scope, session_id: sessionId, limit: 1 });
  if (!result.ok) return 0;
  return numberField(result.value, "total") ?? 0;
}
