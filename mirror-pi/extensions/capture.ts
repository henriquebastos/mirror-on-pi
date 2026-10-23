// Development stand-in for the personal AI Memory Pi extension.
// Sends each session's lifecycle events to the AI Memory project named by the journey's `.ai-memory.toml`.
// Sessions outside a journey directory send nothing. At deployment, the personal extension replaces this one.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CaptureQueue, type HookEventName } from "../src/capture.ts";
import type { JsonRecord } from "../src/json.ts";
import type { MemoryClient } from "../src/memory-client.ts";
import { journeyFor, sessionId, withMemory } from "../src/pi.ts";

const SHUTDOWN_FLUSH_MS = 3_000;

export default async function capture(pi: ExtensionAPI): Promise<void> {
  await withMemory(pi, "Mirror capture", createCaptureExtension);
}

export function createCaptureExtension(client: MemoryClient): (pi: ExtensionAPI) => void {
  return (pi) => {
    let queue: CaptureQueue | undefined;
    const send = (ctx: ExtensionContext, event: HookEventName, extra: JsonRecord): void => {
      if (queue === undefined) return;
      queue.enqueue(event, { session_id: sessionId(ctx) ?? null, cwd: ctx.cwd, ...extra });
      void queue.flush();
    };

    pi.on("session_start", async (_event, ctx) => {
      const journey = await journeyFor(ctx);
      queue = journey === undefined ? undefined : new CaptureQueue(journey.scope, (items) => client.deliverHooks(items));
      send(ctx, "session-start", {});
    });
    pi.on("before_agent_start", (event, ctx) => {
      if (event.messageType === "user") send(ctx, "user-prompt", { prompt: event.prompt });
    });
    pi.on("tool_call", (event, ctx) => {
      send(ctx, "pre-tool-use", { tool: event.toolName, callID: event.toolCallId, args: event.input });
    });
    pi.on("tool_result", (event, ctx) => {
      send(ctx, "post-tool-use", { tool: event.toolName, callID: event.toolCallId, isError: event.isError });
    });
    pi.on("agent_end", (_event, ctx) => {
      send(ctx, "stop", {});
    });
    pi.on("session_shutdown", async (_event, ctx) => {
      if (queue === undefined) return;
      send(ctx, "session-end", {});
      await Promise.race([queue.flush(), delay(SHUTDOWN_FLUSH_MS)]);
    });
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}
