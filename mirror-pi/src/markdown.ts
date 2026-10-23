import { parse, stringify } from "yaml";
import { isRecord, type JsonRecord } from "./json.ts";
import { err, ok, type Result } from "./result.ts";

export type MarkdownDocument = {
  readonly frontmatter: JsonRecord;
  readonly body: string;
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseMarkdown(text: string): Result<MarkdownDocument, string> {
  const match = FRONTMATTER.exec(text);
  if (match === null) return ok({ frontmatter: {}, body: text.trim() });
  let data: unknown;
  try {
    data = parse(match[1] ?? "");
  } catch (error) {
    return err(`Invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (data === null || data === undefined) return ok({ frontmatter: {}, body: text.slice(match[0].length).trim() });
  if (!isRecord(data)) return err("Frontmatter must be a YAML mapping");
  return ok({ frontmatter: data, body: text.slice(match[0].length).trim() });
}

export function renderMarkdown(frontmatter: JsonRecord, body: string): string {
  return `---\n${stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}
