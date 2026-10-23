// Shared plumbing for Mirror's Pi extensions.
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { findJourney, MARKER, type Journey } from "./journey.ts";
import type { JsonRecord } from "./json.ts";
import type { MemoryClient } from "./memory-client.ts";
import { loadMemoryClient } from "./memory-config.ts";
import type { RecordReceipt } from "./records.ts";
import type { Result } from "./result.ts";

export type ToolText = { content: { type: "text"; text: string }[]; details: JsonRecord };

// Load the AI Memory client from the Pi agent directory. Without it, the extension only warns at session start.
export async function withMemory(pi: ExtensionAPI, name: string, create: (client: MemoryClient) => (pi: ExtensionAPI) => void): Promise<void> {
  const client = await loadMemoryClient(getAgentDir());
  if (!client.ok) {
    pi.on("session_start", (_event, ctx) => {
      notify(ctx, `${name} is off: ${client.error}`, "warning");
    });
    return;
  }
  create(client.value)(pi);
}

// The session's journey, or undefined outside a journey directory. An invalid marker is reported once per call.
export async function journeyFor(ctx: ExtensionContext): Promise<Journey | undefined> {
  const journey = await findJourney(ctx.cwd);
  if (journey.ok) return journey.value;
  notify(ctx, journey.error, "warning");
  return undefined;
}

export async function requireJourney(cwd: string): Promise<Journey> {
  const journey = await findJourney(cwd);
  if (!journey.ok) throw new Error(journey.error);
  if (journey.value === undefined) throw new Error(`This session is not in a journey directory (no ${MARKER} in ${cwd} or above).`);
  return journey.value;
}

export function sessionId(ctx: ExtensionContext): string | undefined {
  const id = ctx.sessionManager.getSessionId();
  return id === "" ? undefined : id;
}

export function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error"): void {
  if (ctx.hasUI) ctx.ui.notify(message, level);
  else console.error(message);
}

export function receiptResult(receipt: Result<RecordReceipt, string>): ToolText {
  if (!receipt.ok) throw new Error(receipt.error);
  const { kind, file, memory } = receipt.value;
  const published = memory.ok ? `Published to AI Memory as ${memory.value.path}.` : `NOT published to AI Memory (${memory.error.kind}: ${memory.error.message}).`;
  return {
    content: [{ type: "text", text: `Saved ${kind} to ${file}. ${published}` }],
    details: { kind, file, published: memory.ok, memoryPath: memory.ok ? memory.value.path : null },
  };
}
