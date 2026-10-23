// Save a journal entry when the user asks: a Markdown file in the journey's `journal/` directory,
// published to the journey's AI Memory project so later sessions can recall it.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { MemoryClient } from "../src/memory-client.ts";
import { receiptResult, requireJourney, sessionId, withMemory } from "../src/pi.ts";
import { saveJournal } from "../src/records.ts";

export default async function journal(pi: ExtensionAPI): Promise<void> {
  await withMemory(pi, "Mirror journal", (client) => createJournalExtension(client));
}

export function createJournalExtension(client: MemoryClient, now: () => Date = () => new Date()): (pi: ExtensionAPI) => void {
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
        const journey = await requireJourney(ctx.cwd);
        return receiptResult(await saveJournal(client, { journey, sessionId: sessionId(ctx), now }, params));
      },
    });
  };
}
