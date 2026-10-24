import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryClient, parseToolResponse, stripEventStream } from "../../src/memory-client.ts";

function client(respond: (body: unknown) => Response): { client: MemoryClient; requests: { url: string; headers: Headers; body: unknown }[] } {
  const requests: { url: string; headers: Headers; body: unknown }[] = [];
  return {
    requests,
    client: new MemoryClient("http://memory.test/", "secret", (url, init) => {
      const body: unknown = JSON.parse(typeof init.body === "string" ? init.body : "null");
      requests.push({ url, headers: new Headers(init.headers), body });
      return Promise.resolve(respond(body));
    }),
  };
}

const toolText = (value: unknown): Response => Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(value) }], isError: false } });

test("queries send explicit scope and bearer token and clean snippets", async () => {
  const { client: memory, requests } = client(() => toolText({ hits: [{ path: "corrections/a.md", title: "A", snippet: "late <mark>calls</mark>\n on  Wednesday" }, { title: "no path" }] }));
  const hits = await memory.query({ workspace: "mirror", project: "health" }, "calls", 5);
  assert.deepEqual(hits, { ok: true, value: [{ path: "corrections/a.md", title: "A", snippet: "late calls on Wednesday" }] });
  const [request] = requests;
  assert.ok(request !== undefined);
  assert.equal(request.url, "http://memory.test/mcp");
  assert.equal(request.headers.get("authorization"), "Bearer secret");
  assert.deepEqual(request.body, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "memory_query", arguments: { workspace: "mirror", project: "health", query: "calls", limit: 5, pin_first: true } } });
});

test("JSON-RPC errors, tool errors, HTTP errors, and network errors are values", async () => {
  const rpc = parseToolResponse({ error: { code: -32600, message: "precondition", data: { reason: "precondition_failed" } } }, "memory_write_page");
  assert.deepEqual(rpc, { ok: false, error: { kind: "rpc", code: -32600, message: "precondition", reason: "precondition_failed" } });
  const tool = parseToolResponse({ result: { isError: true, content: [{ type: "text", text: "denied" }] } }, "memory_query");
  assert.deepEqual(tool, { ok: false, error: { kind: "tool", message: "denied" } });
  const http = await client(() => new Response("nope", { status: 401 })).client.recent({ workspace: "w", project: "p" }, 3);
  assert.deepEqual(http, { ok: false, error: { kind: "http", status: 401, message: "nope" } });
  const offline = new MemoryClient("http://memory.test", undefined, () => Promise.reject(new Error("ECONNREFUSED")));
  assert.deepEqual(await offline.recent({ workspace: "w", project: "p" }, 3), { ok: false, error: { kind: "network", message: "ECONNREFUSED" } });
});

test("event-stream framing is removed before JSON parsing", () => {
  assert.equal(stripEventStream('event: message\ndata: {"a":1}\n\n'), '{"a":1}');
  assert.equal(stripEventStream('{"a":1}'), '{"a":1}');
});
