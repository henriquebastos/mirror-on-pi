// Shared plumbing for Mirror's Pi extensions.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { boundSlug, findJourneyBySlug, localJourney, type Journey } from "./journey.ts";
import type { JsonRecord } from "./json.ts";
import type { RecordReceipt } from "./records.ts";
import type { Result } from "./result.ts";

export type ToolText = { content: { type: "text"; text: string }[]; details: JsonRecord };

// The journey the session entered, or the journey directory the session started in. Records need one.
export async function requireJourney(ctx: ExtensionContext): Promise<Journey> {
  const slug = boundSlug(ctx.sessionManager.getBranch());
  const journey = slug === undefined ? await localJourney(ctx.cwd) : await findJourneyBySlug(ctx.cwd, slug);
  if (slug !== undefined && journey === undefined) throw new Error(`The journey ${slug} is no longer in the vault. Enter another journey with mirror_enter_journey.`);
  if (journey === undefined) throw new Error("This session has no journey. Propose one with mirror_enter_journey; records are saved only in a journey.");
  return journey;
}

// A child process of pi-subagents. Mirror adds nothing to its system prompt: a subagent is the agent it was started as, not the mirror.
export function isSubagent(): boolean {
  return process.env.PI_SUBAGENT_CHILD === "1";
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
