// Model credentials for evals and experiments. A checkout reads no personal files: Pi's auth file is used only when
// MIRROR_EVAL_AUTH names it, and otherwise each provider's key comes from its environment variable, as in CI.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord, parseJson, stringField } from "../../src/json.ts";
import { REPO } from "./content.ts";

const named = process.env.MIRROR_EVAL_AUTH;
export const EVAL_AUTH: string | undefined = named === undefined || named === "" ? undefined : named;

// The provider keys that Pi reads from the environment and that evals pass on to their isolated processes.
export const KEY_VARIABLES = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"] as const;

// An Anthropic subscription (OAuth) works only with this request patch loaded; an API key needs no patch.
export const ANTHROPIC_PATCH = join(REPO, "node_modules", "pi-cc-patch", "index.ts");

export function keyEnv(): Record<string, string> {
  return Object.fromEntries(KEY_VARIABLES.flatMap((name) => {
    const value = process.env[name];
    return value === undefined || value === "" ? [] : [[name, value]];
  }));
}

// The kind of the stored credential for a provider in the named auth file: "oauth", "api_key", or undefined.
export function storedKind(provider: string): string | undefined {
  if (EVAL_AUTH === undefined) return undefined;
  const auth: unknown = parseJson(readFileSync(EVAL_AUTH, "utf8"));
  const entry = isRecord(auth) ? auth[provider] : undefined;
  return isRecord(entry) ? stringField(entry, "type") : undefined;
}

export function needsAnthropicPatch(provider: string): boolean {
  return provider === "anthropic" && storedKind("anthropic") === "oauth";
}

// Whether a model can be reached: a stored credential, or the provider's key in the environment.
export function hasCredential(provider: string): boolean {
  if (storedKind(provider) !== undefined) return true;
  const variable = KEY_VARIABLES.find((name) => name.startsWith(`${provider.toUpperCase()}_`));
  return variable !== undefined && keyEnv()[variable] !== undefined;
}
