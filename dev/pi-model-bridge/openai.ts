// Translate between the OpenAI chat-completions shape and a Pi model context.
// Only what AI Memory sends is supported: system and user text, max_tokens, and an optional JSON schema.
import type { AssistantMessage, Context, UserMessage } from "@earendil-works/pi-ai";
import { isRecord, numberField, stringField } from "../../mirror-pi/src/json.ts";
import { err, ok, type Result } from "../../mirror-pi/src/result.ts";

export type BridgeRequest = {
  readonly context: Context;
  readonly maxTokens: number | undefined;
  readonly requestedModel: string;
  readonly wantsJson: boolean;
};

export function translateRequest(body: unknown): Result<BridgeRequest, string> {
  if (!isRecord(body)) return err("request body must be a JSON object");
  if (body.stream === true) return err("streaming is not supported");
  const parsed = splitMessages(body.messages);
  if (!parsed.ok) return parsed;
  const { system, user } = parsed.value;
  const schema = jsonSchema(body.response_format);
  if (schema !== undefined) {
    system.push(`Reply with exactly one JSON object and nothing else: no prose and no code fence. It must conform to this JSON Schema:\n${JSON.stringify(schema)}`);
  }
  const maxTokens = numberField(body, "max_completion_tokens") ?? numberField(body, "max_tokens");
  const context: Context = system.length === 0 ? { messages: user } : { systemPrompt: system.join("\n\n"), messages: user };
  return ok({ context, maxTokens, requestedModel: stringField(body, "model") ?? "pi-bridge", wantsJson: schema !== undefined });
}

function splitMessages(messages: unknown): Result<{ system: string[]; user: UserMessage[] }, string> {
  if (!Array.isArray(messages) || messages.length === 0) return err("messages must be a non-empty array");
  const system: string[] = [];
  const user: UserMessage[] = [];
  for (const message of messages) {
    if (!isRecord(message)) return err("each message must be an object");
    const role = stringField(message, "role");
    const content = stringField(message, "content");
    if (content === undefined) return err("message content must be a string");
    if (role === "system" || role === "developer") system.push(content);
    else if (role === "user") user.push({ role: "user", content, timestamp: Date.now() });
    else return err(`unsupported message role: ${String(role)}`);
  }
  return user.length === 0 ? err("at least one user message is required") : ok({ system, user });
}

export function translateResponse(answer: AssistantMessage, request: BridgeRequest): Record<string, unknown> {
  const text = answer.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  return {
    id: `chatcmpl-${answer.responseId ?? String(answer.timestamp)}`,
    object: "chat.completion",
    created: Math.floor(answer.timestamp / 1000),
    model: request.requestedModel,
    choices: [{ index: 0, message: { role: "assistant", content: request.wantsJson ? extractJson(text) : text }, finish_reason: finishReason(answer.stopReason) }],
    usage: { prompt_tokens: answer.usage.input + answer.usage.cacheRead, completion_tokens: answer.usage.output },
  };
}

// Remove a code fence or surrounding prose when the model added it anyway.
export function extractJson(text: string): string {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start === -1 || end <= start ? trimmed : trimmed.slice(start, end + 1);
}

function jsonSchema(format: unknown): unknown {
  if (!isRecord(format) || format.type !== "json_schema" || !isRecord(format.json_schema)) return undefined;
  return format.json_schema.schema;
}

function finishReason(stopReason: AssistantMessage["stopReason"]): string {
  return stopReason === "length" ? "length" : "stop";
}
