// A journey is a directory that holds one durable topic of the user's life: a directory directly below the vault's
// `journeys/`, or a directory listed in the `## Journeys` section of the vault's AGENTS.md, which can be anywhere in the vault.
// A session enters a journey when the model enters it, following the user; the latest `mirror-journey` entry on the
// session branch names the journey. A JOURNEY.md in the cwd supplies the default journey, without a parent search.
// A journey's `JOURNEY.md` holds its context for the mirror only. It is not an AGENTS.md, so other agents do not load it.
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
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

// The journey's context, in the journey directory.
export const JOURNEY_FILE = "JOURNEY.md";

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

// Every local journey, sorted by slug. For the same slug, cwd precedes the map, which precedes `journeys/`.
// A listed directory that does not exist on this machine, or that is not inside the vault, is left out.
export async function listJourneys(vault: string): Promise<JourneySummary[]> {
  const found = new Map<string, Journey>();
  const local = await localJourney(vault);
  for (const journey of [...(local === undefined ? [] : [local]), ...(await listedJourneys(vault)), ...(await journeysDirectory(vault))]) {
    if (!found.has(journey.slug)) found.set(journey.slug, journey);
  }
  const journeys = [...found.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  return Promise.all(journeys.map(async (journey) => ({ ...journey, path: journey.dir === resolve(vault) ? "./" : `${relative(vault, journey.dir)}/`, description: await journeyDescription(journey) })));
}

export async function findJourneyBySlug(vault: string, slug: string): Promise<JourneySummary | undefined> {
  return (await listJourneys(vault)).find((journey) => journey.slug === slug);
}

// A JOURNEY.md in the session directory makes that directory the default journey. No parent is searched.
export async function localJourney(cwd: string): Promise<Journey | undefined> {
  if ((await stat(join(cwd, JOURNEY_FILE)).catch(() => undefined))?.isFile() !== true) return undefined;
  const dir = resolve(cwd);
  return { dir, slug: basename(dir) };
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
  return readFile(join(journey.dir, JOURNEY_FILE), "utf8").catch(() => "");
}

// The mirror_journey system prompt section: the session's journey and its context, or the journeys to choose from.
export async function journeySection(vault: string, slug: string | undefined): Promise<string | undefined> {
  const journeys = await listJourneys(vault);
  if (journeys.length === 0 && slug === undefined) return undefined;
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
