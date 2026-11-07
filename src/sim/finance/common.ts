// Shared helpers for high finance: the system's own random stream, news, payments that may force
// sales, and small number helpers.
import { raiseCash } from "../liquidity";
import { createRng, type Rng } from "../rng";
import type { GameData } from "../tuning";
import type { GameState, NewsKind } from "../types";

/**
 * Runs `fn` with finance's own random stream and stores where it got to. Finance rolls every
 * quarter (announcements, placements, storms); drawing those from the run's RNG would shift every
 * other system's rolls, so it keeps its own stream, as the markets do. Mutates `state`.
 */
export function withFinanceRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = createRng(state.finance.rng_state);
  const out = fn(rng);
  state.finance.rng_state = rng.state;
  return out;
}

export function financeNews(state: GameState, text: string, title?: string, kind: NewsKind = "markets"): void {
  state.news.push({ turn: state.world.turn, kind, text, ...(title ? { title } : {}) });
}

export function nextId(state: GameState): number {
  return state.finance.next_id++;
}

/** A uniform draw in [lo, hi). */
export const between = (rng: Rng, range: number[]) => range[0]! + (range[1]! - range[0]!) * rng.next();

export const isBankrupt = (state: GameState) => state.house.status === "bankrupt";

/** Rounds to the nearest `step`. */
export const roundTo = (n: number, step: number) => Math.round(n / step) * step;

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;

/** Changes the player's reputation within 0 to 100. */
export function changeReputation(state: GameState, delta: number): void {
  state.house.reputation = clamp(state.house.reputation + delta, 0, 100);
}

/**
 * Makes sure cash covers `due`, selling assets at a discount if it does not. Returns false and
 * marks the house bankrupt if even that fails. Mutates `state`.
 */
export function ensureCash(state: GameState, due: number, data: GameData, purpose: string): boolean {
  if (state.house.status === "bankrupt") return false;
  if (state.house.cash < due) raiseCash(state, due - Math.max(0, state.house.cash), data.tuning, purpose);
  if (state.house.cash < due) {
    // The quarter's news reports the bankruptcy (src/sim/news.ts).
    state.house.status = "bankrupt";
    return false;
  }
  return true;
}
