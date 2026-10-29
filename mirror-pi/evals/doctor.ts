// Check that this machine can run every eval level: the tools, the pinned Pi and its request patch, and a credential
// for each model of the capability gate. `--probe` also sends each model one short request.
// Usage: node mirror-pi/evals/doctor.ts [--probe] [--models provider/id,...]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isRecord, parseJson, stringField } from "../src/json.ts";
import { REPO, tempDir } from "./support/content.ts";
import { ANTHROPIC_PATCH, EVAL_AUTH, hasCredential } from "./support/credentials.ts";
import { GATE_GRADER, GATE_MODELS } from "./experiments/parity/gate.ts";
import { completeWithPi, preparePiGrader } from "./experiments/parity/pi-grader.ts";

type Finding = { readonly ok: boolean; readonly what: string; readonly fix: string };

function tool(name: string, args: readonly string[], fix: string): Finding {
  const result = spawnSync(name, args, { encoding: "utf8" });
  const version = result.status === 0 ? result.stdout.split("\n")[0]?.trim() ?? "" : "";
  return { ok: result.status === 0, what: `${name} ${version}`.trim(), fix };
}

function jsonFile(path: string): Readonly<Record<string, unknown>> {
  const value: unknown = existsSync(path) ? parseJson(readFileSync(path, "utf8")) : undefined;
  return isRecord(value) ? value : {};
}

function piPin(): Finding {
  const manifest = jsonFile(join(REPO, "package.json"));
  const pinned = isRecord(manifest.devDependencies) ? stringField(manifest.devDependencies, "@earendil-works/pi-coding-agent") : undefined;
  const installed = stringField(jsonFile(join(REPO, "node_modules", "@earendil-works", "pi-coding-agent", "package.json")), "version");
  return { ok: pinned !== undefined && pinned === installed, what: `Pi ${installed ?? "not installed"} (pinned ${pinned ?? "?"})`, fix: "run pnpm install" };
}

function credentials(models: readonly string[]): readonly Finding[] {
  const auth = EVAL_AUTH === undefined ? "no MIRROR_EVAL_AUTH; provider keys from the environment" : `MIRROR_EVAL_AUTH=${EVAL_AUTH}`;
  return [
    { ok: EVAL_AUTH === undefined || existsSync(EVAL_AUTH), what: auth, fix: "MIRROR_EVAL_AUTH must name an existing Pi auth.json" },
    ...models.map((model) => {
      const provider = model.slice(0, model.indexOf("/"));
      return { ok: hasCredential(provider), what: `credential for ${model}`, fix: `set ${provider.toUpperCase()}_API_KEY, or MIRROR_EVAL_AUTH to an auth file that has ${provider}` };
    }),
  ];
}

async function probe(models: readonly string[]): Promise<readonly Finding[]> {
  const root = await tempDir();
  await preparePiGrader(root);
  return Promise.all(models.map(async (model) => {
    const reply = await completeWithPi(root, model, "Reply with the word OK and nothing else.", "Are you there?").catch((error: unknown) => `error: ${String(error)}`);
    return { ok: /\bOK\b/.test(reply), what: `${model} replies: ${reply.trim().slice(0, 80)}`, fix: "check the credential and the model ID" };
  }));
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { probe: { type: "boolean" }, models: { type: "string" } } });
  const models = [...new Set([...(values.models?.split(",") ?? GATE_MODELS), GATE_GRADER])];
  const major = Number(process.versions.node.split(".")[0]);
  const findings: Finding[] = [
    { ok: major >= 26, what: `node ${process.versions.node}`, fix: "install Node 26 or later" },
    tool("pnpm", ["--version"], "install pnpm"),
    tool("git", ["--version"], "install git"),
    tool("rg", ["--version"], "install ripgrep: Mirror's session search uses rg"),
    tool("jq", ["--version"], "install jq: Mirror's session search uses jq"),
    piPin(),
    { ok: existsSync(ANTHROPIC_PATCH), what: "pi-cc-patch installed", fix: "run pnpm install" },
    ...credentials(models),
    ...(values.probe === true ? await probe(models) : []),
  ];
  for (const finding of findings) console.log(`${finding.ok ? "ok  " : "FAIL"} ${finding.what}${finding.ok ? "" : ` (${finding.fix})`}`);
  process.exitCode = findings.every((finding) => finding.ok) ? 0 : 1;
}

await main();
