// Compose the identity context in Mirror's section order.
// Hard constraints come first. Knowledge keys are sorted. The journey comes last.
import type { IdentityDocuments, Journey } from "./content.ts";
import { err, ok, type Result } from "./result.ts";

export type CompositionOptions = {
  readonly persona: string | undefined;
  readonly organization: boolean;
  readonly journey: Journey;
};

export type Section = { readonly label: string; readonly body: string };

export function composeSections(identity: IdentityDocuments, options: CompositionOptions): Result<readonly Section[], string> {
  const sections: Section[] = [];
  const add = (label: string, body: string | undefined): void => {
    if (body !== undefined && body !== "") sections.push({ label, body });
  };
  add("⛔ HARD CONSTRAINTS", identity.constraints);
  add("self/soul", identity.soul);
  add("ego/behavior", identity.behavior);
  add("user/identity", identity.user);
  add("ego/identity", identity.ego);
  if (options.organization) {
    add("organization/identity", identity.organizationIdentity);
    add("organization/principles", identity.organizationPrinciples);
  }
  if (options.persona !== undefined) {
    const persona = identity.personas.get(options.persona);
    if (persona === undefined) return err(`Persona "${options.persona}" does not exist`);
    add(`persona/${options.persona}`, persona);
  }
  for (const entry of identity.knowledge) add(`knowledge/${entry.key}`, entry.body);
  add(`journey/${options.journey.slug}`, renderJourney(options.journey));
  return ok(sections);
}

export function renderSections(sections: readonly Section[]): string {
  return sections.map((section) => `=== ${section.label} ===\n${section.body}`).join("\n\n");
}

export function renderJourney(journey: Journey): string {
  const lines = [`# ${journey.title}`, `**Status:** ${journey.status}`];
  if (journey.description !== undefined) lines.push("", `## Description`, journey.description);
  if (journey.context !== "") lines.push("", journey.context);
  return lines.join("\n");
}
