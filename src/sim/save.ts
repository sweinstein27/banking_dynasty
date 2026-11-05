// Save files: one JSON document per game. Pure string in, string out; the caller does the file I/O.
import { bondBook } from "./bonds";
import { applyDecisions } from "./decisions";
import { accountBalance } from "./ledger";
import type { GameData } from "./tuning";
import { loanBook } from "./turn";
import type { Decision, GameState, LedgerAccount } from "./types";
import { ventureBook } from "./ventures";

export const SAVE_VERSION = 1;

export interface SaveFile {
  version: number;
  /** Seed the run started from, kept so the player can replay it. */
  seed: number;
  /** RNG internal state at the start of the current turn; createRng(rng_state) resumes the sequence. */
  rng_state: number;
  /** State at the start of the current turn, before queued decisions. */
  state: GameState;
  /** Decisions queued this turn but not yet resolved by End Turn. */
  queued: Decision[];
}

export function toSave(state: GameState, seed: number, rng_state: number, queued: Decision[]): string {
  const save: SaveFile = { version: SAVE_VERSION, seed, rng_state, state, queued };
  return JSON.stringify(save, null, 1);
}

export type ParseResult = { ok: true; save: SaveFile } | { ok: false; reason: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isUint32 = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;

/**
 * Reads a save file. Refuses anything that is not valid JSON, has a different version, is missing
 * parts of the game state, has balances that do not match its ledger, or has queued decisions the
 * sim would refuse.
 */
export function parseSave(text: string, data: GameData): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "Not a save file (not valid JSON)" };
  }
  if (!isObject(raw)) return { ok: false, reason: "Not a save file" };
  if (raw.version !== SAVE_VERSION) return { ok: false, reason: `Unsupported save version ${String(raw.version)} (expected ${SAVE_VERSION})` };
  if (!isUint32(raw.seed) || !isUint32(raw.rng_state)) return { ok: false, reason: "Save file has a bad seed or RNG state" };
  if (!Array.isArray(raw.queued)) return { ok: false, reason: "Save file has no queued decisions list" };

  const s = raw.state;
  if (!isObject(s) || !isObject(s.world) || !isObject(s.house)) return { ok: false, reason: "Save file has no game state" };
  for (const key of ["loans", "bonds", "defaulted_states", "ventures", "ledger", "news"] as const) {
    if (!Array.isArray(s[key])) return { ok: false, reason: `Save file state is missing "${key}"` };
  }
  for (const key of ["next_ledger_id", "actions_this_turn"] as const) {
    if (!Number.isInteger(s[key])) return { ok: false, reason: `Save file state is missing "${key}"` };
  }
  const state = s as unknown as GameState;
  if (typeof state.house.cash !== "number" || typeof state.house.deposits !== "number" || typeof state.world.turn !== "number")
    return { ok: false, reason: "Save file state is missing balances" };

  const books: Record<LedgerAccount, number> = {
    cash: state.house.cash,
    loans: loanBook(state),
    bonds: bondBook(state),
    ventures: ventureBook(state),
    deposits: state.house.deposits,
  };
  for (const [account, balance] of Object.entries(books) as [LedgerAccount, number][]) {
    if (accountBalance(state, account) !== balance)
      return { ok: false, reason: `Save file ${account} balance does not match its ledger` };
  }

  const queued = raw.queued as Decision[];
  const replay = applyDecisions(state, queued, data);
  if (!replay.ok) return { ok: false, reason: `Save file has a queued decision the game refuses: ${replay.reason}` };

  return { ok: true, save: { version: SAVE_VERSION, seed: raw.seed as number, rng_state: raw.rng_state as number, state, queued } };
}
