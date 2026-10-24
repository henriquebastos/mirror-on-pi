// Save a journal entry when the user asks: a Markdown file in the journey's `journal/` directory.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { receiptResult, requireJourney, sessionId } from "../src/pi.ts";
import { saveJournal } from "../src/records.ts";

export default function journal(pi: ExtensionAPI): void {
  createJournalExtension()(pi);
}

export function createJournalExtension(now: () => Date = () => new Date()): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.registerTool({
      name: "mirror_save_journal",
      label: "Save journal entry",
      description: "Save a journal entry for this journey. Use only when the user explicitly asks to save or record a journal entry.",
      parameters: Type.Object({
        title: Type.String({ minLength: 1, description: "Short title in the user's language" }),
        body: Type.String({ minLength: 1, description: "The entry, faithful to the user's words" }),
      }),
      execute: async (_id, params, _signal, _update, ctx) => {
        const journey = requireJourney(ctx.cwd);
        return receiptResult(await saveJournal({ journey, sessionId: sessionId(ctx), now }, params));
      },
    });
  };
}
