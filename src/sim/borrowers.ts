// Named borrowers with hidden quality. The player reads their books (src/sim/systems/credit.ts);
// the market's own estimate sets the rate a borrower will pay, so reading the books better than
// the market is how you find bargains.
import type { DecisionResult } from "./actions";
import { headStat } from "./family";
import { addEntry } from "./ledger";
import type { Rng } from "./rng";
import { bandOf, buyFile, checkFile, createBooks } from "./systems/credit";
import type { GameData, Tuning } from "./tuning";
import type { Borrower, GameState, Loan, LoanKind, LoanRequest, ReportDecision } from "./types";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round3 = (x: number) => Math.round(x * 1000) / 1000;

const KINDS: LoanKind[] = ["bill", "commercial", "mortgage"];

/**
 * Draws every borrower in data/borrowers.json: true quality within its range, the market's
 * estimate, and their books. Nine rolls per borrower, in data order.
 */
export function createBorrowers(data: GameData, rng: Rng): Borrower[] {
  const { noise } = data.tuning.loans.market;
  return data.borrowers.map((b, i) => {
    const [lo, hi] = b.quality;
    const quality = round3(lo + rng.next() * (hi - lo));
    const market_quality = round3(clamp01(quality + (rng.next() * 2 - 1) * noise));
    const books = createBooks(quality, data.tuning.start.year, data, rng);
    return { id: i + 1, name: b.name, trade: b.trade, quality, market_quality, books, file: null, repaid: 0, defaulted: 0, last_default_turn: null, away_until: null };
  });
}

/**
 * Highest annual rate a borrower pays for a loan of this kind and term, given the market's
 * estimate: base + spread * (1 - q) + the kind's premium (+ premium_per_year for each year beyond
 * the first), to the nearest 0.5%, never below 0.5%.
 */
export function maxRate(marketQuality: number, tuning: Tuning, kind: LoanKind = "commercial", termQuarters = 4): number {
  const { base, spread } = tuning.loans.rate;
  const k = tuning.loans.kinds[kind];
  const premium = k.premium + k.premium_per_year * Math.max(0, termQuarters / 4 - 1);
  return Math.max(0.005, Math.round((base + spread * (1 - marketQuality) + premium) * 200) / 200);
}

/** True if the borrower currently owes the house money. */
export function hasActiveLoan(state: GameState, borrowerId: number): boolean {
  return state.loans.some((l) => l.status === "active" && l.borrower_id === borrowerId);
}

/** The kind a roll in [0, 1) picks, by the kinds' weights. */
export function kindFor(u: number, tuning: Tuning): LoanKind {
  const total = KINDS.reduce((s, k) => s + tuning.loans.kinds[k].weight, 0);
  let x = u * total;
  for (const k of KINDS) {
    x -= tuning.loans.kinds[k].weight;
    if (x < 0) return k;
  }
  return KINDS[KINDS.length - 1]!;
}

/** Chance bourse talk about a borrower tells the truth, given the head's Prudence. */
export function talkAccuracy(prudence: number, data: GameData): number {
  const t = data.credit.info.talk;
  return Math.min(t.max, t.accuracy + t.per_prudence * prudence);
}

/**
 * Next quarter's requests: up to requests_per_quarter borrowers, picked at random from those with
 * no active loan who are not staying away (after a default, or after the house called a loan in).
 * Each asks for a kind of loan by the kinds' weights (a mortgage needs collateral to cover at
 * least the kind's smallest amount, else it becomes commercial credit), a term and an amount in
 * the kind's ranges (grown for every loan repaid; a mortgage never above mortgage_cover of
 * collateral), at the rate the market allows, and the bourse says something of them.
 * Six rolls per request. Returns the requests sorted by borrower id.
 */
export function drawRequests(state: GameState, data: GameData, rng: Rng): LoanRequest[] {
  const t = data.tuning.loans;
  const turn = state.world.turn;
  const pool = state.borrowers.filter(
    (b) => !hasActiveLoan(state, b.id) && (b.away_until === null || turn >= b.away_until),
  );
  const count = Math.min(pool.length, t.requests_per_quarter);
  const accuracy = count > 0 ? talkAccuracy(headStat(state, "prudence", data), data) : 0;
  const requests: LoanRequest[] = [];
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng.next() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    const b = pool[i]!;
    let kind = kindFor(rng.next(), data.tuning);
    const uAmount = rng.next();
    const uTerm = rng.next();
    const growth = Math.min(t.request_growth.max, 1 + t.request_growth.per_repaid * b.repaid);
    const amountFor = (k: LoanKind) => {
      const [lo, hi] = t.kinds[k].amount;
      return Math.round(((lo + uAmount * (hi - lo)) * growth) / 500) * 500;
    };
    let amount = amountFor(kind);
    if (kind === "mortgage") {
      amount = Math.min(amount, Math.floor((b.books.collateral * t.mortgage_cover) / 500) * 500);
      if (amount < t.kinds.mortgage.amount[0]) {
        kind = "commercial";
        amount = amountFor(kind);
      }
    }
    const [tlo, thi] = t.kinds[kind].term;
    const term_quarters = tlo + Math.min(thi - tlo, Math.floor(uTerm * (thi - tlo + 1)));
    const truthful = rng.next() < accuracy;
    const randomBand = data.credit.bands[Math.min(data.credit.bands.length - 1, Math.floor(rng.next() * data.credit.bands.length))]!.id;
    const talk = truthful ? bandOf(b.quality, data) : randomBand;
    requests.push({ borrower_id: b.id, kind, term_quarters, amount, max_rate: maxRate(b.market_quality, data.tuning, kind, term_quarters), talk });
  }
  return requests.sort((x, y) => x.borrower_id - y.borrower_id);
}

/**
 * What the house recovers when a loan defaults: the kind's recovery share of the principal,
 * scaled down when the borrower's collateral covers less than the principal. Whole gulden.
 */
export function defaultRecovery(state: GameState, loan: Loan, tuning: Tuning): number {
  const share = tuning.loans.kinds[loan.kind]?.recovery ?? 0;
  if (share <= 0 || loan.principal <= 0) return 0;
  const b = state.borrowers.find((x) => x.id === loan.borrower_id);
  const cover = b ? Math.min(1, b.books.collateral / loan.principal) : 0;
  return Math.round(loan.principal * share * cover);
}

/**
 * Marks a loan defaulted, writes off its principal, recovers what the collateral allows (mortgages),
 * and updates the borrower's record. Mutates `state`.
 */
export function recordDefault(state: GameState, loan: Loan, note: string, tuning: Tuning): void {
  loan.status = "defaulted";
  const recovered = defaultRecovery(state, loan, tuning);
  addEntry(state, "loans", "default", -loan.principal, note);
  if (recovered > 0) {
    state.house.cash += recovered;
    addEntry(state, "cash", "recovery", recovered, `Loan #${loan.id}: recovered from ${loan.borrower_name}'s collateral`);
  }
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
export function checkReport(state: GameState, d: ReportDecision, data: GameData): string | null {
  return checkFile(state, d.borrower, "report", data);
}

/** Pays a correspondent for a report on a borrower. Returns a new state; the input is not changed. */
export function buyReport(state: GameState, d: ReportDecision, data: GameData): DecisionResult {
  return buyFile(state, d.borrower, "report", data);
}
