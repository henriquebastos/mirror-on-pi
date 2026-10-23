// Send one Mirror session's lifecycle events to the journey's AI Memory project.
// Events keep their ingest key across retries, so a retried batch cannot store an event twice.
// The queue lives in memory: events not delivered before the process ends are lost.
import { randomUUID } from "node:crypto";
import type { JsonRecord } from "./json.ts";
import type { HookItem, HookReceipt, MemoryError, MemoryScope } from "./memory-client.ts";
import type { Result } from "./result.ts";

export type HookEventName = "session-start" | "user-prompt" | "pre-tool-use" | "post-tool-use" | "stop" | "session-end";

export type CaptureEvent = {
  readonly event: HookEventName;
  readonly ingestKey: string;
  readonly body: JsonRecord;
};

export type DeliverHooks = (items: readonly HookItem[]) => Promise<Result<HookReceipt, MemoryError>>;

export type FlushReport = {
  readonly delivered: number;
  readonly pending: number;
  readonly error: MemoryError | undefined;
};

export const CAPTURE_PRODUCER = "mirror.pi";
const MAX_PENDING = 500;
const MAX_BATCH = 64;

export class CaptureQueue {
  readonly #scope: MemoryScope;
  readonly #deliver: DeliverHooks;
  readonly #pending: CaptureEvent[] = [];
  #flushing: Promise<FlushReport> | undefined;
  #dropped = 0;

  constructor(scope: MemoryScope, deliver: DeliverHooks) {
    this.#scope = scope;
    this.#deliver = deliver;
  }

  get pendingCount(): number {
    return this.#pending.length;
  }

  get droppedCount(): number {
    return this.#dropped;
  }

  enqueue(event: HookEventName, body: JsonRecord, ingestKey: string = newIngestKey()): void {
    if (this.#pending.length >= MAX_PENDING) {
      this.#pending.shift();
      this.#dropped++;
    }
    this.#pending.push({ event, ingestKey, body });
  }

  // Serialize deliveries so events from one session keep their order.
  flush(): Promise<FlushReport> {
    const previous = this.#flushing ?? Promise.resolve(undefined);
    const next = previous.then(() => this.#flushOnce());
    this.#flushing = next;
    return next;
  }

  async #flushOnce(): Promise<FlushReport> {
    let delivered = 0;
    while (this.#pending.length > 0) {
      const batch = this.#pending.slice(0, MAX_BATCH);
      const receipt = await this.#deliver(batch.map((event) => toHookItem(this.#scope, event)));
      if (!receipt.ok) return { delivered, pending: this.#pending.length, error: receipt.error };
      const acknowledged = new Set(receipt.value.acknowledged);
      if (acknowledged.size === 0) return { delivered, pending: this.#pending.length, error: { kind: "protocol", message: "No event in the batch was acknowledged" } };
      const remaining = batch.filter((_, index) => !acknowledged.has(index));
      this.#pending.splice(0, batch.length, ...remaining);
      delivered += acknowledged.size;
      if (remaining.length > 0) return { delivered, pending: this.#pending.length, error: { kind: "protocol", message: "Part of the batch was not acknowledged" } };
    }
    return { delivered, pending: 0, error: undefined };
  }
}

export function toHookItem(scope: MemoryScope, event: CaptureEvent): HookItem {
  const query = new URLSearchParams({
    event: event.event,
    agent: "pi",
    workspace: scope.workspace,
    project: scope.project,
    extension: CAPTURE_PRODUCER,
    source_event: event.event,
    ingest_key: event.ingestKey,
  });
  return { url: `/hook?${query.toString()}`, body: event.body };
}

// 64 hex characters, within AI Memory's 1-64 character ingest-key limit.
export function newIngestKey(): string {
  return `${randomUUID()}${randomUUID()}`.replace(/-/g, "").slice(0, 64);
}
