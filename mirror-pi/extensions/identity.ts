// Append a Soul Mode integration to an identity file, only after the user confirms the exact text in a dialog.
// The model cannot skip the dialog: without an interactive user, nothing is written.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { findVault, planIntegration, writeIntegration } from "../src/identity.ts";

export default function identity(pi: ExtensionAPI): void {
  createIdentityExtension()(pi);
}

export function createIdentityExtension(now: () => Date = () => new Date()): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.registerTool({
      name: "mirror_integrate_identity",
      label: "Integrate into identity",
      description:
        "Append one confirmed Soul Mode integration to the user's identity. Use only after the user has seen the exact text in an Integration Proposal and agreed to record it. " +
        "The user must confirm the exact text again in a dialog. Self goes to self/soul.md, shadow to shadow/profile.md, ego to ego/behavior.md, persona to personas/<id>.md.",
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
        if (!ctx.hasUI) throw new Error("Identity changes need the user's confirmation in an interactive session. Nothing was written.");
        const confirmed = await ctx.ui.confirm(
          "Add this to your identity?",
          `${target.value.relativePath}, under "## ${target.value.section}":\n\n${target.value.bullet}`,
        );
        if (!confirmed) {
          return { content: [{ type: "text", text: "The user did not confirm. Nothing was written." }], details: { written: false } };
        }
        await writeIntegration(target.value);
        const text = `Added to ${target.value.relativePath} under "## ${target.value.section}": ${target.value.bullet}`;
        return { content: [{ type: "text", text }], details: { written: true, file: target.value.relativePath, section: target.value.section } };
      },
    });
  };
}
