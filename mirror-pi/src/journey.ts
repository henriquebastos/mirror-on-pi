// A journey is a directory that holds one durable topic of the user's life: a directory directly below the vault's
// `journeys/`, or a directory listed in the `## Journeys` section of the vault's AGENTS.md, which can be anywhere in the vault.
// A session enters a journey when the model enters it, following the user; the latest `mirror-journey` entry on the
// session branch names the journey. A session started inside a journey directory belongs to that journey.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { isRecord, stringField } from "./json.ts";
import { parseMarkdown } from "./markdown.ts";

export type Journey = {
  readonly dir: string;
  readonly slug: string;
};

export type JourneySummary = Journey & {
  // The directory relative to the vault, with a trailing slash.
  readonly path: string;
  readonly description: string;
};

// The session entry that holds Mirror's journey state. It does not enter the model's context.
export const JOURNEY_ENTRY = "mirror-journey";

// The user's map of the vault. Its `## Journeys` section lists journeys outside `journeys/`.
export const VAULT_MAP = "AGENTS.md";

// Entering or switching a journey. A switch right after an entry is a correction: the evidence for a later decision model.
// Entries written before the reason was recorded hold only the slug.
export type JourneyEntry = {
  readonly slug: string;
  readonly from: string | null;
  readonly reason: string;
};

type EntryLike = { readonly type: string; readonly customType?: string; readonly data?: unknown };

const JOURNEYS_HEADING = /^##\s+Journeys\s*$/;
const LIST_ITEM = /^[-*]\s+`([a-z0-9][a-z0-9-]*)`\s*:\s*`([^`]+)`/;

// The journey named by the latest journey entry on the branch, if any.
export function boundSlug(branch: readonly EntryLike[]): string | undefined {
  const entry = branch.findLast((item) => item.type === "custom" && item.customType === JOURNEY_ENTRY && isRecord(item.data));
  return isRecord(entry?.data) ? stringField(entry.data, "slug") : undefined;
}

// Every journey of the vault, sorted by slug. A listed journey comes before a directory below `journeys/` with the same slug.
// A listed directory that does not exist on this machine, or that is not inside the vault, is left out.
export async function listJourneys(vault: string): Promise<JourneySummary[]> {
  const found = new Map<string, Journey>();
  for (const journey of [...(await listedJourneys(vault)), ...(await journeysDirectory(vault))]) {
    if (!found.has(journey.slug)) found.set(journey.slug, journey);
  }
  const journeys = [...found.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  return Promise.all(journeys.map(async (journey) => ({ ...journey, path: `${relative(vault, journey.dir)}/`, description: await journeyDescription(journey) })));
}

export async function findJourneyBySlug(vault: string, slug: string): Promise<JourneySummary | undefined> {
  return (await listJourneys(vault)).find((journey) => journey.slug === slug);
}

// The journey whose directory is the working directory or one of its parents; the deepest one when journeys are nested.
export async function journeyAt(vault: string, cwd: string): Promise<JourneySummary | undefined> {
  const here = resolve(cwd);
  const containing = (await listJourneys(vault)).filter((journey) => here === journey.dir || here.startsWith(journey.dir + sep));
  return containing.sort((a, b) => b.dir.length - a.dir.length)[0];
}

async function listedJourneys(vault: string): Promise<Journey[]> {
  const map = await readFile(join(vault, VAULT_MAP), "utf8").catch(() => "");
  const items = journeysSection(map).flatMap((line) => {
    const match = LIST_ITEM.exec(line.trim());
    return match?.[1] === undefined || match[2] === undefined ? [] : [{ slug: match[1], dir: resolve(vault, match[2]) }];
  });
  const inside = items.filter((item) => item.dir.startsWith(resolve(vault) + sep));
  const exists = await Promise.all(inside.map(async (item) => isDirectory(item.dir)));
  return inside.filter((_item, index) => exists[index] === true);
}

// The lines of the `## Journeys` section, up to the next heading.
function journeysSection(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => JOURNEYS_HEADING.test(line));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("#"));
  return end === -1 ? rest : rest.slice(0, end);
}

async function journeysDirectory(vault: string): Promise<Journey[]> {
  const entries = await readdir(join(vault, "journeys"), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => ({ slug: entry.name, dir: join(vault, "journeys", entry.name) }));
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() === true;
}

async function journeyDescription(journey: Journey): Promise<string> {
  const document = parseMarkdown(await readJourneyContext(journey));
  if (!document.ok) return "";
  return stringField(document.value.frontmatter, "description") ?? document.value.body.split("\n").find((line) => line.trim() !== "" && !line.startsWith("#")) ?? "";
}

export async function readJourneyContext(journey: Journey): Promise<string> {
  return readFile(join(journey.dir, "AGENTS.md"), "utf8").catch(() => "");
}

// The system prompt section for a session at the vault root: the bound journey's context, or the journeys to choose from.
export async function journeySection(vault: string, slug: string | undefined): Promise<string> {
  const journeys = await listJourneys(vault);
  if (slug === undefined) {
    const list = journeys.map((journey) => `- \`${journey.slug}\` in \`${journey.path}\`: ${journey.description}`).join("\n");
    return `This session has no journey yet.\n\nJourneys in this vault:\n${list}`;
  }
  const journey = journeys.find((item) => item.slug === slug);
  const others = journeys.filter((item) => item.slug !== slug).map((item) => `\`${item.slug}\``).join(", ");
  const context = journey === undefined ? undefined : parseMarkdown(await readJourneyContext(journey));
  const body = context?.ok === true ? context.value.body : "";
  const where = journey === undefined ? "Its directory is no longer in the vault." : `Directory \`${journey.path}\`.`;
  return `This session is in the journey \`${slug}\`. ${where} Other journeys: ${others === "" ? "none" : others}.\n\n${body}`;
}
