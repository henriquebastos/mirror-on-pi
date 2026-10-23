// Where the AI Memory service is. Mirror's extensions read `ai-memory.json` from the Pi agent directory:
// { "url": "http://127.0.0.1:49390", "tokenFile": "../ai-memory/.env" }
// An optional "tokenEnv" names a variable that wins over the file. Do not name a variable that holds another server's token.
// A relative `tokenFile` resolves from the config file.
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isRecord, parseJson, stringField } from "./json.ts";
import { MemoryClient } from "./memory-client.ts";
import { err, ok, type Result } from "./result.ts";

export const CONFIG_FILE = "ai-memory.json";

export type MemoryConfig = {
  readonly url: string;
  readonly tokenFile: string | undefined;
  readonly tokenEnv: string | undefined;
};

export async function loadMemoryClient(agentDir: string, env: NodeJS.ProcessEnv = process.env): Promise<Result<MemoryClient, string>> {
  const config = await loadMemoryConfig(join(agentDir, CONFIG_FILE));
  if (!config.ok) return config;
  const token = await readMemoryToken(config.value, env);
  if (!token.ok) return token;
  return ok(new MemoryClient(config.value.url, token.value));
}

export async function loadMemoryConfig(path: string): Promise<Result<MemoryConfig, string>> {
  let data: unknown;
  try {
    data = parseJson(await readFile(path, "utf8"));
  } catch (error) {
    return err(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseMemoryConfig(data, dirname(path));
}

export function parseMemoryConfig(data: unknown, base: string): Result<MemoryConfig, string> {
  if (!isRecord(data)) return err("AI Memory config must be a JSON object");
  const url = stringField(data, "url");
  if (url === undefined || !/^https?:\/\//.test(url)) return err("AI Memory config needs an http or https url");
  const tokenFile = stringField(data, "tokenFile");
  return ok({
    url: url.replace(/\/+$/, ""),
    tokenFile: tokenFile === undefined || isAbsolute(tokenFile) ? tokenFile : resolve(base, tokenFile),
    tokenEnv: stringField(data, "tokenEnv"),
  });
}

// No token is a valid answer (AI Memory without authentication); an unreadable token file is an error.
export async function readMemoryToken(config: MemoryConfig, env: NodeJS.ProcessEnv): Promise<Result<string | undefined, string>> {
  if (config.tokenEnv !== undefined) {
    const value = env[config.tokenEnv]?.trim();
    if (value !== undefined && value !== "") return ok(value);
  }
  if (config.tokenFile === undefined) return ok(undefined);
  let text: string;
  try {
    text = await readFile(config.tokenFile, "utf8");
  } catch (error) {
    return err(`Cannot read the AI Memory token file ${config.tokenFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const token = /^\s*AI_MEMORY_AUTH_TOKEN\s*=\s*(\S+)\s*$/m.exec(text)?.[1];
  return token === undefined ? err(`${config.tokenFile} has no AI_MEMORY_AUTH_TOKEN line`) : ok(token);
}
