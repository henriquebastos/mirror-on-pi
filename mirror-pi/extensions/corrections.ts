// Record a correction when the user corrects a fact: a Markdown file in the journey's `corrections/` directory
// that states what is true now and what was believed before.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { receiptResult, requireJourney, sessionId } from "../src/pi.ts";
import { recordCorrection } from "../src/records.ts";

export default function corrections(pi: ExtensionAPI): void {
  createCorrectionsExtension()(pi);
}

export function createCorrectionsExtension(now: () => Date = () => new Date()): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.registerTool({
      name: "mirror_record_correction",
      label: "Record correction",
      description: "Record that a fact about the user's life was wrong and what is true now. Use when the user explicitly corrects a fact.",
      parameters: Type.Object({
        topic: Type.String({ minLength: 1, description: "What the correction is about" }),
        previous: Type.String({ minLength: 1, description: "The earlier, wrong belief" }),
        corrected: Type.String({ minLength: 1, description: "The corrected belief, in the user's words" }),
        note: Type.Optional(Type.String({ description: "Optional context" })),
      }),
      execute: async (_id, params, _signal, _update, ctx) => {
        const journey = await requireJourney(ctx);
        return receiptResult(await recordCorrection({ journey, root: ctx.cwd, sessionId: sessionId(ctx), now }, { ...params, note: params.note }));
      },
    });
  };
}
