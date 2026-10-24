// Talk to AI Memory over its MCP interface.
// Every call names its workspace and project explicitly. Nothing relies on server defaults.
import { isRecord, numberField, parseJson, stringField, type JsonRecord } from "./json.ts";
import { err, ok, type Result } from "./result.ts";

export type MemoryScope = { readonly workspace: string; readonly project: string };

export type MemoryError =
  | { readonly kind: "network"; readonly message: string }
  | { readonly kind: "http"; readonly status: number; readonly message: string }
  | { readonly kind: "rpc"; readonly code: number | undefined; readonly message: string; readonly reason: string | undefined }
  | { readonly kind: "tool"; readonly message: string }
  | { readonly kind: "protocol"; readonly message: string };

export type QueryHit = {
  readonly path: string;
  readonly title: string;
  readonly snippet: string;
};

export type PageInput = {
  readonly path: string;
  readonly body: string;
  readonly tier: "episodic" | "semantic";
  readonly pinned: boolean;
  readonly tags: readonly string[];
  readonly createOnly: boolean;
  readonly sessionId: string | undefined;
};

export type MemoryPage = { readonly path: string; readonly body: string; readonly frontmatter: JsonRecord };

export type WrittenPage = { readonly pageId: string; readonly path: string };

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 10_000;

export class MemoryClient {
  readonly #url: string;
  readonly #token: string | undefined;
  readonly #fetch: Fetch;
  #requestId = 0;

  constructor(url: string, token: string | undefined, fetchImpl: Fetch = fetch) {
    this.#url = url.replace(/\/+$/, "");
    this.#token = token;
    this.#fetch = fetchImpl;
  }

  async query(scope: MemoryScope, query: string, limit: number, signal?: AbortSignal): Promise<Result<readonly QueryHit[], MemoryError>> {
    const result = await this.callTool("memory_query", { ...scope, query, limit, pin_first: true }, signal);
    if (!result.ok) return result;
    return parseHits(result.value);
  }

  async recent(scope: MemoryScope, limit: number, signal?: AbortSignal): Promise<Result<readonly QueryHit[], MemoryError>> {
    const result = await this.callTool("memory_recent", { ...scope, limit }, signal);
    if (!result.ok) return result;
    return parseHits(result.value);
  }

  async writePage(scope: MemoryScope, page: PageInput, signal?: AbortSignal): Promise<Result<WrittenPage, MemoryError>> {
    const args: Record<string, unknown> = {
      ...scope,
      path: page.path,
      body: page.body,
      tier: page.tier,
      pinned: page.pinned,
      tags: page.tags,
      create_only: page.createOnly,
    };
    if (page.sessionId !== undefined) args.session_id = page.sessionId;
    const result = await this.callTool("memory_write_page", args, signal);
    if (!result.ok) return result;
    const pageId = stringField(result.value, "page_id") ?? stringField(result.value, "id");
    const path = stringField(result.value, "path");
    if (pageId === undefined || path === undefined) return err({ kind: "protocol", message: "memory_write_page returned no page_id or path" });
    return ok({ pageId, path });
  }

  async readPage(scope: MemoryScope, path: string, signal?: AbortSignal): Promise<Result<MemoryPage, MemoryError>> {
    const result = await this.callTool("memory_read_page", { ...scope, path }, signal);
    if (!result.ok) return result;
    const body = stringField(result.value, "body");
    if (body === undefined) return err({ kind: "protocol", message: "memory_read_page returned no body" });
    const frontmatter = result.value.frontmatter;
    return ok({ path: stringField(result.value, "path") ?? path, body, frontmatter: isRecord(frontmatter) ? frontmatter : {} });
  }

  // Check reachability and authentication without touching any memory scope.
  async ping(signal?: AbortSignal): Promise<Result<readonly string[], MemoryError>> {
    const id = ++this.#requestId;
    const response = await this.#post("/mcp", { jsonrpc: "2.0", id, method: "tools/list", params: {} }, signal);
    if (!response.ok) return response;
    const payload = response.value;
    if (!isRecord(payload) || !isRecord(payload.result) || !Array.isArray(payload.result.tools)) {
      return err({ kind: "protocol", message: "tools/list returned no tools" });
    }
    return ok(payload.result.tools.filter(isRecord).map((tool) => stringField(tool, "name") ?? "").filter((name) => name !== ""));
  }

  async callTool(name: string, args: JsonRecord, signal?: AbortSignal): Promise<Result<JsonRecord, MemoryError>> {
    const id = ++this.#requestId;
    const response = await this.#post("/mcp", { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, signal);
    if (!response.ok) return response;
    return parseToolResponse(response.value, name);
  }

  async #post(path: string, body: unknown, signal: AbortSignal | undefined): Promise<Result<unknown, MemoryError>> {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    if (this.#token !== undefined) headers.Authorization = `Bearer ${this.#token}`;
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.#fetch(`${this.#url}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      });
    } catch (error) {
      return err({ kind: "network", message: error instanceof Error ? error.message : String(error) });
    }
    const text = await response.text();
    if (!response.ok && response.status !== 429) return err({ kind: "http", status: response.status, message: text.slice(0, 500) });
    try {
      return ok(parseJson(stripEventStream(text)));
    } catch {
      return err({ kind: "protocol", message: `Response from ${path} is not JSON` });
    }
  }
}

export function stripEventStream(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("event:") && !trimmed.startsWith("data:")) return trimmed;
  return trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("");
}

export function parseToolResponse(payload: unknown, tool: string): Result<JsonRecord, MemoryError> {
  if (!isRecord(payload)) return err({ kind: "protocol", message: `${tool}: response is not an object` });
  if (isRecord(payload.error)) return err(rpcError(payload.error));
  const result = payload.result;
  if (!isRecord(result)) return err({ kind: "protocol", message: `${tool}: response has no result` });
  const text = firstText(result.content);
  if (result.isError === true) return err({ kind: "tool", message: text ?? `${tool} failed` });
  if (text === undefined) return err({ kind: "protocol", message: `${tool}: result has no text content` });
  let parsed: unknown;
  try {
    parsed = parseJson(text);
  } catch {
    return err({ kind: "protocol", message: `${tool}: result text is not JSON` });
  }
  if (!isRecord(parsed)) return err({ kind: "protocol", message: `${tool}: result is not an object` });
  return ok(parsed);
}

function rpcError(error: JsonRecord): MemoryError {
  const data = error.data;
  return {
    kind: "rpc",
    code: numberField(error, "code"),
    message: stringField(error, "message") ?? "unknown error",
    reason: isRecord(data) ? stringField(data, "reason") : undefined,
  };
}

export function parseHits(result: JsonRecord): Result<readonly QueryHit[], MemoryError> {
  const hits = result.hits;
  if (!Array.isArray(hits)) return err({ kind: "protocol", message: "query result has no hits array" });
  const parsed: QueryHit[] = [];
  for (const hit of hits) {
    if (!isRecord(hit)) continue;
    const path = stringField(hit, "path");
    if (path === undefined) continue;
    parsed.push({ path, title: stringField(hit, "title") ?? path, snippet: cleanSnippet(stringField(hit, "snippet") ?? "") });
  }
  return ok(parsed);
}

function firstText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    if (isRecord(part) && part.type === "text") {
      const text = stringField(part, "text");
      if (text !== undefined) return text;
    }
  }
  return undefined;
}

function cleanSnippet(snippet: string): string {
  return snippet.replace(/<\/?mark>/g, "").replace(/\s+/g, " ").trim();
}
