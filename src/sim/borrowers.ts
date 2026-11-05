// Named borrowers with hidden quality. The player sees an estimate range; the market's own estimate
// sets the rate a borrower will pay, so a better estimate than the market's is how you find bargains.
import { checkActionLeft, type DecisionResult } from "./actions";
import { fl } from "./format";
import { addEntry } from "./ledger";
import { freeCash } from "./reserves";
import type { Rng } from "./rng";
import type { GameData, Tuning } from "./tuning";
import type { Borrower, GameState, Loan, LoanRequest, ReportDecision } from "./types";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Draws every borrower in data/borrowers.json: true quality within its range, the market's
 * estimate, and the fixed noise behind the player's estimate. Three rolls per borrower, in data order.
 */
export function createBorrowers(data: GameData, rng: Rng): Borrower[] {
  const { noise } = data.tuning.loans.market;
  return data.borrowers.map((b, i) => {
    const [lo, hi] = b.quality;
    const quality = round3(lo + rng.next() * (hi - lo));
    const market_quality = round3(clamp01(quality + (rng.next() * 2 - 1) * noise));
    const estimate_noise = round3(rng.next() * 2 - 1);
    return { id: i + 1, name: b.name, trade: b.trade, quality, market_quality, estimate_noise, reported: false, repaid: 0, defaulted: 0, last_default_turn: null, away_until: null };
  });
}

/** Highest annual rate a borrower pays given the market's estimate: base + spread * (1 - q), to the nearest 0.5%. */
export function maxRate(marketQuality: number, tuning: Tuning): number {
  const { base, spread } = tuning.loans.rate;
  return Math.round((base + spread * (1 - marketQuality)) * 200) / 200;
}

/** Half-width of the player's estimate: report_width after a report, otherwise narrowed by the head's Prudence. */
export function estimateWidth(b: Pick<Borrower, "reported">, prudence: number, tuning: Tuning): number {
  const e = tuning.loans.estimate;
  if (b.reported) return e.report_width;
  return e.width * Math.max(0, 1 - prudence * e.prudence_step);
}

/** The quality range the player sees, given the head's Prudence. It always contains the true quality. */
export function estimateRange(b: Borrower, prudence: number, tuning: Tuning): { low: number; high: number } {
  const w = estimateWidth(b, prudence, tuning);
  const centre = b.quality + b.estimate_noise * w;
  return {
    low: Math.floor(clamp01(centre - w) * 100) / 100,
    high: Math.ceil(clamp01(centre + w) * 100) / 100,
  };
}

/** True if the borrower currently owes the house money. */
export function hasActiveLoan(state: GameState, borrowerId: number): boolean {
  return state.loans.some((l) => l.status === "active" && l.borrower_id === borrowerId);
}

/**
 * Next quarter's requests: up to requests_per_quarter borrowers, picked at random from those with
 * no active loan who are not staying away (after a default, or after the house called a loan in). Each asks for an amount drawn between
 * min and max (to the nearest 500 fl.), grown for every loan repaid, at the rate the market allows.
 * Two rolls per request. Returns the requests sorted by borrower id.
 */
export function drawRequests(state: GameState, data: GameData, rng: Rng): LoanRequest[] {
  const t = data.tuning.loans;
  const turn = state.world.turn;
  const pool = state.borrowers.filter(
    (b) => !hasActiveLoan(state, b.id) && (b.away_until === null || turn >= b.away_until),
  );
  const count = Math.min(pool.length, t.requests_per_quarter);
  const requests: LoanRequest[] = [];
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng.next() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    const b = pool[i]!;
    const a = t.request_amount;
    const growth = Math.min(a.max_growth, 1 + a.growth_per_repaid * b.repaid);
    const amount = Math.round(((a.min + rng.next() * (a.max - a.min)) * growth) / 500) * 500;
    requests.push({ borrower_id: b.id, amount, max_rate: maxRate(b.market_quality, data.tuning) });
  }
  return requests.sort((x, y) => x.borrower_id - y.borrower_id);
}

/** Marks a loan defaulted, writes off its principal, and updates the borrower's record. Mutates `state`. */
export function recordDefault(state: GameState, loan: Loan, note: string, tuning: Tuning): void {
  loan.status = "defaulted";
  addEntry(state, "loans", "default", -loan.principal, note);
  const b = state.borrowers.find((x) => x.id === loan.borrower_id);
  if (!b) return;
  b.defaulted += 1;
  b.last_default_turn = state.world.turn;
  b.away_until = state.world.turn + tuning.loans.defaulter_absence_quarters;
  b.market_quality = round3(clamp01(b.market_quality - tuning.loans.market.default_penalty));
}

/** Updates the borrower's record when a loan is repaid in full. Mutates `state`. */
export function recordRepayment(state: GameState, loan: Loan, tuning: Tuning): void {
  const b = state.borrowers.find((x) => x.id === loan.borrower_id);
  if (!b) return;
  b.repaid += 1;
  b.market_quality = round3(clamp01(b.market_quality + tuning.loans.market.repaid_bonus));
}

/** Returns why a report decision is invalid, or null if it can go ahead. */
export function checkReport(state: GameState, d: ReportDecision, tuning: Tuning): string | null {
  const b = state.borrowers.find((x) => x.id === d.borrower);
  if (!b) return `Unknown borrower #${d.borrower}`;
  const noAction = checkActionLeft(state, tuning);
  if (noAction) return noAction;
  if (!state.requests.some((r) => r.borrower_id === b.id)) return `${b.name} is not asking for a loan this quarter`;
  if (b.reported) return `You already have a report on ${b.name}`;
  const cost = tuning.loans.estimate.report_cost;
  if (cost > freeCash(state)) return `Not enough cash above the reserve (cost ${fl(cost)}, free ${fl(freeCash(state))})`;
  return null;
}

/** Pays a correspondent for a report on a borrower. Returns a new state; the input is not changed. */
export function buyReport(state: GameState, d: ReportDecision, data: GameData): DecisionResult {
  const reason = checkReport(state, d, data.tuning);
  if (reason) return { ok: false, reason };
  const next = structuredClone(state);
  const b = next.borrowers.find((x) => x.id === d.borrower)!;
  const cost = data.tuning.loans.estimate.report_cost;
  b.reported = true;
  next.house.cash -= cost;
  next.actions_this_turn += 1;
  addEntry(next, "cash", "report", -cost, `Correspondent's report on ${b.name}`);
  return { ok: true, state: next };
}
