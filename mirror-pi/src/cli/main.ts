// The `mirror` command: list journeys, check the setup, and start Pi sessions bound to one journey.
import { spawn } from "node:child_process";
import { lstat, mkdir, readlink, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProfile, readMemoryToken, type MirrorProfile } from "../config.ts";
import { listJourneys, loadIdentity, loadJourney, sharedProjects } from "../content.ts";
import { MemoryClient } from "../memory-client.ts";
import { err, ok, type Result } from "../result.ts";
import type { Journey } from "../content.ts";
import { parseStart, piArguments } from "./launch.ts";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const PI_BIN = join(REPO, "node_modules", ".bin", "pi");
const EXTENSION = join(REPO, "mirror-pi", "extension", "index.ts");
const DEFAULT_PROFILE = join(REPO, "config", "dev.json");

const USAGE = `Usage:
  mirror journeys                     List journeys in the content vault
  mirror doctor                       Check content, AI Memory, and Pi authentication
  mirror start <journey> [options] [-- pi options]
      --persona <id>   Add a persona lens
      --org            Include organization identity
      -c, --continue   Continue the latest session of this journey
      -r, --resume     Pick a session of this journey

Set MIRROR_PROFILE to use a profile other than config/dev.json.`;

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const profile = await loadProfile(resolve(process.env.MIRROR_PROFILE ?? DEFAULT_PROFILE));
  if (!profile.ok) return fail(profile.error);
  switch (command) {
    case "journeys":
      return journeys(profile.value);
    case "doctor":
      return doctor(profile.value);
    case "start":
      return start(profile.value, rest);
    case undefined:
    case "help":
    case "--help":
      console.log(USAGE);
      return command === undefined ? 1 : 0;
    default:
      return fail(`Unknown command: ${command}\n\n${USAGE}`);
  }
}

async function journeys(profile: MirrorProfile): Promise<number> {
  const { journeys: found, errors } = await listJourneys(profile.contentDir);
  for (const journey of found) console.log(`${journey.slug.padEnd(24)} ${journey.status.padEnd(10)} ${journey.title}`);
  for (const error of errors) console.error(`invalid journey: ${error.path}: ${error.message}`);
  const shared = sharedProjects(found);
  for (const problem of shared) console.error(`invalid journeys: ${problem}`);
  if (found.length === 0) console.log(`No journeys in ${profile.contentDir}`);
  return errors.length === 0 && shared.length === 0 ? 0 : 1;
}

async function doctor(profile: MirrorProfile): Promise<number> {
  let failures = 0;
  const check = (passed: boolean, message: string): void => {
    console.log(`${passed ? "ok  " : "FAIL"} ${message}`);
    if (!passed) failures++;
  };
  const identity = await loadIdentity(profile.contentDir);
  check(identity.ok, identity.ok ? `identity loads from ${profile.contentDir}` : `identity: ${identity.error.message} (${identity.error.path})`);
  const listed = await listJourneys(profile.contentDir);
  check(listed.errors.length === 0 && listed.journeys.length > 0, `${String(listed.journeys.length)} valid journeys, ${String(listed.errors.length)} invalid`);
  const shared = sharedProjects(listed.journeys);
  check(shared.length === 0, shared.length === 0 ? "each journey has its own AI Memory project" : shared.join("; "));
  const token = await readMemoryToken(profile.memory, process.env);
  check(token.ok, token.ok ? "AI Memory token is readable" : token.error);
  const client = new MemoryClient(profile.memory.url, token.ok ? token.value : undefined);
  const tools = await client.ping();
  check(tools.ok && tools.value.includes("memory_query"), tools.ok ? `AI Memory answers at ${profile.memory.url}` : `AI Memory at ${profile.memory.url}: ${tools.error.kind}: ${tools.error.message}`);
  const auth = await authLink(profile);
  check(auth === undefined, auth ?? `Pi auth link in ${profile.piAgentDir}`);
  return failures === 0 ? 0 : 1;
}

async function start(profile: MirrorProfile, args: readonly string[]): Promise<number> {
  const options = parseStart(args);
  if (options === undefined) return fail(USAGE);
  const journey = await startableJourney(profile, options.journey);
  if (!journey.ok) return fail(journey.error);
  const token = await readMemoryToken(profile.memory, process.env);
  if (!token.ok) return fail(token.error);
  const identity = await loadIdentity(profile.contentDir);
  if (!identity.ok) return fail(`${identity.error.message} (${identity.error.path})`);
  if (options.persona !== undefined && !identity.value.personas.has(options.persona)) return fail(`Persona "${options.persona}" does not exist`);
  const authProblem = await ensureAgentDir(profile);
  if (authProblem !== undefined) return fail(authProblem);
  return run(PI_BIN, piArguments(profile, journey.value.slug, options, EXTENSION), profile.contentDir, {
    ...process.env,
    PI_CODING_AGENT_DIR: profile.piAgentDir,
    MIRROR_PROFILE: profile.path,
    MIRROR_JOURNEY: journey.value.slug,
    MIRROR_PERSONA: options.persona ?? "",
    MIRROR_ORGANIZATION: options.organization ? "1" : "0",
    AI_MEMORY_CAPTURE_OWNER: "mirror.pi",
  });
}

async function startableJourney(profile: MirrorProfile, slug: string): Promise<Result<Journey, string>> {
  const journey = await loadJourney(profile.contentDir, slug);
  if (!journey.ok) return err(`${journey.error.message} (${journey.error.path})`);
  const listed = await listJourneys(profile.contentDir);
  const shared = sharedProjects(listed.journeys).filter((problem) => problem.includes(`"${journey.value.memoryProject}"`));
  return shared.length === 0 ? ok(journey.value) : err(`Cannot start: ${shared.join("; ")}`);
}

// Mirror keeps its own Pi agent directory so personal Pi packages and settings do not load.
// Only auth.json is shared, through a symbolic link to the personal Pi agent directory.
async function ensureAgentDir(profile: MirrorProfile): Promise<string | undefined> {
  await mkdir(profile.piAgentDir, { recursive: true, mode: 0o700 });
  await writeFile(join(profile.piAgentDir, "settings.json"), `${JSON.stringify({ quietStartup: true }, null, 2)}\n`, { flag: "wx" }).catch(ignoreExisting);
  const problem = await authLink(profile);
  if (problem === undefined) return undefined;
  const link = join(profile.piAgentDir, "auth.json");
  const existing = await lstat(link).catch(() => undefined);
  if (existing !== undefined) return problem;
  await symlink(personalAuthPath(), link);
  return authLink(profile);
}

async function authLink(profile: MirrorProfile): Promise<string | undefined> {
  const link = join(profile.piAgentDir, "auth.json");
  const stat = await lstat(link).catch(() => undefined);
  if (stat === undefined) return `Pi auth link is missing: ${link} (mirror start creates it)`;
  if (!stat.isSymbolicLink()) return `${link} is a regular file. Remove it so Mirror can link to ${personalAuthPath()}.`;
  const target = await readlink(link);
  return resolve(profile.piAgentDir, target) === personalAuthPath() ? undefined : `${link} points to ${target}, not ${personalAuthPath()}`;
}

function ignoreExisting(error: unknown): void {
  if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
}

function personalAuthPath(): string {
  return join(process.env.MIRROR_PERSONAL_PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "auth.json");
}

function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolveExit) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.on("error", (error) => {
      console.error(`Cannot start Pi: ${error.message}`);
      resolveExit(1);
    });
    child.on("exit", (code, signal) => {
      resolveExit(code ?? (signal === null ? 1 : 128));
    });
  });
}

function fail(message: string): number {
  console.error(message);
  return 1;
}

process.exitCode = await main(process.argv.slice(2));
