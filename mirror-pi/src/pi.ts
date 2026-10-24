// Shared plumbing for Mirror's Pi extensions.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { findJourney, type Journey } from "./journey.ts";
import type { JsonRecord } from "./json.ts";
import type { RecordReceipt } from "./records.ts";
import type { Result } from "./result.ts";

export type ToolText = { content: { type: "text"; text: string }[]; details: JsonRecord };

export function requireJourney(cwd: string): Journey {
  const journey = findJourney(cwd);
  if (journey === undefined) throw new Error(`This session is not in a journey directory (no journeys/<name> directory at or above ${cwd}).`);
  return journey;
}

export function sessionId(ctx: ExtensionContext): string | undefined {
  const id = ctx.sessionManager.getSessionId();
  return id === "" ? undefined : id;
}

export function receiptResult(receipt: Result<RecordReceipt, string>): ToolText {
  if (!receipt.ok) throw new Error(receipt.error);
  const { kind, file } = receipt.value;
  return { content: [{ type: "text", text: `Saved ${kind} to ${file}.` }], details: { kind, file } };
}
