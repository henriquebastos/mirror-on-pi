// Read identity and journey files from the content vault.
// The vault is the authority for identity and journey definitions. These functions never write.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { stringField } from "./json.ts";
import { parseMarkdown } from "./markdown.ts";
import { err, ok, type Result } from "./result.ts";
import { validateSlug } from "./slug.ts";

export type IdentityDocuments = {
  readonly constraints: string | undefined;
  readonly soul: string | undefined;
  readonly behavior: string | undefined;
  readonly user: string | undefined;
  readonly ego: string | undefined;
  readonly organizationIdentity: string | undefined;
  readonly organizationPrinciples: string | undefined;
  readonly personas: ReadonlyMap<string, string>;
  readonly knowledge: readonly { readonly key: string; readonly body: string }[];
};

export type JourneyStatus = "active" | "paused" | "completed";

export type Journey = {
  readonly slug: string;
  readonly title: string;
  readonly status: JourneyStatus;
  readonly description: string | undefined;
  readonly memoryProject: string;
  readonly context: string;
};

export type ContentError = { readonly path: string; readonly message: string };

const IDENTITY_FILES = {
  constraints: "ego/constraints.md",
  soul: "self/soul.md",
  behavior: "ego/behavior.md",
  user: "user/identity.md",
  ego: "ego/identity.md",
  organizationIdentity: "organization/identity.md",
  organizationPrinciples: "organization/principles.md",
} as const;

const REQUIRED_IDENTITY: readonly (keyof typeof IDENTITY_FILES)[] = ["soul", "behavior", "user", "ego"];

export function identityDir(contentDir: string): string {
  return join(contentDir, "identity");
}

export function journeysDir(contentDir: string): string {
  return join(contentDir, "journeys");
}

export function journeyDir(contentDir: string, slug: string): string {
  return join(journeysDir(contentDir), slug);
}

export async function loadIdentity(contentDir: string): Promise<Result<IdentityDocuments, ContentError>> {
  const root = identityDir(contentDir);
  const bodies = new Map<keyof typeof IDENTITY_FILES, string | undefined>();
  for (const [key, relative] of Object.entries(IDENTITY_FILES)) {
    const body = await readBody(join(root, relative));
    if (!body.ok) return body;
    if (!isIdentityKey(key)) throw new Error(`Unknown identity key: ${key}`);
    bodies.set(key, body.value);
  }
  for (const key of REQUIRED_IDENTITY) {
    if (bodies.get(key) === undefined) return err({ path: join(root, IDENTITY_FILES[key]), message: "Required identity file is missing or empty" });
  }
  const personas = await loadNamedDocuments(join(root, "personas"));
  if (!personas.ok) return personas;
  const knowledge = await loadNamedDocuments(join(root, "knowledge"));
  if (!knowledge.ok) return knowledge;
  return ok({
    constraints: bodies.get("constraints"),
    soul: bodies.get("soul"),
    behavior: bodies.get("behavior"),
    user: bodies.get("user"),
    ego: bodies.get("ego"),
    organizationIdentity: bodies.get("organizationIdentity"),
    organizationPrinciples: bodies.get("organizationPrinciples"),
    personas: new Map(knowledgeEntries(personas.value)),
    knowledge: knowledge.value,
  });
}

export async function loadJourney(contentDir: string, slug: string): Promise<Result<Journey, ContentError>> {
  const valid = validateSlug(slug);
  const path = join(journeyDir(contentDir, slug), "journey.md");
  if (!valid.ok) return err({ path, message: valid.error });
  const text = await readOptional(path);
  if (text === undefined) return err({ path, message: `Journey "${slug}" does not exist` });
  const document = parseMarkdown(text);
  if (!document.ok) return err({ path, message: document.error });
  const { frontmatter } = document.value;
  const status = parseStatus(stringField(frontmatter, "status"));
  if (!status.ok) return err({ path, message: status.error });
  const memoryProject = validateSlug(stringField(frontmatter, "memory_project") ?? slug);
  if (!memoryProject.ok) return err({ path, message: `memory_project: ${memoryProject.error}` });
  return ok({
    slug,
    title: stringField(frontmatter, "title") ?? slug,
    status: status.value,
    description: stringField(frontmatter, "description"),
    memoryProject: memoryProject.value,
    context: document.value.body,
  });
}

export async function listJourneys(contentDir: string): Promise<{ readonly journeys: readonly Journey[]; readonly errors: readonly ContentError[] }> {
  const names = await readdir(journeysDir(contentDir), { withFileTypes: true }).catch(missingAsEmpty);
  const journeys: Journey[] = [];
  const errors: ContentError[] = [];
  for (const entry of [...names].sort((a, b) => compareKeys(a.name, b.name))) {
    if (!entry.isDirectory()) continue;
    const journey = await loadJourney(contentDir, entry.name);
    if (journey.ok) journeys.push(journey.value);
    else errors.push(journey.error);
  }
  return { journeys, errors };
}

// Sort keys in plain code-unit order. Callers pass keys without the ".md" extension,
// so "a" sorts before "a-b" as it does for identity keys.
export function compareKeys(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function parseStatus(value: string | undefined): Result<JourneyStatus, string> {
  switch (value) {
    case undefined:
    case "active":
      return ok("active");
    case "paused":
    case "completed":
      return ok(value);
    default:
      return err(`status must be active, paused, or completed, not "${value}"`);
  }
}

async function loadNamedDocuments(dir: string): Promise<Result<readonly { readonly key: string; readonly body: string }[], ContentError>> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(missingAsEmpty);
  const documents: { key: string; body: string }[] = [];
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
  const keyed = files.map((entry) => ({ key: entry.name.slice(0, -".md".length), name: entry.name }));
  keyed.sort((a, b) => compareKeys(a.key, b.key));
  for (const { key, name } of keyed) {
    const valid = validateSlug(key);
    if (!valid.ok) return err({ path: join(dir, name), message: valid.error });
    const body = await readBody(join(dir, name));
    if (!body.ok) return body;
    if (body.value !== undefined) documents.push({ key, body: body.value });
  }
  return ok(documents);
}

function knowledgeEntries(documents: readonly { readonly key: string; readonly body: string }[]): [string, string][] {
  return documents.map((document) => [document.key, document.body]);
}

function isIdentityKey(key: string): key is keyof typeof IDENTITY_FILES {
  return Object.hasOwn(IDENTITY_FILES, key);
}

async function readBody(path: string): Promise<Result<string | undefined, ContentError>> {
  const text = await readOptional(path);
  if (text === undefined) return ok(undefined);
  const document = parseMarkdown(text);
  if (!document.ok) return err({ path, message: document.error });
  return ok(document.value.body === "" ? undefined : document.value.body);
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

function missingAsEmpty(error: unknown): never[] {
  if (isMissing(error)) return [];
  throw error;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
