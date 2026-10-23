import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { extractJson, translateRequest, translateResponse } from "../../../dev/pi-model-bridge/openai.ts";
import { startBridgeWith } from "../../../dev/pi-model-bridge/server.ts";

test("system and user messages map to a Pi context; a JSON schema becomes an instruction", () => {
  const request = translateRequest({
    model: "pi-bridge",
    max_tokens: 300,
    messages: [{ role: "system", content: "Summarize." }, { role: "user", content: "Session text" }],
    response_format: { type: "json_schema", json_schema: { name: "page", schema: { type: "object", required: ["title"] } } },
  });
  assert.ok(request.ok);
  assert.equal(request.value.maxTokens, 300);
  assert.match(request.value.context.systemPrompt ?? "", /^Summarize\.\n\nReply with exactly one JSON object[\s\S]*"required":\["title"\]/);
  assert.equal(request.value.context.messages.length, 1);
  assert.equal(request.value.wantsJson, true);
});

test("unsupported requests are rejected", () => {
  assert.ok(!translateRequest({ messages: [] }).ok);
  assert.ok(!translateRequest({ stream: true, messages: [{ role: "user", content: "x" }] }).ok);
  assert.ok(!translateRequest({ messages: [{ role: "assistant", content: "x" }] }).ok);
  assert.ok(!translateRequest({ messages: [{ role: "system", content: "only system" }] }).ok);
});

test("responses use the OpenAI chat-completions shape and strip fences around JSON", () => {
  const request = translateRequest({ model: "m", messages: [{ role: "user", content: "x" }], response_format: { type: "json_schema", json_schema: { schema: {} } } });
  assert.ok(request.ok);
  const answer = fauxAssistantMessage("```json\n{\"title\":\"t\"}\n```");
  const response = translateResponse(answer, request.value);
  assert.deepEqual(response.choices, [{ index: 0, message: { role: "assistant", content: "{\"title\":\"t\"}" }, finish_reason: "stop" }]);
  assert.equal(extractJson("no json here"), "no json here");
});

test("the bridge requires its bearer token and answers on 127.0.0.1", async () => {
  const faux = fauxProvider({ provider: "bridge-faux", models: [{ id: "m" }] });
  faux.setResponses([fauxAssistantMessage("OK")]);
  const bridge = await startBridgeWith({ port: 0, token: "t0k3n", model: faux.getModel(), complete: (_model, context) => {
    assert.equal(context.systemPrompt, "Be terse.");
    return Promise.resolve(fauxAssistantMessage("OK"));
  } });
  try {
    const url = `http://127.0.0.1:${String(bridge.port)}/v1/chat/completions`;
    const body = JSON.stringify({ model: "x", messages: [{ role: "system", content: "Be terse." }, { role: "user", content: "Reply with OK" }] });
    const denied = await fetch(url, { method: "POST", body });
    assert.equal(denied.status, 401);
    const allowed = await fetch(url, { method: "POST", body, headers: { Authorization: "Bearer t0k3n" } });
    assert.equal(allowed.status, 200);
    const payload: unknown = await allowed.json();
    assert.match(JSON.stringify(payload), /"content":"OK"/);
  } finally {
    await bridge.close();
  }
});
