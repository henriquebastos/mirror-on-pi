// Explicit records: journal entries and corrections.
// The vault file is written first and is the human-editable record.
// The AI Memory page is a published copy that makes the record recallable.
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Journey } from "./journey.ts";
import type { JsonRecord } from "./json.ts";
import { renderMarkdown } from "./markdown.ts";
import type { MemoryClient, MemoryError, PageInput, WrittenPage } from "./memory-client.ts";
import { err, ok, type Result } from "./result.ts";
import { slugify } from "./slug.ts";

export type RecordKind = "journal" | "correction";

export type RecordContext = {
  readonly journey: Journey;
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
  readonly memory: Result<WrittenPage, MemoryError>;
};

const MAX_NAME_ATTEMPTS = 20;
const DIRECTORIES: Readonly<Record<RecordKind, string>> = { journal: "journal", correction: "corrections" };

export async function saveJournal(client: MemoryClient, context: RecordContext, input: JournalInput): Promise<Result<RecordReceipt, string>> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title === "" || body === "") return err("A journal entry needs a title and a body");
  const date = context.now();
  return publish(client, context, "journal", {
    date,
    title,
    frontmatter: { type: "journal", title, date: date.toISOString(), journey: context.journey.slug, session: context.sessionId ?? null },
    body: `# ${title}\n\n${body}\n\n_Journal entry, ${date.toISOString().slice(0, 10)}._`,
    tier: "episodic",
    pinned: false,
    tags: ["journal"],
  });
}

export async function recordCorrection(client: MemoryClient, context: RecordContext, input: CorrectionInput): Promise<Result<RecordReceipt, string>> {
  const topic = input.topic.trim();
  if (topic === "" || input.previous.trim() === "" || input.corrected.trim() === "") {
    return err("A correction needs a topic, the previous belief, and the corrected belief");
  }
  const date = context.now();
  // The corrected belief comes first so search snippets show what is true now.
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
  return publish(client, context, "correction", {
    date,
    title: topic,
    frontmatter: { type: "correction", topic, date: date.toISOString(), journey: context.journey.slug, session: context.sessionId ?? null },
    body: lines.join("\n"),
    tier: "semantic",
    pinned: true,
    tags: ["correction"],
  });
}

// The vault file carries Mirror's frontmatter. The memory page carries only the body,
// because AI Memory adds its own metadata and would index frontmatter as text.
type Publication = {
  readonly date: Date;
  readonly title: string;
  readonly frontmatter: JsonRecord;
  readonly body: string;
  readonly tier: PageInput["tier"];
  readonly pinned: boolean;
  readonly tags: readonly string[];
};

async function publish(client: MemoryClient, context: RecordContext, kind: RecordKind, publication: Publication): Promise<Result<RecordReceipt, string>> {
  const directory = join(context.journey.dir, DIRECTORIES[kind]);
  await mkdir(directory, { recursive: true });
  const stem = `${publication.date.toISOString().slice(0, 10)}-${slugify(publication.title)}`;
  const text = renderMarkdown(publication.frontmatter, publication.body);
  // A name can be free in the vault but taken in AI Memory, for example after the user deleted a vault file.
  // Then the vault file is removed again and the next name is tried, so both places use the same name.
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
    const name = attempt === 1 ? `${stem}.md` : `${stem}-${String(attempt)}.md`;
    const path = join(directory, name);
    if (!(await createExclusive(path, text))) continue;
    const memory = await client.writePage(context.journey.scope, {
      path: `${DIRECTORIES[kind]}/${name}`,
      body: publication.body,
      tier: publication.tier,
      pinned: publication.pinned,
      tags: publication.tags,
      createOnly: true,
      sessionId: undefined,
    });
    if (!memory.ok && memory.error.kind === "rpc" && memory.error.reason === "precondition_failed") {
      await unlink(path);
      continue;
    }
    return ok({ kind, file: path, memory });
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
