// A local OpenAI-compatible endpoint that answers with your existing Pi authentication.
// AI Memory uses it for consolidation, so no provider credential is copied into AI Memory.
// It listens on 127.0.0.1 only and requires a bearer token.
import { appendFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Api, AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { translateRequest, translateResponse } from "./openai.ts";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export type BridgeOptions = {
  readonly port: number;
  readonly token: string;
  readonly provider: string;
  readonly modelId: string;
  readonly authPath: string;
  readonly modelsPath: string;
  // One JSON line per completion with its token usage and cost, so consolidation cost can be measured.
  readonly usageLog?: string;
};

export type Completer = (model: Model<Api>, context: Context, maxTokens: number | undefined) => Promise<AssistantMessage>;

export type RunningBridge = { readonly close: () => Promise<void>; readonly port: number };

export async function startBridge(options: BridgeOptions): Promise<RunningBridge> {
  const runtime = await ModelRuntime.create({ authPath: options.authPath, modelsPath: options.modelsPath });
  const model = runtime.getModel(options.provider, options.modelId);
  if (model === undefined) throw new Error(`Unknown model ${options.provider}/${options.modelId}`);
  // No reasoning option: Pi then sends no thinking request, which suits strict JSON consolidation.
  const usageLog = options.usageLog;
  const complete: Completer = async (selected, context, maxTokens) => {
    const answer = await runtime.completeSimple(selected, context, maxTokens === undefined ? {} : { maxTokens });
    if (usageLog !== undefined) {
      const line = { at: new Date().toISOString(), model: `${selected.provider}/${selected.id}`, usage: answer.usage };
      await appendFile(usageLog, `${JSON.stringify(line)}\n`);
    }
    return answer;
  };
  return startBridgeWith({ port: options.port, token: options.token, model, complete });
}

export async function startBridgeWith(options: { readonly port: number; readonly token: string; readonly model: Model<Api>; readonly complete: Completer }): Promise<RunningBridge> {
  const server = createServer((request, response) => {
    void handle(request, response, options.token, options.model, options.complete);
  });
  await new Promise<void>((resolve) => server.listen(options.port, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;
  return { port, close: () => new Promise((resolve) => server.close(() => { resolve(); })) };
}

type Reply = { readonly status: number; readonly payload: unknown };

export async function handle(request: IncomingMessage, response: ServerResponse, token: string, model: Model<Api>, complete: Completer): Promise<void> {
  let reply: Reply;
  try {
    reply = await respond(request, token, model, complete);
  } catch (error) {
    reply = failure(500, error instanceof Error ? error.message : String(error));
  }
  send(response, reply.status, reply.payload);
}

async function respond(request: IncomingMessage, token: string, model: Model<Api>, complete: Completer): Promise<Reply> {
  if (request.headers.authorization !== `Bearer ${token}`) return failure(401, "unauthorized");
  if (request.method !== "POST" || request.url?.replace(/\/+$/, "") !== "/v1/chat/completions") {
    return failure(404, "only POST /v1/chat/completions is supported");
  }
  const body = await readBody(request);
  if (body === undefined) return failure(413, "request body too large");
  const translated = translateRequest(body);
  if (!translated.ok) return failure(400, translated.error);
  const answer = await complete(model, translated.value.context, translated.value.maxTokens);
  if (answer.stopReason === "error" || answer.stopReason === "aborted") return failure(502, answer.errorMessage ?? "model request failed");
  return { status: 200, payload: translateResponse(answer, translated.value) };
}

function failure(status: number, message: string): Reply {
  return { status, payload: { error: { message } } };
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    if (!(chunk instanceof Buffer)) continue;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}
