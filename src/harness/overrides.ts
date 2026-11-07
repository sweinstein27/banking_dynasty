// Trial numbers for tuning: a patch laid over the game data without editing data/*.json.
import type { BondIssuer, GameData, GameEvent, VentureType } from "../sim/tuning";

/**
 * An overrides file: `tuning` is a partial copy of tuning.json whose values replace the real ones
 * (objects merge key by key; anything else replaces); `events`, `states` and `ventures` set
 * numeric fields on records of data/events.json, states.json and ventures.json by id.
 */
export interface Overrides {
  tuning?: Record<string, unknown>;
  /** Partial copies of data/credit.json, data/markets.json and data/counting.json, merged like `tuning`. */
  credit?: Record<string, unknown>;
  markets?: Record<string, unknown>;
  counting?: Record<string, unknown>;
  /**
   * Multiplies a numeric field on every record of a list, by "list.field": "ventures.failure_risk",
   * "markets.sectors.growth", "markets.companies.base_yield". One number moves many records.
   */
  scale?: Record<string, number>;
  events?: Record<string, Partial<Pick<GameEvent, "weight" | "cooldown_quarters">>>;
  states?: Record<string, Partial<Pick<BondIssuer, "coupon" | "risk" | "min_reputation">>>;
  ventures?: Record<string, Partial<Pick<VentureType, "expected_return" | "failure_risk" | "term_quarters">>>;
}

const RECORD_FIELDS = {
  events: ["weight", "cooldown_quarters"],
  states: ["coupon", "risk", "min_reputation"],
  ventures: ["expected_return", "failure_risk", "term_quarters"],
} as const;
type RecordKind = keyof typeof RECORD_FIELDS;

/** Applies field overrides to records by id, refusing unknown ids and fields. */
function patchRecords<T extends { id: string }>(kind: RecordKind, records: T[], patch: Record<string, object> | undefined): T[] {
  if (!patch) return records;
  const known = new Set(records.map((r) => r.id));
  for (const [id, fields] of Object.entries(patch)) {
    if (!known.has(id)) throw new Error(`Override for unknown ${kind.slice(0, -1)} "${id}"`);
    for (const f of Object.keys(fields)) if (!(RECORD_FIELDS[kind] as readonly string[]).includes(f)) throw new Error(`Cannot override ${kind}.${id}.${f}`);
  }
  return records.map((r) => (patch[r.id] ? { ...r, ...patch[r.id] } : r));
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function merge(base: unknown, patch: unknown, path: string): unknown {
  if (!isPlainObject(patch)) return patch;
  if (!isPlainObject(base)) throw new Error(`Override "${path}" is an object, but tuning has no object there`);
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in base)) throw new Error(`Override "${path ? `${path}.` : ""}${k}" is not in tuning.json`);
    out[k] = merge(base[k], v, path ? `${path}.${k}` : k);
  }
  return out;
}

/** The game data with the overrides applied. Unknown keys, ids or fields are errors, so typos cannot pass silently. */
export function applyOverrides(data: GameData, o: Overrides): GameData {
  const tuning = o.tuning ? (merge(data.tuning, o.tuning, "") as GameData["tuning"]) : data.tuning;
  const out: GameData = {
    ...data,
    tuning,
    credit: o.credit ? (merge(data.credit, o.credit, "credit") as GameData["credit"]) : data.credit,
    markets: o.markets ? (merge(data.markets, o.markets, "markets") as GameData["markets"]) : data.markets,
    counting: o.counting ? (merge(data.counting, o.counting, "counting") as GameData["counting"]) : data.counting,
    events: patchRecords("events", data.events, o.events),
    states: patchRecords("states", data.states, o.states),
    ventures: patchRecords("ventures", data.ventures, o.ventures),
  };
  for (const [key, factor] of Object.entries(o.scale ?? {})) scaleField(out, key, factor);
  return out;
}

/** Multiplies `field` on every record of the list named by `key` ("ventures.failure_risk", "markets.sectors.growth"). Mutates `data`'s copies. */
function scaleField(data: GameData, key: string, factor: number): void {
  const parts = key.split(".");
  const field = parts.pop()!;
  let owner: Record<string, unknown> = data as unknown as Record<string, unknown>;
  for (const k of parts.slice(0, -1)) owner = (owner[k] = { ...(owner[k] as Record<string, unknown>) }) as Record<string, unknown>;
  const listKey = parts.at(-1)!;
  const list = owner[listKey];
  if (!Array.isArray(list)) throw new Error(`Scale "${key}": ${parts.join(".")} is not a list`);
  owner[listKey] = list.map((r: Record<string, unknown>) => {
    if (typeof r[field] !== "number") throw new Error(`Scale "${key}": a record has no number "${field}"`);
    return { ...r, [field]: (r[field] as number) * factor };
  });
}

/**
 * Overrides setting one value by a dotted path, as a sweep grid names them: "tuning.loans.p0",
 * "events.warehouse-fire.weight", "states.naples.coupon" or "ventures.mill.expected_return".
 */
export function overrideAt(path: string, value: unknown): Overrides {
  const [root, ...rest] = path.split(".");
  if (root === "events" || root === "states" || root === "ventures") {
    const [id, field] = rest;
    if (!id || !field) throw new Error(`Override "${path}" needs an id and a field`);
    return { [root]: { [id]: { [field]: value } } };
  }
  if (root === "scale") return { scale: { [rest.join(".")]: value as number } };
  if (!(root === "tuning" || root === "credit" || root === "markets" || root === "counting") || !rest.length)
    throw new Error(`Override path "${path}" must start with tuning., credit., markets., counting., scale., events., states. or ventures.`);
  const patch: Record<string, unknown> = {};
  let at = patch;
  rest.forEach((k, i) => {
    if (i === rest.length - 1) at[k] = value;
    else at = (at[k] = {}) as Record<string, unknown>;
  });
  return { [root]: patch };
}

/** Combines overrides, later ones winning. */
export function combine(...all: Overrides[]): Overrides {
  const out: Overrides = {};
  for (const o of all) {
    for (const root of ["tuning", "credit", "markets", "counting"] as const) {
      if (o[root]) out[root] = deepMerge(out[root] ?? {}, o[root]!);
    }
    if (o.scale) out.scale = { ...out.scale, ...o.scale };
    for (const kind of ["events", "states", "ventures"] as const) {
      for (const [id, f] of Object.entries(o[kind] ?? {})) out[kind] = { ...out[kind], [id]: { ...(out[kind] as Record<string, object> | undefined)?.[id], ...f } };
    }
  }
  return out;
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k] as Record<string, unknown>, v) : v;
  return out;
}
