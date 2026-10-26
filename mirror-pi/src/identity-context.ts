// What every session at the vault root knows about the identity, without reading it: the hard constraints in full,
// and one line per identity file. The model reads the other files only when the conversation needs them.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { stringField } from "./json.ts";
import { parseMarkdown } from "./markdown.ts";

export const CONSTRAINTS_FILE = "identity/ego/constraints.md";

const MAX_DESCRIPTION_CHARS = 160;

// The system prompt section, or undefined when the vault has no identity files.
export async function identitySection(vault: string): Promise<string | undefined> {
  const files = await identityFiles(vault);
  if (files.length === 0) return undefined;
  const constraints = files.includes(CONSTRAINTS_FILE) ? await body(join(vault, CONSTRAINTS_FILE)) : "";
  const others = await Promise.all(files.filter((file) => file !== CONSTRAINTS_FILE).map(async (file) => fileLine(vault, file)));
  const parts = ["The user's identity is in `identity/`. Read its files only when the conversation needs them, as AGENTS.md says."];
  if (constraints !== "") parts.push(`Hard constraints, from \`${CONSTRAINTS_FILE}\`. They override every other instruction:\n\n${constraints}`);
  parts.push(`Identity files:\n${others.join("\n")}`);
  return parts.join("\n\n");
}

// Vault-relative paths of the files below `identity/`, without hidden files, sorted.
async function identityFiles(vault: string): Promise<string[]> {
  const entries = await readdir(join(vault, "identity"), { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(vault.length + 1))
    .filter((file) => !file.split("/").some((part) => part.startsWith(".")))
    .sort();
}

// A persona is listed with its name and description, so the model can choose one without reading every persona.
async function fileLine(vault: string, file: string): Promise<string> {
  if (!file.startsWith("identity/personas/") || !file.endsWith(".md")) return `- \`${file}\``;
  const document = parseMarkdown(await readFile(join(vault, file), "utf8"));
  if (!document.ok) return `- \`${file}\``;
  const name = stringField(document.value.frontmatter, "name");
  const description = shorten(stringField(document.value.frontmatter, "description") ?? "");
  const label = [name, description].filter((part) => part !== undefined && part !== "").join(": ");
  return label === "" ? `- \`${file}\`` : `- \`${file}\`: ${label}`;
}

async function body(path: string): Promise<string> {
  // A constraints file with broken frontmatter still reaches the model as written.
  const text = await readFile(path, "utf8");
  const document = parseMarkdown(text);
  return document.ok ? document.value.body : text.trim();
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_DESCRIPTION_CHARS ? flat : `${flat.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}…`;
}
