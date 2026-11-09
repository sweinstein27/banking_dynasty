// Save files: one JSON document per game. Pure string in, string out; the caller does the file I/O.
import { politicsAccounts } from "./systems/politics";
import { billsBook, branchesBook } from "./europe/branches";
import { bondBook } from "./bonds";
import { debtBook } from "./crisis";
import { applyDecisions } from "./decisions";
import { accountBalance } from "./ledger";
import type { GameData } from "./tuning";
import { loanBook } from "./turn";
import type { Decision, GameState, LedgerAccount } from "./types";
import { ventureBook } from "./ventures";
import { commoditiesBook, sharesBook } from "./systems/markets";
import { financeAccounts } from "./systems/finance";
import { warLoansBook } from "./systems/war";
import { rivalsAccounts } from "./systems/rivals";

export const SAVE_VERSION = 17;

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
  for (const key of ["loans", "bonds", "defaulted_states", "ventures", "ledger", "news", "fired_events", "borrowers", "requests", "debts", "people", "successions", "year_ends", "letters", "letter_outcomes", "scheduled_events", "houses", "marriages"] as const) {
    if (!Array.isArray(s[key])) return { ok: false, reason: `Save file state is missing "${key}"` };
  }
  for (const key of ["credit", "counting", "markets", "finance", "agendas", "europe", "progress", "rivals", "legacy", "politics", "war"] as const) {
    if (!isObject(s[key])) return { ok: false, reason: `Save file state is missing "${key}"` };
  }
  const mk = s.markets as Record<string, unknown>;
  if (!Array.isArray(mk.companies) || !isObject(mk.commodities) || !isObject(mk.shares) || !isObject(mk.goods) || !isObject(mk.harvest) || !isUint32(mk.rng_state))
    return { ok: false, reason: "Save file markets are incomplete" };
  if (!isObject(s.risk_shift)) return { ok: false, reason: 'Save file state is missing "risk_shift"' };
  if (typeof s.trade_risk !== "number") return { ok: false, reason: 'Save file state is missing "trade_risk"' };
  if (!("panic_warning" in s)) return { ok: false, reason: 'Save file state is missing "panic_warning"' };
  if ((s.people as unknown[]).some((p) => !isObject(p) || !Array.isArray(p.traits))) return { ok: false, reason: "Save file has a person without traits" };
  if ((s.people as Record<string, unknown>[]).some((p) => !["line", "spouse", "left"].includes(p.role as string) || !["m", "f"].includes(p.gender as string) || !Array.isArray(p.parents)))
    return { ok: false, reason: "Save file has a person without a role, gender or parents" };
  if (!("designated_heir" in (s.house as object))) return { ok: false, reason: 'Save file house is missing "designated_heir"' };
  if (typeof s.withdrawal_policy !== "string") return { ok: false, reason: 'Save file state is missing "withdrawal_policy"' };
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
    borrowings: debtBook(state),
    shares: sharesBook(state),
    commodities: commoditiesBook(state),
    ...financeAccounts(state),
    ...rivalsAccounts(state),
    branches: branchesBook(state),
    bills: billsBook(state),
    war_loans: warLoansBook(state),
    ...politicsAccounts(state),
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
