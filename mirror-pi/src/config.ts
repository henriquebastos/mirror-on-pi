// Read a Mirror profile. A profile names the content vault and the AI Memory service.
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { isRecord, parseJson, stringField, type JsonRecord } from "./json.ts";
import { err, ok, type Result } from "./result.ts";
import { validateSlug } from "./slug.ts";

export type MemoryProfile = {
  readonly url: string;
  readonly workspace: string;
  readonly tokenFile: string | undefined;
  readonly tokenEnv: string | undefined;
};

export type ModelProfile = {
  readonly provider: string;
  readonly id: string;
  readonly thinking: string | undefined;
};

export type MirrorProfile = {
  readonly path: string;
  readonly contentDir: string;
  readonly piAgentDir: string;
  readonly memory: MemoryProfile;
  readonly model: ModelProfile | undefined;
};

export async function loadProfile(path: string): Promise<Result<MirrorProfile, string>> {
  let data: unknown;
  try {
    data = parseJson(await readFile(path, "utf8"));
  } catch (error) {
    return err(`Cannot read profile ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseProfile(data, path);
}

export function parseProfile(data: unknown, path: string): Result<MirrorProfile, string> {
  if (!isRecord(data)) return err("Profile must be a JSON object");
  const base = dirname(path);
  const contentDir = stringField(data, "contentDir");
  const piAgentDir = stringField(data, "piAgentDir");
  const memory = data.memory;
  if (contentDir === undefined) return err("Profile needs contentDir");
  if (piAgentDir === undefined) return err("Profile needs piAgentDir");
  if (!isRecord(memory)) return err("Profile needs a memory object");
  const parsedMemory = parseMemory(memory, base);
  if (!parsedMemory.ok) return parsedMemory;
  const model = data.model === undefined ? ok(undefined) : parseModel(data.model);
  if (!model.ok) return model;
  return ok({
    path,
    contentDir: resolvePath(base, contentDir),
    piAgentDir: resolvePath(base, piAgentDir),
    memory: parsedMemory.value,
    model: model.value,
  });
}

// No token is a valid answer (AI Memory without authentication); an unreadable token file is an error.
export async function readMemoryToken(memory: MemoryProfile, env: NodeJS.ProcessEnv): Promise<Result<string | undefined, string>> {
  if (memory.tokenEnv !== undefined) {
    const value = env[memory.tokenEnv]?.trim();
    if (value !== undefined && value !== "") return ok(value);
  }
  if (memory.tokenFile === undefined) return ok(undefined);
  let text: string;
  try {
    text = await readFile(memory.tokenFile, "utf8");
  } catch (error) {
    return err(`Cannot read the AI Memory token file ${memory.tokenFile}: ${error instanceof Error ? error.message : String(error)}. Run scripts/ai-memory.sh up.`);
  }
  const token = tokenLine(text);
  return token === undefined ? err(`${memory.tokenFile} has no AI_MEMORY_AUTH_TOKEN line`) : ok(token);
}

function tokenLine(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*AI_MEMORY_AUTH_TOKEN\s*=\s*(\S+)\s*$/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

function parseMemory(memory: JsonRecord, base: string): Result<MemoryProfile, string> {
  const url = stringField(memory, "url");
  const workspace = stringField(memory, "workspace");
  if (url === undefined) return err("memory.url is required");
  if (workspace === undefined) return err("memory.workspace is required");
  const validWorkspace = validateSlug(workspace);
  if (!validWorkspace.ok) return err(`memory.workspace: ${validWorkspace.error}`);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return err(`memory.url is not a URL: ${url}`);
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return err("memory.url must use http or https");
  const tokenFile = stringField(memory, "tokenFile");
  return ok({
    url: parsedUrl.toString().replace(/\/+$/, ""),
    workspace,
    tokenFile: tokenFile === undefined ? undefined : resolvePath(base, tokenFile),
    tokenEnv: stringField(memory, "tokenEnv"),
  });
}

function parseModel(model: unknown): Result<ModelProfile, string> {
  if (!isRecord(model)) return err("model must be an object");
  const provider = stringField(model, "provider");
  const id = stringField(model, "id");
  if (provider === undefined || id === undefined) return err("model needs provider and id");
  return ok({ provider, id, thinking: stringField(model, "thinking") });
}

function resolvePath(base: string, value: string): string {
  if (value.startsWith("~/")) return resolve(process.env.HOME ?? "/", value.slice(2));
  return isAbsolute(value) ? value : resolve(base, value);
}
