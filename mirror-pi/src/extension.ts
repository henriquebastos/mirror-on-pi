// The Mirror Pi extension: identity context, journey binding, memory capture, recall, and explicit records.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { BINDING_ENTRY_TYPE, bindingFor, decideBinding, type BindingDecision } from "./binding.ts";
import { CaptureQueue, type HookEventName } from "./capture.ts";
import { composeSections, renderSections } from "./compose.ts";
import { loadIdentity, loadJourney, type Journey } from "./content.ts";
import { isRecord, stringField, type JsonRecord } from "./json.ts";
import { renderMemoryContext } from "./memory-context.ts";
import type { MemoryClient, MemoryError, MemoryScope, QueryHit } from "./memory-client.ts";
import { isRelativeGlob, resolveInside } from "./paths.ts";
import { recordCorrection, saveJournal, type RecordContext, type RecordReceipt } from "./records.ts";
import { assertNever, type Result } from "./result.ts";

export type MirrorExtensionOptions = {
  readonly contentDir: string;
  readonly workspace: string;
  readonly journey: string;
  readonly persona: string | undefined;
  readonly organization: boolean;
  readonly modePrompt: string;
  readonly client: MemoryClient;
  readonly now?: () => Date;
};

export const MIRROR_TOOLS = ["mirror_recall", "mirror_save_journal", "mirror_record_correction"] as const;
export const VAULT_TOOLS = ["read", "grep", "find", "ls"] as const;
export const ALLOWED_TOOLS: readonly string[] = [...VAULT_TOOLS, ...MIRROR_TOOLS];

const MEMORY_CONTEXT_TYPE = "mirror-memory";
const RELEVANT_LIMIT = 6;
const RECENT_LIMIT = 8;
const RECALL_LIMIT = 10;
const QUERY_CHARS = 400;
const SHUTDOWN_FLUSH_MS = 3_000;

type Ready = {
  readonly status: "ready";
  readonly journey: Journey;
  readonly scope: MemoryScope;
  readonly identity: string;
  readonly capture: CaptureQueue;
  briefed: boolean;
};

type Blocked = { readonly status: "blocked"; readonly reason: string };

type SessionState = Ready | Blocked;

export function createMirrorExtension(options: MirrorExtensionOptions): (pi: ExtensionAPI) => void {
  const now = options.now ?? ((): Date => new Date());
  return (pi) => {
    let state: SessionState = { status: "blocked", reason: "Mirror has not started a session yet" };

    pi.on("session_start", async (_event, ctx) => {
      state = await startSession(pi, ctx, options);
      if (state.status === "blocked") {
        notify(ctx, `Mirror is blocked: ${state.reason}`, "error");
        return;
      }
      setStatus(ctx, `◌ Mirror · ${state.journey.title}`);
      capture(state, ctx, "session-start", {});
    });

    pi.on("session_shutdown", async (_event, ctx) => {
      if (state.status !== "ready") return;
      capture(state, ctx, "session-end", {});
      await Promise.race([state.capture.flush(), delay(SHUTDOWN_FLUSH_MS)]);
    });

    pi.on("input", (_event, ctx) => {
      if (state.status === "ready") return { action: "continue" as const };
      notify(ctx, `Mirror is blocked: ${state.reason}`, "error");
      return { action: "handled" as const };
    });

    pi.on("before_agent_start", async (event, ctx) => {
      if (state.status !== "ready") return undefined;
      event.systemPromptOptions.customPrompt = options.modePrompt;
      event.systemPromptOptions.sections.mirror_identity = state.identity;
      if (event.messageType !== "user") return undefined;
      capture(state, ctx, "user-prompt", { prompt: event.prompt });
      const content = await recallFor(options.client, state, event.prompt, sessionId(ctx), ctx.signal);
      return content === undefined ? undefined : { message: { customType: MEMORY_CONTEXT_TYPE, content, display: false } };
    });

    pi.on("tool_call", async (event, ctx) => {
      const reason = await toolBlockReason(event.toolName, event.input, ctx, options.contentDir);
      if (state.status === "ready") capture(state, ctx, "pre-tool-use", { tool: event.toolName, callID: event.toolCallId, args: event.input });
      return reason === undefined ? undefined : { block: true, reason };
    });

    pi.on("tool_result", (event, ctx) => {
      if (state.status === "ready") capture(state, ctx, "post-tool-use", { tool: event.toolName, callID: event.toolCallId, isError: event.isError });
    });

    pi.on("agent_end", (_event, ctx) => {
      if (state.status === "ready") capture(state, ctx, "stop", {});
    });

    registerTools(pi, options, now, () => state);
  };
}

async function startSession(pi: ExtensionAPI, ctx: ExtensionContext, options: MirrorExtensionOptions): Promise<SessionState> {
  const journey = await loadJourney(options.contentDir, options.journey);
  if (!journey.ok) return blocked(`${journey.error.message} (${journey.error.path})`);
  const identity = await loadIdentity(options.contentDir);
  if (!identity.ok) return blocked(`${identity.error.message} (${identity.error.path})`);
  const sections = composeSections(identity.value, { persona: options.persona, organization: options.organization, journey: journey.value });
  if (!sections.ok) return blocked(sections.error);
  const scope = { workspace: options.workspace, project: journey.value.memoryProject };
  const decision = decideBinding(ctx.sessionManager.getEntries(), bindingFor(journey.value.slug, scope));
  const failure = bindingFailure(decision);
  if (failure !== undefined) return blocked(failure);
  if (decision.kind === "create") pi.appendEntry(BINDING_ENTRY_TYPE, decision.binding);
  return {
    status: "ready",
    journey: journey.value,
    scope,
    identity: renderSections(sections.value),
    capture: new CaptureQueue(scope, (items) => options.client.deliverHooks(items)),
    briefed: false,
  };
}

function bindingFailure(decision: BindingDecision): string | undefined {
  switch (decision.kind) {
    case "create":
    case "bound":
      return undefined;
    case "mismatch":
      return `this session belongs to journey "${decision.existing.journey}" (${decision.existing.workspace}/${decision.existing.project}), not "${decision.requested.journey}". Start a new session for this journey.`;
    case "unbound-history":
      return "this session has history but no journey binding. Start a new Mirror session.";
    case "corrupt":
      return decision.message;
    default:
      return assertNever(decision);
  }
}

async function recallFor(client: MemoryClient, state: Ready, prompt: string, session: string | undefined, signal: AbortSignal | undefined): Promise<string | undefined> {
  const relevant = await client.query(state.scope, prompt.slice(0, QUERY_CHARS), RELEVANT_LIMIT, signal);
  let recent: Result<readonly QueryHit[], MemoryError> | undefined;
  if (!state.briefed) {
    recent = await client.recent(state.scope, RECENT_LIMIT, signal);
    if (recent.ok) state.briefed = true;
  }
  const failure = !relevant.ok ? relevant.error : recent !== undefined && !recent.ok ? recent.error : undefined;
  return renderMemoryContext({
    journeyTitle: state.journey.title,
    scope: state.scope,
    sessionId: session,
    relevant: relevant.ok ? relevant.value : [],
    recent: recent?.ok === true ? recent.value : undefined,
    failure,
  });
}

async function toolBlockReason(toolName: string, input: unknown, ctx: ExtensionContext, contentDir: string): Promise<string | undefined> {
  if (!ALLOWED_TOOLS.includes(toolName)) return `Mirror sessions cannot use the ${toolName} tool.`;
  if (!isVaultTool(toolName) || !isRecord(input)) return undefined;
  // find takes a file glob in "pattern"; grep's "pattern" is a text regex and its file glob is "glob".
  const glob = stringField(input, toolName === "find" ? "pattern" : "glob");
  if (glob !== undefined && !isRelativeGlob(glob)) return `Glob outside the content vault: ${glob}`;
  const path = stringField(input, "path");
  if (path === undefined) return undefined;
  const resolved = await resolveInside(contentDir, ctx.cwd, path);
  return resolved.ok ? undefined : resolved.error;
}

function isVaultTool(name: string): boolean {
  return VAULT_TOOLS.some((tool) => tool === name);
}

function registerTools(pi: ExtensionAPI, options: MirrorExtensionOptions, now: () => Date, current: () => SessionState): void {
  const ready = (): Ready => {
    const state = current();
    if (state.status !== "ready") throw new Error(`Mirror is blocked: ${state.reason}`);
    return state;
  };
  const recordContext = (state: Ready, ctx: ExtensionContext): RecordContext => ({
    contentDir: options.contentDir,
    journey: state.journey.slug,
    scope: state.scope,
    sessionId: sessionId(ctx),
    now,
  });

  pi.registerTool({
    name: "mirror_recall",
    label: "Recall",
    description: "Search this journey's AI Memory for notes, corrections, journal entries, and earlier sessions.",
    parameters: Type.Object({ query: Type.String({ minLength: 1, description: "What to look for" }) }),
    execute: async (_id, params, signal) => {
      const state = ready();
      const hits = await options.client.query(state.scope, params.query, RECALL_LIMIT, signal);
      if (!hits.ok) throw new Error(`AI Memory query failed (${hits.error.kind}): ${hits.error.message}`);
      const text = hits.value.length === 0 ? "No matching memory." : hits.value.map((hit) => `- [${hit.path}] ${hit.title}: ${hit.snippet}`).join("\n");
      return { content: [{ type: "text", text }], details: { hits: hits.value.length } };
    },
  });

  pi.registerTool({
    name: "mirror_save_journal",
    label: "Save journal entry",
    description: "Save a journal entry for this journey. Use only when the user explicitly asks to save or record a journal entry.",
    parameters: Type.Object({
      title: Type.String({ minLength: 1, description: "Short title in the user's language" }),
      body: Type.String({ minLength: 1, description: "The entry, faithful to the user's words" }),
    }),
    execute: async (_id, params, _signal, _update, ctx) => {
      const state = ready();
      const receipt = await saveJournal(options.client, recordContext(state, ctx), params);
      return receiptResult(receipt);
    },
  });

  pi.registerTool({
    name: "mirror_record_correction",
    label: "Record correction",
    description: "Record that a fact about the user's life was wrong and what is true now. Use when the user explicitly corrects a fact.",
    parameters: Type.Object({
      topic: Type.String({ minLength: 1, description: "What the correction is about" }),
      previous: Type.String({ minLength: 1, description: "The earlier, wrong belief" }),
      corrected: Type.String({ minLength: 1, description: "The corrected belief, in the user's words" }),
      note: Type.Optional(Type.String({ description: "Optional context" })),
    }),
    execute: async (_id, params, _signal, _update, ctx) => {
      const state = ready();
      const receipt = await recordCorrection(options.client, recordContext(state, ctx), { ...params, note: params.note });
      return receiptResult(receipt);
    },
  });
}

function receiptResult(receipt: Result<RecordReceipt, string>): { content: { type: "text"; text: string }[]; details: JsonRecord } {
  if (!receipt.ok) throw new Error(receipt.error);
  const { kind, file, memory } = receipt.value;
  const published = memory.ok ? `Published to AI Memory as ${memory.value.path}.` : `NOT published to AI Memory (${memory.error.kind}: ${memory.error.message}).`;
  return {
    content: [{ type: "text", text: `Saved ${kind} to ${file}. ${published}` }],
    details: { kind, file, published: memory.ok, memoryPath: memory.ok ? memory.value.path : null },
  };
}

function capture(state: Ready, ctx: ExtensionContext, event: HookEventName, extra: JsonRecord): void {
  state.capture.enqueue(event, { session_id: sessionId(ctx) ?? null, cwd: ctx.cwd, ...extra });
  void state.capture.flush();
}

function sessionId(ctx: ExtensionContext): string | undefined {
  const id = ctx.sessionManager.getSessionId();
  return id === "" ? undefined : id;
}

function blocked(reason: string): Blocked {
  return { status: "blocked", reason };
}

function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error"): void {
  if (ctx.hasUI) ctx.ui.notify(message, level);
  else console.error(message);
}

function setStatus(ctx: ExtensionContext, text: string): void {
  if (ctx.hasUI) ctx.ui.setStatus("mirror", text);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}
