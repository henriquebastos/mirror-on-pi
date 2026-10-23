// Run a real Pi SDK session with the Mirror extension and a scripted model.
// The model is fake; Pi, the extension, the vault, and AI Memory are real.
import { mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fauxProvider, type Api, type FauxResponseStep, type Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { assertNever } from "../../src/result.ts";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ALLOWED_TOOLS, createMirrorExtension } from "../../src/extension.ts";
import type { MemoryClient } from "../../src/memory-client.ts";

const MODE_PROMPT = fileURLToPath(new URL("../../prompts/mirror-mode.md", import.meta.url));

type ThinkingLevel = NonNullable<NonNullable<Parameters<typeof createAgentSession>[0]>["thinkingLevel"]>;

// A scripted model for wiring evals, or a real model through the personal Pi authentication.
export type EvalModel =
  | { readonly kind: "scripted"; readonly responses: readonly FauxResponseStep[] }
  | { readonly kind: "real"; readonly provider: string; readonly id: string; readonly thinking: ThinkingLevel };

export type MirrorSessionOptions = {
  readonly contentDir: string;
  readonly workspace: string;
  readonly journey: string;
  readonly client: MemoryClient;
  readonly model: EvalModel;
  readonly sessionManager: SessionManager;
  readonly persona?: string;
  readonly now?: () => Date;
};

export type MirrorSession = {
  readonly session: AgentSession;
  readonly close: () => Promise<void>;
};

export async function openMirrorSession(options: MirrorSessionOptions): Promise<MirrorSession> {
  const agentDir = await mkdtemp(join(tmpdir(), "mirror-eval-agent-"));
  const { runtime, model, thinkingLevel } = await modelFor(options.model, agentDir);
  const loader = new DefaultResourceLoader({
    cwd: options.contentDir,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
    noThemes: true,
    extensionFactories: [
      createMirrorExtension({
        contentDir: options.contentDir,
        workspace: options.workspace,
        journey: options.journey,
        persona: options.persona,
        organization: false,
        modePrompt: await readFile(MODE_PROMPT, "utf8"),
        client: options.client,
        ...(options.now === undefined ? {} : { now: options.now }),
      }),
    ],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: options.contentDir,
    agentDir,
    modelRuntime: runtime,
    model,
    thinkingLevel,
    resourceLoader: loader,
    sessionManager: options.sessionManager,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
    tools: [...ALLOWED_TOOLS],
  });
  await session.bindExtensions({});
  return {
    session,
    close: async () => {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
    },
  };
}

async function modelFor(choice: EvalModel, agentDir: string): Promise<{ runtime: ModelRuntime; model: Model<Api>; thinkingLevel: ThinkingLevel }> {
  switch (choice.kind) {
    case "scripted": {
      const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
      const faux = fauxProvider({ provider: "mirror-faux", models: [{ id: "scripted" }] });
      runtime.registerNativeProvider(faux.provider);
      faux.setResponses([...choice.responses]);
      return { runtime, model: faux.getModel(), thinkingLevel: "off" };
    }
    case "real": {
      // Use the personal auth file directly, so Pi's own lock serializes token refreshes.
      const authPath = join(process.env.MIRROR_PERSONAL_PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "auth.json");
      const runtime = await ModelRuntime.create({ authPath, modelsPath: join(agentDir, "models.json") });
      const model = runtime.getModel(choice.provider, choice.id);
      if (model === undefined) throw new Error(`Unknown model ${choice.provider}/${choice.id}`);
      return { runtime, model, thinkingLevel: choice.thinking };
    }
    default:
      return assertNever(choice);
  }
}

export function persistentSessions(contentDir: string, sessionDir: string): SessionManager {
  return SessionManager.create(contentDir, sessionDir);
}
