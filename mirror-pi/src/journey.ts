// A journey is a directory directly below a vault's `journeys/` directory.
// Pi runs at the vault root. A session enters a journey when the user confirms it; the latest `mirror-journey`
// entry on the session branch names the journey. A session started inside a journey directory belongs to that journey.
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { isRecord, stringField } from "./json.ts";
import { parseMarkdown } from "./markdown.ts";

export type Journey = {
  readonly dir: string;
  readonly slug: string;
};

export type JourneySummary = {
  readonly slug: string;
  readonly description: string;
};

// Session entries that hold Mirror's journey state. Neither enters the model's context.
export const JOURNEY_ENTRY = "mirror-journey";
export const DECISION_ENTRY = "mirror-decision";

export type DecisionOutcome = "confirmed" | "declined" | "no-ui";

// A proposal to enter or switch a journey and the user's answer: the evidence for a later decision model.
export type DecisionRecord = {
  readonly decision: "enter" | "switch";
  readonly slug: string;
  readonly from: string | null;
  readonly reason: string;
  readonly outcome: DecisionOutcome;
};

type EntryLike = { readonly type: string; readonly customType?: string; readonly data?: unknown };

export function findJourney(cwd: string): Journey | undefined {
  for (let dir = resolve(cwd); dirname(dir) !== dir; dir = dirname(dir)) {
    if (basename(dirname(dir)) === "journeys") return { dir, slug: basename(dir) };
  }
  return undefined;
}

// The journey named by the latest journey entry on the branch, if any.
export function boundSlug(branch: readonly EntryLike[]): string | undefined {
  const entry = branch.findLast((item) => item.type === "custom" && item.customType === JOURNEY_ENTRY && isRecord(item.data));
  return isRecord(entry?.data) ? stringField(entry.data, "slug") : undefined;
}

export function journeyIn(vault: string, slug: string): Journey {
  return { dir: join(vault, "journeys", slug), slug };
}

export async function listJourneys(vault: string): Promise<JourneySummary[]> {
  const entries = await readdir(join(vault, "journeys"), { withFileTypes: true }).catch(() => []);
  const slugs = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort();
  return Promise.all(slugs.map(async (slug) => ({ slug, description: await journeyDescription(vault, slug) })));
}

async function journeyDescription(vault: string, slug: string): Promise<string> {
  const text = await readJourneyContext(vault, slug);
  const document = parseMarkdown(text);
  if (!document.ok) return "";
  return stringField(document.value.frontmatter, "description") ?? document.value.body.split("\n").find((line) => line.trim() !== "" && !line.startsWith("#")) ?? "";
}

export async function readJourneyContext(vault: string, slug: string): Promise<string> {
  return readFile(join(vault, "journeys", slug, "AGENTS.md"), "utf8").catch(() => "");
}

// The system prompt section for a session at the vault root: the bound journey's context, or the journeys to choose from.
export async function journeySection(vault: string, slug: string | undefined): Promise<string> {
  const journeys = await listJourneys(vault);
  if (slug === undefined) {
    const list = journeys.map((journey) => `- \`${journey.slug}\`: ${journey.description}`).join("\n");
    return `This session has no journey yet.\n\nJourneys in this vault:\n${list}`;
  }
  const others = journeys.filter((journey) => journey.slug !== slug).map((journey) => `\`${journey.slug}\``).join(", ");
  const context = parseMarkdown(await readJourneyContext(vault, slug));
  const body = context.ok ? context.value.body : "";
  return `This session is in the journey \`${slug}\`, directory \`journeys/${slug}/\`. Other journeys: ${others === "" ? "none" : others}.\n\n${body}`;
}
