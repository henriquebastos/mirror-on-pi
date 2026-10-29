// Explicit records: journal entries and corrections, written as Markdown files in the journey directory.
// A journal entry without a journey goes to the vault root's `journal/`; a correction always needs a journey.
// A record never replaces an earlier one: a taken name gets the next free number.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Journey } from "./journey.ts";
import type { JsonRecord } from "./json.ts";
import { renderMarkdown } from "./markdown.ts";
import { err, ok, type Result } from "./result.ts";
import { slugify } from "./slug.ts";

export type RecordKind = "journal" | "correction";

export type RecordContext = {
  readonly journey: Pick<Journey, "dir" | "slug"> | undefined;
  // The vault root: the session's starting directory.
  readonly root: string;
  readonly sessionId: string | undefined;
  readonly now: () => Date;
};

export type JournalInput = { readonly title: string; readonly body: string };

export type CorrectionInput = {
  readonly topic: string;
  readonly previous: string;
  readonly corrected: string;
  readonly note: string | undefined;
};

export type RecordReceipt = {
  readonly kind: RecordKind;
  readonly file: string;
};

const MAX_NAME_ATTEMPTS = 20;
const DIRECTORIES: Readonly<Record<RecordKind, string>> = { journal: "journal", correction: "corrections" };

export async function saveJournal(context: RecordContext, input: JournalInput): Promise<Result<RecordReceipt, string>> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title === "" || body === "") return err("A journal entry needs a title and a body");
  const date = context.now();
  return write(context, "journal", date, title, {
    frontmatter: { type: "journal", title, date: date.toISOString(), journey: context.journey?.slug ?? null, session: context.sessionId ?? null },
    body: `# ${title}\n\n${body}\n\n_Journal entry, ${date.toISOString().slice(0, 10)}._`,
  });
}

export async function recordCorrection(context: RecordContext, input: CorrectionInput): Promise<Result<RecordReceipt, string>> {
  const topic = input.topic.trim();
  if (topic === "" || input.previous.trim() === "" || input.corrected.trim() === "") {
    return err("A correction needs a topic, the previous belief, and the corrected belief");
  }
  const journey = context.journey;
  if (journey === undefined) return err("A correction needs a journey");
  const date = context.now();
  // The corrected belief comes first so a search shows what is true now.
  const lines = [
    `# Correction: ${topic}`,
    "",
    `**Now true:** ${input.corrected.trim()}`,
    "",
    `- **Previously recorded:** ${input.previous.trim()}`,
    `- **Recorded:** ${date.toISOString()}`,
  ];
  const note = input.note?.trim();
  if (note !== undefined && note !== "") lines.push("", note);
  return write(context, "correction", date, topic, {
    frontmatter: { type: "correction", topic, date: date.toISOString(), journey: journey.slug, session: context.sessionId ?? null },
    body: lines.join("\n"),
  });
}

async function write(context: RecordContext, kind: RecordKind, date: Date, title: string, document: { frontmatter: JsonRecord; body: string }): Promise<Result<RecordReceipt, string>> {
  const directory = join(context.journey?.dir ?? context.root, DIRECTORIES[kind]);
  await mkdir(directory, { recursive: true });
  const stem = `${date.toISOString().slice(0, 10)}-${slugify(title)}`;
  const text = renderMarkdown(document.frontmatter, document.body);
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
    const file = join(directory, attempt === 1 ? `${stem}.md` : `${stem}-${String(attempt)}.md`);
    if (await createExclusive(file, text)) return ok({ kind, file });
  }
  return err(`Could not find a free file name for ${stem}`);
}

async function createExclusive(path: string, text: string): Promise<boolean> {
  try {
    await writeFile(path, text, { flag: "wx" });
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
    throw error;
  }
}
