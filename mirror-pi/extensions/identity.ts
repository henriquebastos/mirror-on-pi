// The identity in every session at the vault root: the hard constraints and the identity map join the system prompt.
// Soul Mode integrations: the only identity change. The user's own message agreeing to the proposed text is the confirmation;
// the Soul skill tells the model to call the tool only after it.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { identitySection } from "../src/identity-context.ts";
import { findVault, planIntegration, writeIntegration } from "../src/identity.ts";
import { isSubagent } from "../src/pi.ts";

export default function identity(pi: ExtensionAPI): void {
  createIdentityExtension()(pi);
}

export function createIdentityExtension(now: () => Date = () => new Date()): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on("before_agent_start", async (event, ctx) => {
      const vault = isSubagent() ? undefined : await findVault(ctx.cwd);
      const section = vault === undefined ? undefined : await identitySection(vault);
      if (section !== undefined) event.systemPromptOptions.sections.mirror_identity = section;
    });

    pi.registerTool({
      name: "mirror_integrate_identity",
      label: "Integrate into identity",
      description:
        "Append one Soul Mode integration to the user's identity. Use only after the user has seen the exact text in an Integration Proposal and, in their own message, agreed to record it. " +
        "Self goes to self/soul.md, shadow to shadow/profile.md, ego to ego/behavior.md, persona to personas/<id>.md.",
      parameters: Type.Object({
        layer: Type.Union([Type.Literal("self"), Type.Literal("shadow"), Type.Literal("ego"), Type.Literal("persona")], { description: "The identity layer" }),
        persona: Type.Optional(Type.String({ description: "Persona id, only for the persona layer" })),
        text: Type.String({ minLength: 1, description: "The exact text the user agreed to, as one paragraph" }),
      }),
      execute: async (_id, params, _signal, _update, ctx) => {
        const vault = await findVault(ctx.cwd);
        if (vault === undefined) throw new Error(`No identity/ directory at or above ${ctx.cwd}. Nothing was written.`);
        const target = await planIntegration(vault, { layer: params.layer, persona: params.persona, text: params.text }, now());
        if (!target.ok) throw new Error(`${target.error}. Nothing was written.`);
        await writeIntegration(target.value);
        const text = `Added to ${target.value.relativePath} under "## ${target.value.section}": ${target.value.bullet}`;
        return { content: [{ type: "text", text }], details: { written: true, file: target.value.relativePath, section: target.value.section } };
      },
    });
  };
}
