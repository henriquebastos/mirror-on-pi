import { stringField, type JsonRecord } from "../../../src/json.ts";

// The identity of one cell of the matrix: arm, model, scenario, and repetition.
export type CellKey = { readonly arm: string; readonly model: string; readonly scenario: string; readonly rep: number };

export function cellId(key: CellKey): string {
  return `${key.arm}|${key.model}|${key.scenario}|${String(key.rep)}`;
}

// The key of a result record.
export function keyOf(entry: JsonRecord): string {
  return cellId({ arm: stringField(entry, "arm") ?? "", model: stringField(entry, "model") ?? "", scenario: stringField(entry, "scenario") ?? "", rep: Number(entry.rep) });
}
