import assert from "node:assert/strict";
import { test } from "node:test";
import { CaptureQueue, toHookItem } from "../../src/capture.ts";
import type { HookItem, HookReceipt, MemoryError } from "../../src/memory-client.ts";
import { err, ok, type Result } from "../../src/result.ts";

const scope = { workspace: "mirror", project: "health" };
type Delivery = (items: readonly HookItem[]) => Result<HookReceipt, MemoryError>;

function recording(responses: Delivery[]): { batches: HookItem[][]; deliver: (items: readonly HookItem[]) => Promise<Result<HookReceipt, MemoryError>> } {
  const batches: HookItem[][] = [];
  return {
    batches,
    deliver: (items) => {
      batches.push([...items]);
      const respond = responses.shift();
      if (respond === undefined) throw new Error("unexpected delivery");
      return Promise.resolve(respond(items));
    },
  };
}

const acceptAll: Delivery = (items) => ok({ acknowledged: items.map((_, index) => index), outcomes: new Map() });
const offline: Delivery = () => err({ kind: "network", message: "connection refused" });

test("events carry explicit scope, producer, and a stable ingest key", () => {
  const item = toHookItem(scope, { event: "user-prompt", ingestKey: "k1", body: { session_id: "s" } });
  const url = new URL(item.url, "http://memory");
  assert.equal(url.pathname, "/hook");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    event: "user-prompt", agent: "pi", workspace: "mirror", project: "health", extension: "mirror.pi", source_event: "user-prompt", ingest_key: "k1",
  });
});

test("a failed delivery keeps every event and retries it with the same ingest keys in order", async () => {
  const { batches, deliver } = recording([offline, acceptAll]);
  const queue = new CaptureQueue(scope, deliver);
  queue.enqueue("session-start", {});
  queue.enqueue("user-prompt", { prompt: "one" });
  const failed = await queue.flush();
  assert.equal(failed.pending, 2);
  assert.equal(failed.error?.kind, "network");
  const retried = await queue.flush();
  assert.deepEqual(retried, { delivered: 2, pending: 0, error: undefined });
  assert.deepEqual(batches[0], batches[1]);
  assert.equal(new URL(batches[1]?.[0]?.url ?? "", "http://m").searchParams.get("event"), "session-start");
});

test("only unacknowledged events stay queued after a partial acknowledgement", async () => {
  const firstOnly: Delivery = () => ok({ acknowledged: [0, 2], outcomes: new Map() });
  const { batches, deliver } = recording([firstOnly, acceptAll]);
  const queue = new CaptureQueue(scope, deliver);
  queue.enqueue("session-start", {});
  queue.enqueue("user-prompt", { prompt: "kept" });
  queue.enqueue("stop", {});
  const partial = await queue.flush();
  assert.equal(partial.pending, 1);
  await queue.flush();
  const retried = batches[1];
  assert.ok(retried !== undefined);
  assert.equal(retried.length, 1);
  assert.equal(retried[0]?.body.prompt, "kept");
});

test("concurrent flushes deliver each event once", async () => {
  const { batches, deliver } = recording([acceptAll]);
  const queue = new CaptureQueue(scope, deliver);
  queue.enqueue("session-start", {});
  const [first, second] = await Promise.all([queue.flush(), queue.flush()]);
  assert.equal(first.delivered + second.delivered, 1);
  assert.equal(batches.length, 1);
});

test("the queue is bounded and counts dropped events", () => {
  const queue = new CaptureQueue(scope, () => Promise.resolve(offline([])));
  for (let index = 0; index < 505; index++) queue.enqueue("stop", { index });
  assert.equal(queue.pendingCount, 500);
  assert.equal(queue.droppedCount, 5);
});
