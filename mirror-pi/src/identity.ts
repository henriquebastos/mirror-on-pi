// Soul Mode integrations: the only identity change Mirror makes.
// A confirmed text is appended as a dated bullet to the layer's integration section, as Mirror Mind does.
// Every existing line stays, in order. Nothing is replaced or removed.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { err, ok, type Result } from "./result.ts";
import { validateSlug } from "./slug.ts";

export type IntegrationLayer = "self" | "shadow" | "ego" | "persona";

export type IntegrationInput = {
  readonly layer: IntegrationLayer;
  readonly persona: string | undefined;
  readonly text: string;
};

// Where an integration goes. `relativePath` is relative to the vault root, as the user sees it.
export type IntegrationTarget = {
  readonly file: string;
  readonly relativePath: string;
  readonly section: string;
  readonly bullet: string;
};

export const MAX_INTEGRATION_CHARS = 1_000;

const SECTIONS: Readonly<Record<IntegrationLayer, string>> = {
  self: "New Incorporated Principles",
  shadow: "New Hidden Needs Recognized",
  ego: "New Operational Patterns Identified",
  persona: "New Participation Patterns Revealed",
};

// The vault root is the nearest directory at or above `cwd` that holds an `identity/` directory.
export async function findVault(cwd: string): Promise<string | undefined> {
  let dir = resolve(cwd);
  for (;;) {
    if (await isDirectory(join(dir, "identity"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

// Validate the input and name the file, section, and exact bullet. Nothing is written.
export async function planIntegration(vault: string, input: IntegrationInput, now: Date): Promise<Result<IntegrationTarget, string>> {
  const text = input.text.trim();
  if (text === "") return err("The integration text is empty");
  if (/[\r\n]/.test(text)) return err("The integration text must be one paragraph on one line");
  if (text.length > MAX_INTEGRATION_CHARS) return err(`The integration text is longer than ${String(MAX_INTEGRATION_CHARS)} characters`);
  const path = await layerPath(vault, input);
  if (!path.ok) return path;
  return ok({
    file: join(vault, path.value),
    relativePath: path.value,
    section: SECTIONS[input.layer],
    bullet: `- [${now.toISOString().slice(0, 10)}] ${text}`,
  });
}

async function layerPath(vault: string, input: IntegrationInput): Promise<Result<string, string>> {
  if (input.layer !== "persona") {
    if (input.persona !== undefined) return err(`A persona is only valid for the persona layer, not ${input.layer}`);
    return ok({ self: "identity/self/soul.md", shadow: "identity/shadow/profile.md", ego: "identity/ego/behavior.md" }[input.layer]);
  }
  if (input.persona === undefined) return err("The persona layer needs a persona id");
  const slug = validateSlug(input.persona);
  if (!slug.ok) return slug;
  const path = `identity/personas/${slug.value}.md`;
  if (!(await isFile(join(vault, path)))) return err(`There is no persona ${slug.value} (${path})`);
  return ok(path);
}

// Append the bullet at the end of the section, before the next `## ` heading. Add the section at the end when it is missing.
export function appendIntegration(content: string, section: string, bullet: string): string {
  const lines = content === "" ? [] : content.replace(/\n$/, "").split("\n");
  const heading = lines.findIndex((line) => line.trim() === `## ${section}`);
  if (heading === -1) {
    const separator = lines.length === 0 ? [] : [""];
    return [...lines, ...separator, `## ${section}`, "", bullet].join("\n") + "\n";
  }
  const next = lines.findIndex((line, index) => index > heading && /^#{1,2} /.test(line));
  let last = (next === -1 ? lines.length : next) - 1;
  while (last > heading && lines[last]?.trim() === "") last--;
  const inserted = last === heading ? ["", bullet] : [bullet];
  return [...lines.slice(0, last + 1), ...inserted, ...lines.slice(last + 1)].join("\n") + "\n";
}

// Write the planned integration. A missing self, shadow, or ego file is created with the section only.
export async function writeIntegration(target: IntegrationTarget): Promise<void> {
  const current = await readFile(target.file, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  });
  await mkdir(dirname(target.file), { recursive: true });
  const temporary = `${target.file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, appendIntegration(current, target.section, target.bullet), { flag: "wx" });
  await rename(temporary, target.file);
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() === true;
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isFile() === true;
}
