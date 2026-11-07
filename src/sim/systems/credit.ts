// Credit (milestone A1): borrowers' books, information bought in tiers, loans of many lengths,
// selling loans. Owned by the credit session, with data/credit.json.
//
// Every borrower keeps books made from its hidden soundness (Borrower.quality) plus fixed quirks
// and the market. The player never sees the books whole: bourse talk is free and sometimes wrong,
// a correspondent's report shows turnover, book profit, debts and payment record, and a full
// inquiry adds collateral, the true profit and a partner's private remark. No verdict is given;
// defaults still come from the hidden quality, so careful reading pays.
import type { DecisionResult } from "../actions";
import { checkCapacity, useCapacity } from "../capacity";
import { fl } from "../format";
import { addEntry } from "../ledger";
import { freeCash } from "../reserves";
import { createRng, type Rng } from "../rng";
import { cloneState } from "../state";
import type { GameData } from "../tuning";
import type { Borrower, Decision, GameState, Loan, Sentiment } from "../types";

/** How sound a borrower looks, best first. Bourse talk and a partner's remark each name one. */
export type Band = "sound" | "steady" | "stretched" | "doubtful";
export type MoodTable = Record<Sentiment, number>;

/** data/credit.json */
export interface CreditData {
  books: {
    /** Yearly turnover starts in [min, max]; each quarter it moves by up to +/- drift, plus the mood's shift. */
    turnover: { min: number; max: number; drift: number; mood: MoodTable };
    /** True margin = base + per_quality * (quality - 0.5) + a fixed quirk of up to +/- spread + the mood's shift. */
    margin: { base: number; per_quality: number; spread: number; mood: MoodTable };
    /** Book margin adds up to dressing * (1 - quality): weak houses flatter their books. */
    dressing: number;
    /** Debts owed to others = turnover * (base + per_unsoundness * (1 - quality) + up to +/- spread). */
    debts: { base: number; per_unsoundness: number; spread: number };
    /** Collateral = turnover * (base + per_quality * quality + up to +/- spread). */
    collateral: { base: number; per_quality: number; spread: number };
    /** Years in trade at the start, loosely tied to quality. */
    years_in_trade: { min: number; max: number };
    /** Each quarter the borrower pays another lender late with chance chance * m_sentiment * (1 - quality); the record covers window_quarters. */
    late: { chance: number; window_quarters: number };
    /** A partner's remark reads quality plus a fixed quirk of up to +/- remark_spread. */
    remark_spread: number;
  };
  /** Bands from best to worst: a value at or above min falls in the band. */
  bands: { id: Band; min: number }[];
  info: {
    report_cost: number;
    inquiry_cost: number;
    /** A file this many quarters old can be bought again. */
    stale_quarters: number;
    /** Bourse talk tells the truth with chance accuracy + per_prudence * the head's Prudence, at most max; otherwise a band at random. */
    talk: { accuracy: number; per_prudence: number; max: number };
  };
  /** Another house buys a loan at principal * (1 - discount), discount = base + per_risk * (1 - market quality) + per_year_left * years left + mood, at most max. */
  sale: { base: number; per_risk: number; per_year_left: number; mood: MoodTable; max: number };
  /** What the bourse says, by band. */
  talk: Record<Band, string>;
  /** A partner's private remark after a full inquiry, by band. */
  remarks: Record<Band, string>;
}

/** A borrower's real books. Hidden: the player sees them only through a BookFile. */
export interface Books {
  /** Turnover a year, whole gulden. */
  turnover: number;
  /** True profit as a share of turnover. */
  margin: number;
  /** Profit as a share of turnover as the books show it (the true margin plus any dressing). */
  book_margin: number;
  /** Owed to other lenders, whole gulden. */
  debts: number;
  /** Property and goods that could be pledged, whole gulden. */
  collateral: number;
  /** Year the house began trading. */
  founded: number;
  /** Turns in which the borrower paid another lender late, within the record's window. */
  late: number[];
  /** Fixed draws in [-1, 1] (dressing in [0, 1]) that make each house's books its own. */
  quirks: { margin: number; debts: number; collateral: number; dressing: number; remark: number };
}

/** What the house has bought on a borrower, as it stood in the quarter bought. */
export interface BookFile {
  tier: "report" | "inquiry";
  turn: number;
  turnover: number;
  /** Yearly profit as the books show it. */
  profit: number;
  debts: number;
  /** Late payments to other lenders in the record's window. */
  late_payments: number;
  /** Inquiry only, else null. */
  collateral: number | null;
  true_profit: number | null;
  remark: Band | null;
}

/** state.credit: the stream of rolls that moves the books, kept apart so the main RNG's rolls are unchanged. */
export interface CreditState {
  rng_state: number;
}

export interface InquireDecision {
  kind: "inquire";
  borrower: number;
}

export interface SellLoanDecision {
  kind: "sell_loan";
  loan: number;
}

export type CreditDecision = InquireDecision | SellLoanDecision;
export type CreditCategory = "inquiry" | "loan_sale" | "principal_part" | "recovery";

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function createCredit(_data: GameData, rng: Rng): CreditState {
  return { rng_state: Math.floor(rng.next() * 4294967296) >>> 0 };
}

/** The band a value falls in. */
export function bandOf(x: number, data: GameData): Band {
  return (data.credit.bands.find((b) => x >= b.min) ?? data.credit.bands[data.credit.bands.length - 1]!).id;
}

/** The partner's remark band: quality plus the borrower's fixed remark quirk. */
export function remarkBand(b: Borrower, data: GameData): Band {
  return bandOf(b.quality + b.books.quirks.remark * data.credit.books.remark_spread, data);
}

/** New books for a borrower of `quality` in `year`. Seven rolls. */
export function createBooks(quality: number, year: number, data: GameData, rng: Rng): Books {
  const c = data.credit.books;
  const turnover = Math.round((c.turnover.min + rng.next() * (c.turnover.max - c.turnover.min)) / 100) * 100;
  const y = c.years_in_trade;
  const founded = year - Math.round(y.min + (y.max - y.min) * (0.5 * quality + 0.5 * rng.next()));
  const quirk = () => round3(rng.next() * 2 - 1);
  const quirks = { margin: quirk(), debts: quirk(), collateral: quirk(), dressing: round3((quirk() + 1) / 2), remark: quirk() };
  const books: Books = { turnover, margin: 0, book_margin: 0, debts: 0, collateral: 0, founded, late: [], quirks };
  deriveBooks(books, quality, "calm", data);
  return books;
}

/** Recomputes margins, debts and collateral from turnover, quality, the quirks and the mood. Mutates `books`. */
export function deriveBooks(books: Books, quality: number, sentiment: Sentiment, data: GameData): void {
  const c = data.credit.books;
  const q = books.quirks;
  books.margin = round3(c.margin.base + c.margin.per_quality * (quality - 0.5) + q.margin * c.margin.spread + c.margin.mood[sentiment]);
  books.book_margin = round3(books.margin + c.dressing * (1 - quality) * q.dressing);
  books.debts = Math.round((books.turnover * Math.max(0, c.debts.base + c.debts.per_unsoundness * (1 - quality) + q.debts * c.debts.spread)) / 100) * 100;
  books.collateral = Math.round((books.turnover * Math.max(0, c.collateral.base + c.collateral.per_quality * quality + q.collateral * c.collateral.spread)) / 100) * 100;
}

/** One quarter of trade for one borrower: turnover drifts with the mood and trade risk, a late payment may be recorded. Two rolls. Mutates `b`. */
export function tradeQuarter(b: Borrower, state: GameState, data: GameData, rng: Rng): void {
  const c = data.credit.books;
  const s = state.world.sentiment;
  const move = (rng.next() * 2 - 1) * c.turnover.drift + c.turnover.mood[s] - (state.trade_risk - 1) * c.turnover.drift;
  b.books.turnover = Math.max(c.turnover.min / 2, Math.round((b.books.turnover * (1 + move)) / 100) * 100);
  const lateChance = Math.min(1, c.late.chance * data.tuning.sentiment_multiplier[s] * (1 - b.quality));
  if (rng.next() < lateChance) b.books.late.push(state.world.turn);
  b.books.late = b.books.late.filter((t) => state.world.turn - t < c.late.window_quarters);
  deriveBooks(b.books, b.quality, s, data);
}

/** The system's End Turn step, after loans are serviced: every borrower trades a quarter, on credit's own stream of rolls. Mutates `state`. */
export function resolveCredit(state: GameState, _rng: Rng, data: GameData): void {
  const rng = createRng(state.credit.rng_state);
  for (const b of state.borrowers) tradeQuarter(b, state, data, rng);
  state.credit.rng_state = rng.state;
}

/** A file on the borrower's books as they stand now. */
export function fileOn(b: Borrower, tier: BookFile["tier"], turn: number, data: GameData): BookFile {
  const k = b.books;
  const full = tier === "inquiry";
  return {
    tier,
    turn,
    turnover: k.turnover,
    profit: Math.round((k.turnover * k.book_margin) / 100) * 100,
    debts: k.debts,
    late_payments: k.late.length,
    collateral: full ? k.collateral : null,
    true_profit: full ? Math.round((k.turnover * k.margin) / 100) * 100 : null,
    remark: full ? remarkBand(b, data) : null,
  };
}

/** True if the house's file on the borrower is old enough to buy again. */
export function fileStale(file: BookFile | null, turn: number, data: GameData): boolean {
  return file === null || turn - file.turn >= data.credit.info.stale_quarters;
}

/** Why a report or inquiry on `borrowerId` can't be bought now, or null. */
export function checkFile(state: GameState, borrowerId: number, tier: BookFile["tier"], data: GameData): string | null {
  const b = state.borrowers.find((x) => x.id === borrowerId);
  if (!b) return `Unknown borrower #${borrowerId}`;
  const noCapacity = checkCapacity(state, tier === "report" ? "report" : "inquire", data.tuning);
  if (noCapacity) return noCapacity;
  const asking = state.requests.some((r) => r.borrower_id === b.id);
  const owes = state.loans.some((l) => l.status === "active" && l.borrower_id === b.id);
  if (!asking && !owes) return `${b.name} is neither asking for a loan nor owes the house`;
  const f = b.file;
  if (f && !fileStale(f, state.world.turn, data) && (f.tier === "inquiry" || tier === "report"))
    return `You already have a recent ${f.tier === "inquiry" ? "inquiry" : "report"} on ${b.name}`;
  const cost = tier === "report" ? data.credit.info.report_cost : data.credit.info.inquiry_cost;
  if (cost > freeCash(state)) return `Not enough cash above the reserve (cost ${fl(cost)}, free ${fl(freeCash(state))})`;
  return null;
}

/** Buys a report or an inquiry. Returns a new state; the input is not changed. */
export function buyFile(state: GameState, borrowerId: number, tier: BookFile["tier"], data: GameData): DecisionResult {
  const reason = checkFile(state, borrowerId, tier, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const b = next.borrowers.find((x) => x.id === borrowerId)!;
  const cost = tier === "report" ? data.credit.info.report_cost : data.credit.info.inquiry_cost;
  b.file = fileOn(b, tier, next.world.turn, data);
  next.house.cash -= cost;
  useCapacity(next, tier === "report" ? "report" : "inquire", data.tuning);
  if (tier === "report") addEntry(next, "cash", "report", -cost, `Correspondent's report on ${b.name}`);
  else addEntry(next, "cash", "inquiry", -cost, `Full inquiry into ${b.name}`);
  return { ok: true, state: next };
}

/** Quarters a loan still has to run, counting this one. */
export function quartersLeft(loan: Pick<Loan, "start_turn" | "term_quarters">, turn: number): number {
  return Math.max(1, loan.term_quarters - (turn - loan.start_turn));
}

/** Share another house knocks off a loan's principal to buy it today. */
export function saleDiscount(loan: Loan, state: GameState, data: GameData): number {
  const c = data.credit.sale;
  const b = state.borrowers.find((x) => x.id === loan.borrower_id);
  const mq = b ? b.market_quality : loan.quality;
  const years = quartersLeft(loan, state.world.turn) / 4;
  return Math.min(c.max, c.base + c.per_risk * (1 - mq) + c.per_year_left * years + c.mood[state.world.sentiment]);
}

/** What another house pays for a loan today, in whole gulden. */
export function salePrice(loan: Loan, state: GameState, data: GameData): number {
  return Math.round(loan.principal * (1 - saleDiscount(loan, state, data)));
}

export function checkSellLoan(state: GameState, d: SellLoanDecision, data: GameData): string | null {
  const loan = state.loans.find((l) => l.id === d.loan);
  if (!loan) return `Unknown loan #${d.loan}`;
  const noCapacity = checkCapacity(state, "sell_loan", data.tuning);
  if (noCapacity) return noCapacity;
  if (loan.status !== "active") return `Loan #${loan.id} is not active`;
  return null;
}

/** Sells a loan to another house at a discount. Returns a new state; the input is not changed. */
export function sellLoan(state: GameState, d: SellLoanDecision, data: GameData): DecisionResult {
  const reason = checkSellLoan(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const loan = next.loans.find((l) => l.id === d.loan)!;
  const price = salePrice(loan, next, data);
  const note = `Loan #${loan.id} (${loan.borrower_name}) sold to another house for ${fl(price)}`;
  addEntry(next, "cash", "loan_sale", price, note);
  addEntry(next, "loans", "loan_sale", -loan.principal, note);
  next.house.cash += price;
  loan.status = "sold";
  useCapacity(next, "sell_loan", data.tuning);
  return { ok: true, state: next };
}

export const isCreditDecision = (d: Decision): d is CreditDecision => d.kind === "inquire" || d.kind === "sell_loan";

export function applyCreditDecision(state: GameState, d: CreditDecision, data: GameData): DecisionResult {
  switch (d.kind) {
    case "inquire":
      return buyFile(state, d.borrower, "inquiry", data);
    case "sell_loan":
      return sellLoan(state, d, data);
  }
}

/** One line for a queued decision of this system. */
export function describeCreditDecision(d: CreditDecision, state: GameState, data: GameData): string {
  switch (d.kind) {
    case "inquire": {
      const b = state.borrowers.find((x) => x.id === d.borrower);
      return `Full inquiry into ${b?.name ?? `borrower #${d.borrower}`} (${fl(data.credit.info.inquiry_cost)})`;
    }
    case "sell_loan": {
      const loan = state.loans.find((l) => l.id === d.loan);
      return loan ? `Sell loan #${loan.id} (${loan.borrower_name}) for ${fl(salePrice(loan, state, data))}` : `Sell loan #${d.loan}`;
    }
  }
}

/** Whole years a borrower has traded. */
export function yearsInTrade(b: Borrower, year: number): number {
  return year - b.books.founded;
}
