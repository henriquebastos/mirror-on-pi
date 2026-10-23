// Pi entry point. The `mirror` launcher sets MIRROR_PROFILE and MIRROR_JOURNEY.
// Without a valid profile and journey, the extension blocks every prompt instead of running unconfigured.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadProfile, readMemoryToken } from "../src/config.ts";
import { createMirrorExtension } from "../src/extension.ts";
import { MemoryClient } from "../src/memory-client.ts";

const MODE_PROMPT = fileURLToPath(new URL("../prompts/mirror-mode.md", import.meta.url));

export default async function mirror(pi: ExtensionAPI): Promise<void> {
  const profilePath = process.env.MIRROR_PROFILE;
  const journey = process.env.MIRROR_JOURNEY;
  if (profilePath === undefined || journey === undefined) {
    blockAll(pi, "Start Mirror with the mirror launcher (MIRROR_PROFILE and MIRROR_JOURNEY are not set).");
    return;
  }
  const profile = await loadProfile(profilePath);
  if (!profile.ok) {
    blockAll(pi, profile.error);
    return;
  }
  const persona = process.env.MIRROR_PERSONA;
  const token = await readMemoryToken(profile.value.memory, process.env);
  createMirrorExtension({
    contentDir: profile.value.contentDir,
    workspace: profile.value.memory.workspace,
    journey,
    persona: persona === undefined || persona === "" ? undefined : persona,
    organization: process.env.MIRROR_ORGANIZATION === "1",
    modePrompt: await readFile(MODE_PROMPT, "utf8"),
    client: new MemoryClient(profile.value.memory.url, token),
  })(pi);
}

function blockAll(pi: ExtensionAPI, reason: string): void {
  pi.on("input", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.notify(`Mirror is blocked: ${reason}`, "error");
    else console.error(`Mirror is blocked: ${reason}`);
    return { action: "handled" };
  });
}
