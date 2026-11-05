// Trial numbers for tuning: a patch laid over the game data without editing data/*.json.
import type { GameData, GameEvent } from "../sim/tuning";

/**
 * An overrides file: `tuning` is a partial copy of tuning.json whose values replace the real ones
 * (objects merge key by key; anything else replaces), and `events` sets fields on events by id.
 */
export interface Overrides {
  tuning?: Record<string, unknown>;
  events?: Record<string, Partial<Pick<GameEvent, "weight" | "cooldown_quarters">>>;
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

/** The game data with the overrides applied. Unknown keys or event ids are errors, so typos cannot pass silently. */
export function applyOverrides(data: GameData, o: Overrides): GameData {
  const tuning = o.tuning ? (merge(data.tuning, o.tuning, "") as GameData["tuning"]) : data.tuning;
  const known = new Set(data.events.map((e) => e.id));
  for (const id of Object.keys(o.events ?? {})) if (!known.has(id)) throw new Error(`Override for unknown event "${id}"`);
  const events = data.events.map((e) => (o.events?.[e.id] ? { ...e, ...o.events[e.id] } : e));
  return { ...data, tuning, events };
}

/**
 * Overrides setting one value by a dotted path, as a sweep grid names them: "tuning.loans.p0" or
 * "events.warehouse-fire.weight".
 */
export function overrideAt(path: string, value: unknown): Overrides {
  const [root, ...rest] = path.split(".");
  if (root === "events") {
    const [id, field] = rest;
    if (!id || !field) throw new Error(`Event override "${path}" needs an id and a field`);
    return { events: { [id]: { [field]: value } } };
  }
  if (root !== "tuning" || !rest.length) throw new Error(`Override path "${path}" must start with tuning. or events.`);
  const tuning: Record<string, unknown> = {};
  let at = tuning;
  rest.forEach((k, i) => {
    if (i === rest.length - 1) at[k] = value;
    else at = (at[k] = {}) as Record<string, unknown>;
  });
  return { tuning };
}

/** Combines overrides, later ones winning. */
export function combine(...all: Overrides[]): Overrides {
  const out: Overrides = {};
  for (const o of all) {
    if (o.tuning) out.tuning = deepMerge(out.tuning ?? {}, o.tuning);
    if (o.events) for (const [id, f] of Object.entries(o.events)) out.events = { ...out.events, [id]: { ...out.events?.[id], ...f } };
  }
  return out;
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k] as Record<string, unknown>, v) : v;
  return out;
}
