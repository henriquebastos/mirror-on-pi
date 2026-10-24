// Journeys for sessions at the vault root: the model proposes a journey, the user confirms it in a dialog,
// and the journey's context joins the system prompt from the next message on. Every proposal is recorded.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { findVault } from "../src/identity.ts";
import { boundSlug, DECISION_ENTRY, findJourney, JOURNEY_ENTRY, journeySection, listJourneys, type DecisionRecord } from "../src/journey.ts";
import type { ToolText } from "../src/pi.ts";

export default function journeys(pi: ExtensionAPI): void {
  createJourneysExtension()(pi);
}

export function createJourneysExtension(): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on("before_agent_start", async (event, ctx) => {
      const vault = await findVault(ctx.cwd);
      // A session started in a journey directory gets the journey's AGENTS.md from Pi's context files.
      if (vault === undefined || findJourney(ctx.cwd) !== undefined) return;
      event.systemPromptOptions.sections.mirror_journey = await journeySection(vault, boundSlug(ctx.sessionManager.getBranch()));
    });

    pi.registerTool({
      name: "mirror_enter_journey",
      label: "Enter journey",
      description:
        "Propose that this conversation continues in a journey. Use it when the conversation's topic matches one journey, before records or journey-specific reflection. " +
        "The user confirms or declines in a dialog. Also use it to switch journeys when the user wants to talk about another journey.",
      parameters: Type.Object({
        slug: Type.String({ minLength: 1, description: "The journey's directory name below journeys/" }),
        reason: Type.String({ minLength: 1, description: "One short sentence for the user, in the user's language: why this journey" }),
      }),
      execute: async (_id, params, _signal, _update, ctx) => enterJourney(pi, ctx, params.slug, params.reason),
    });
  };
}

async function enterJourney(pi: ExtensionAPI, ctx: ExtensionContext, slug: string, reason: string): Promise<ToolText> {
  const vault = await findVault(ctx.cwd);
  if (vault === undefined) throw new Error(`No identity/ directory at or above ${ctx.cwd}. This is not a Mirror vault.`);
  const known = (await listJourneys(vault)).map((journey) => journey.slug);
  if (!known.includes(slug)) throw new Error(`There is no journey ${slug}. Journeys: ${known.join(", ")}.`);
  const from = boundSlug(ctx.sessionManager.getBranch()) ?? null;
  if (from === slug) return text(`The session is already in the journey ${slug}.`, { slug });
  const record = (outcome: DecisionRecord["outcome"]): void => {
    pi.appendEntry<DecisionRecord>(DECISION_ENTRY, { decision: from === null ? "enter" : "switch", slug, from, reason, outcome });
  };
  if (!ctx.hasUI) {
    record("no-ui");
    throw new Error("Entering a journey needs the user's confirmation in an interactive session. The journey did not change.");
  }
  const confirmed = await ctx.ui.confirm(from === null ? `Continue in ${slug}?` : `Switch from ${from} to ${slug}?`, reason);
  record(confirmed ? "confirmed" : "declined");
  if (!confirmed) {
    return text(`The user declined ${slug}. The journey did not change. Do not propose it again unless the user asks.`, { slug, entered: false });
  }
  pi.appendEntry(JOURNEY_ENTRY, { slug });
  pi.setSessionName(slug);
  return text(`Entered the journey ${slug}. Its context joins the system prompt from the user's next message. Read journeys/${slug}/AGENTS.md now if this answer needs it.`, { slug, entered: true });
}

function text(message: string, details: Readonly<Record<string, unknown>>): ToolText {
  return { content: [{ type: "text", text: message }], details };
}
