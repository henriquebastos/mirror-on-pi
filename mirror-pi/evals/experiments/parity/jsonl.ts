// One JSON value per line. An empty or broken line is no value, as at the end of a file that is still written.
import { isRecord, parseJson, type JsonRecord } from "../../../src/json.ts";

export function jsonLine(line: string): unknown {
  if (line.trim() === "") return undefined;
  try {
    return parseJson(line);
  } catch {
    return undefined;
  }
}

export function recordList(value: unknown): readonly JsonRecord[] {
  if (!Array.isArray(value)) return [];
  const list: readonly unknown[] = value;
  return list.filter(isRecord);
}
