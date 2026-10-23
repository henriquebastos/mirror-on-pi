// Bind each Pi session to one journey before its first message.
// A session never changes journey: switching journeys means starting another session.
import { isRecord, numberField, stringField } from "./json.ts";
import type { MemoryScope } from "./memory-client.ts";

export const BINDING_ENTRY_TYPE = "mirror-binding";
const BINDING_VERSION = 1;

export type JourneyBinding = {
  readonly version: typeof BINDING_VERSION;
  readonly journey: string;
  readonly workspace: string;
  readonly project: string;
};

export type EntryShape = {
  readonly type: string;
  readonly customType?: string;
  readonly data?: unknown;
};

export type BindingDecision =
  | { readonly kind: "create"; readonly binding: JourneyBinding }
  | { readonly kind: "bound"; readonly binding: JourneyBinding }
  | { readonly kind: "mismatch"; readonly existing: JourneyBinding; readonly requested: JourneyBinding }
  | { readonly kind: "unbound-history" }
  | { readonly kind: "corrupt"; readonly message: string };

export function bindingFor(journey: string, scope: MemoryScope): JourneyBinding {
  return { version: BINDING_VERSION, journey, workspace: scope.workspace, project: scope.project };
}

export function decideBinding(entries: readonly EntryShape[], requested: JourneyBinding): BindingDecision {
  const bindings = entries.filter((entry) => entry.type === "custom" && entry.customType === BINDING_ENTRY_TYPE);
  if (bindings.length === 0) {
    const hasHistory = entries.some((entry) => entry.type === "message" || entry.type === "custom_message");
    return hasHistory ? { kind: "unbound-history" } : { kind: "create", binding: requested };
  }
  const parsed = bindings.map((entry) => parseBinding(entry.data));
  const first = parsed[0];
  if (first === undefined) return { kind: "corrupt", message: "Binding entry has no data" };
  if (parsed.some((binding) => binding === undefined || !sameBinding(binding, first))) {
    return { kind: "corrupt", message: "Session has invalid or conflicting journey bindings" };
  }
  return sameBinding(first, requested) ? { kind: "bound", binding: first } : { kind: "mismatch", existing: first, requested };
}

export function parseBinding(data: unknown): JourneyBinding | undefined {
  if (!isRecord(data) || numberField(data, "version") !== BINDING_VERSION) return undefined;
  const journey = stringField(data, "journey");
  const workspace = stringField(data, "workspace");
  const project = stringField(data, "project");
  if (journey === undefined || workspace === undefined || project === undefined) return undefined;
  return { version: BINDING_VERSION, journey, workspace, project };
}

function sameBinding(left: JourneyBinding | undefined, right: JourneyBinding): boolean {
  return left?.journey === right.journey && left.workspace === right.workspace && left.project === right.project;
}
