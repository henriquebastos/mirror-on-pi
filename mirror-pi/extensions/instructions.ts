// Mirror's instructions in every non-subagent session with this extension loaded: how the mirror answers, uses the identity and journeys, and searches
// earlier sessions. They come from the release, so the vault's own AGENTS.md stays the user's map of the vault.
// A subagent gets none of them: it is the agent it was started as.
import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isSubagent } from "../src/pi.ts";

const INSTRUCTIONS = new URL("../instructions.md", import.meta.url);

export default function instructions(pi: ExtensionAPI): void {
  createInstructionsExtension()(pi);
}

export function createInstructionsExtension(): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on("before_agent_start", async (event) => {
      if (isSubagent()) return;
      event.systemPromptOptions.sections.mirror_instructions = await readFile(INSTRUCTIONS, "utf8");
    });
  };
}
