import { gameData } from "../src/data";
import { newGame } from "../src/sim/init";
import { createRng, type Rng } from "../src/sim/rng";
import type { GameData } from "../src/sim/tuning";
import type { Borrower, GameState } from "../src/sim/types";

/** An Rng that returns the given values in order, then repeats the last one. */
export function fixedRng(...values: number[]): Rng {
  let i = 0;
  return { next: () => values[Math.min(i++, values.length - 1)]! };
}

/** Never triggers a default (every roll is the highest possible value). */
export const noDefaults: Rng = { next: () => 0.999999 };

/**
 * The real game data with no events and no loan requests drawn, for unit tests of other systems:
 * no event roll can fire and End Turn draws no request rolls, so tests can count rolls exactly.
 */
export const quiet: GameData = {
  ...gameData,
  events: [],
  tuning: { ...gameData.tuning, loans: { ...gameData.tuning.loans, requests_per_quarter: 0 } },
};

/** Test borrowers with known quality, standing in for the old tiers. GOOD_2 is a second good borrower. */
export const POOR = 1;
export const FAIR = 2;
export const GOOD = 3;
export const GOOD_2 = 4;

const testBorrowers: [number, string, number, number][] = [
  [POOR, "Poor and Co.", 0.3, 0.16],
  [FAIR, "Fair and Co.", 0.6, 0.1],
  [GOOD, "Good and Co.", 0.9, 0.06],
  [GOOD_2, "Good Brothers", 0.9, 0.06],
];

/**
 * A new game whose borrowers are the four test borrowers, each with an open request for any amount
 * up to 10,000,000 fl. Requests last one quarter, as in play.
 */
export function fresh(): GameState {
  const s = newGame(quiet, createRng(1));
  s.borrowers = testBorrowers.map(([id, name, quality]): Borrower => ({
    id, name, trade: "test trade", quality, market_quality: quality, estimate_noise: 0, reported: false, repaid: 0, defaulted: 0, last_default_turn: null,
  }));
  s.requests = testBorrowers.map(([id, , , max_rate]) => ({ borrower_id: id, amount: 10_000_000, max_rate }));
  return s;
}

/** Puts the four test borrowers' open requests back, so a test setup can lend to the same one again. */
export function reopenRequests(s: GameState): void {
  s.requests = fresh().requests;
}
