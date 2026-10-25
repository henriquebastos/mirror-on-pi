// Journeys for sessions at the vault root: the model enters the journey the conversation is about, following the user,
// and the journey's context joins the system prompt from the next message on. The user corrects a wrong journey in the chat.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { findVault } from "../src/identity.ts";
import { boundSlug, findJourney, JOURNEY_ENTRY, journeySection, listJourneys, type JourneyEntry } from "../src/journey.ts";
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
        "Enter the journey this conversation is about. Use it when the topic clearly matches one journey, or when the user names or corrects the journey, before records or journey-specific reflection. " +
        "Also use it to switch when the conversation moves to another journey.",
      parameters: Type.Object({
        slug: Type.String({ minLength: 1, description: "The journey's directory name below journeys/" }),
        reason: Type.String({ minLength: 1, description: "One short sentence: why this journey" }),
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
  pi.appendEntry<JourneyEntry>(JOURNEY_ENTRY, { slug, from, reason });
  pi.setSessionName(slug);
  return text(`Entered the journey ${slug}. Its context joins the system prompt from the user's next message. Read journeys/${slug}/AGENTS.md now if this answer needs it.`, { slug, from });
}

function text(message: string, details: Readonly<Record<string, unknown>>): ToolText {
  return { content: [{ type: "text", text: message }], details };
}
