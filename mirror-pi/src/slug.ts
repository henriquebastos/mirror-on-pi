import { err, ok, type Result } from "./result.ts";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 64;

export function validateSlug(input: string): Result<string, string> {
  if (input.length > MAX_SLUG_LENGTH) return err(`Slug is longer than ${String(MAX_SLUG_LENGTH)} characters: ${input}`);
  if (!SLUG_PATTERN.test(input)) return err(`Slug must use lowercase letters, digits, and single hyphens: ${input}`);
  return ok(input);
}

// Derive a file-name slug from free text. Accents are removed; other symbols become hyphens.
export function slugify(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug === "" ? "entry" : slug;
}
