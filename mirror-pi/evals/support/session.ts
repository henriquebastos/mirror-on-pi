// Run a real Pi SDK session in a journey directory with Mirror's extensions, as a manual session would.
// Pi loads the vault's AGENTS.md files itself. Only the model and the AI Memory client are chosen by the eval.
import { mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fauxProvider, type Api, type FauxResponseStep, type Model } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SettingsManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { createCaptureExtension } from "../../extensions/capture.ts";
import { createCorrectionsExtension } from "../../extensions/corrections.ts";
import { createJournalExtension } from "../../extensions/journal.ts";
import { createRecallExtension } from "../../extensions/recall.ts";
import type { MemoryClient } from "../../src/memory-client.ts";
import { assertNever } from "../../src/result.ts";

type ThinkingLevel = NonNullable<NonNullable<Parameters<typeof createAgentSession>[0]>["thinkingLevel"]>;

// A scripted model for wiring evals, or a real model through the personal Pi authentication.
export type EvalModel =
  | { readonly kind: "scripted"; readonly responses: readonly FauxResponseStep[] }
  | { readonly kind: "real"; readonly provider: string; readonly id: string; readonly thinking: ThinkingLevel };

export type MirrorSessionOptions = {
  readonly cwd: string;
  readonly client: MemoryClient;
  readonly model: EvalModel;
  readonly sessionManager: SessionManager;
  readonly now?: () => Date;
};

export type MirrorSession = {
  readonly session: AgentSession;
  readonly close: () => Promise<void>;
};

export async function openMirrorSession(options: MirrorSessionOptions): Promise<MirrorSession> {
  const agentDir = await mkdtemp(join(tmpdir(), "mirror-eval-agent-"));
  const { runtime, model, thinkingLevel } = await modelFor(options.model, agentDir);
  const now = options.now ?? ((): Date => new Date());
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [
      createCaptureExtension(options.client),
      createRecallExtension(options.client),
      createJournalExtension(options.client, now),
      createCorrectionsExtension(options.client, now),
    ],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: options.cwd,
    agentDir,
    modelRuntime: runtime,
    model,
    thinkingLevel,
    resourceLoader: loader,
    sessionManager: options.sessionManager,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
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

