import { gameData } from "../src/data";
import { person } from "../src/sim/family";
import { newGame } from "../src/sim/init";
import { createBooks } from "../src/sim/systems/credit";
import { createRng, type Rng } from "../src/sim/rng";
import type { GameData } from "../src/sim/tuning";
import type { Borrower, GameState, Person } from "../src/sim/types";

/** An Rng that returns the given values in order, then repeats the last one. */
export function fixedRng(...values: number[]): Rng {
  let i = 0;
  return { next: () => values[Math.min(i++, values.length - 1)]! };
}

/** Never triggers a default (every roll is the highest possible value). */
export const noDefaults: Rng = { next: () => 0.999999 };

/**
 * The real game data with no events, no other houses, no loan requests drawn and no deposit flows, for unit tests of
 * other systems: no event roll can fire, End Turn draws no request rolls, and deposits change only
 * by what the test does, so tests can count rolls and balances exactly.
 */
export const quiet: GameData = {
  ...gameData,
  events: [],
  houses: { ...gameData.houses, houses: [] },
  tuning: {
    ...gameData.tuning,
    loans: { ...gameData.tuning.loans, requests_per_quarter: 0 },
    deposits: { ...gameData.tuning.deposits, catch_up: 0, interest_rate: 0 },
  },
  // The counting house (A2) keeps its staff and capacity but pays nothing and rolls nothing.
  counting: {
    ...gameData.counting,
    roles: Object.fromEntries(Object.entries(gameData.counting.roles).map(([k, r]) => [k, { ...r, wage: 0 }])) as typeof gameData.counting.roles,
    rooms: gameData.counting.rooms.map((r) => ({ ...r, upkeep: 0 })),
    candidates_per_role: 0,
    advice: { ...gameData.counting.advice, enabled: false },
  },
  // People (B2): no family letters, so no rolls and no claims or feuds; studies still work.
  people: { ...gameData.people, enabled: false },
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

/** Term of the test borrowers' requests: commercial credit for a year, the old fixed term. */
export const TEST_TERM = 4;

/**
 * A new game whose borrowers are the four test borrowers, each with an open request for any amount
 * up to 10,000,000 fl. of commercial credit for TEST_TERM quarters. Requests last one quarter, as in play. Nobody has traits, so unit tests of
 * other systems see neutral stats; trait tests add traits themselves.
 */
export function fresh(): GameState {
  const s = newGame(quiet, createRng(1));
  for (const p of s.people) p.traits = [];
  s.borrowers = testBorrowers.map(([id, name, quality]): Borrower => ({
    id, name, trade: "test trade", quality, market_quality: quality, books: createBooks(quality, s.world.year, quiet, createRng(id)), file: null,
    repaid: 0, defaulted: 0, last_default_turn: null, away_until: null,
  }));
  s.requests = testBorrowers.map(([id, , , max_rate]) => ({ borrower_id: id, kind: "commercial", term_quarters: TEST_TERM, amount: 10_000_000, max_rate, talk: "steady" }));
  return s;
}

/** Puts the four test borrowers' open requests back, so a test setup can lend to the same one again. */
export function reopenRequests(s: GameState): void {
  s.requests = fresh().requests;
}
/** Seed for the panic golden run, picked with `npm run find-panic-seed`; see docs/decisions.md. */
export const PANIC_SEED = 1421;


/** Marries the person `memberId` to a new spouse of the other gender, born in `birthYear`. Returns the spouse. */
export function addSpouse(s: GameState, memberId: number, birthYear: number): Person {
  const member = s.people.find((p) => p.id === memberId)!;
  const spouse = { ...person(s.people.length + 1, "Test Spouse", member.gender === "m" ? "f" : "m", birthYear, "spouse"), origin: "merchant" } as Person;
  s.people.push(spouse);
  member.spouse = spouse.id;
  spouse.spouse = member.id;
  return spouse;
}
