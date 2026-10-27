// Journeys for sessions at the vault root: the model enters the journey the conversation is about, following the user,
// and the journey's context joins the system prompt from the next message on. The user corrects a wrong journey in the chat.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { boundSlug, JOURNEY_ENTRY, localJourney, journeySection, listJourneys, type JourneyEntry } from "../src/journey.ts";
import { isSubagent, type ToolText } from "../src/pi.ts";

export default function journeys(pi: ExtensionAPI): void {
  createJourneysExtension()(pi);
}

export function createJourneysExtension(): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on("before_agent_start", async (event, ctx) => {
      if (isSubagent()) return;
      // A local JOURNEY.md supplies the default until the session explicitly enters another journey.
      const slug = boundSlug(ctx.sessionManager.getBranch()) ?? (await localJourney(ctx.cwd))?.slug;
      const section = await journeySection(ctx.cwd, slug);
      if (section !== undefined) event.systemPromptOptions.sections.mirror_journey = section;
    });

    pi.registerTool({
      name: "mirror_enter_journey",
      label: "Enter journey",
      description:
        "Enter the journey this conversation is about. Use it when the topic clearly matches one journey, or when the user names or corrects the journey, before records or journey-specific reflection. " +
        "Also use it to switch when the conversation moves to another journey.",
      parameters: Type.Object({
        slug: Type.String({ minLength: 1, description: "The journey's slug, as the journey list names it" }),
        reason: Type.String({ minLength: 1, description: "One short sentence: why this journey" }),
      }),
      execute: async (_id, params, _signal, _update, ctx) => enterJourney(pi, ctx, params.slug, params.reason),
    });
  };
}

async function enterJourney(pi: ExtensionAPI, ctx: ExtensionContext, slug: string, reason: string): Promise<ToolText> {
  const journeys = await listJourneys(ctx.cwd);
  const journey = journeys.find((item) => item.slug === slug);
  if (journey === undefined) throw new Error(`There is no journey ${slug}. Journeys: ${journeys.map((item) => item.slug).join(", ")}.`);
  const from = boundSlug(ctx.sessionManager.getBranch()) ?? (await localJourney(ctx.cwd))?.slug ?? null;
  if (from === slug) return text(`The session is already in the journey ${slug}.`, { slug });
  pi.appendEntry<JourneyEntry>(JOURNEY_ENTRY, { slug, from, reason });
  pi.setSessionName(slug);
  return text(`Entered the journey ${slug}. Its context joins the system prompt from the user's next message. Read ${journey.path}JOURNEY.md now if this answer needs it.`, { slug, from });
}

function text(message: string, details: Readonly<Record<string, unknown>>): ToolText {
  return { content: [{ type: "text", text: message }], details };
}
