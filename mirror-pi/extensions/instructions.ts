// Mirror's instructions in every session in a vault: how the mirror answers, uses the identity and journeys, and searches
// earlier sessions. They come from the release, so the vault's own AGENTS.md stays the user's map of the vault.
// A subagent gets none of them: it is the agent it was started as.
import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findVault } from "../src/identity.ts";
import { isSubagent } from "../src/pi.ts";

const INSTRUCTIONS = new URL("../instructions.md", import.meta.url);

export default function instructions(pi: ExtensionAPI): void {
  createInstructionsExtension()(pi);
}

export function createInstructionsExtension(): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on("before_agent_start", async (event, ctx) => {
      if (isSubagent() || (await findVault(ctx.cwd)) === undefined) return;
      event.systemPromptOptions.sections.mirror_instructions = await readFile(INSTRUCTIONS, "utf8");
    });
  };
}
