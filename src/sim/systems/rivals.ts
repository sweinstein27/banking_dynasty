// B1, rivals that act. The other houses bid against the player for state loans and large
// borrowers, poach the player's staff with better wages, buy the loans the player sells, and plot
// against the player (rumours, buying up the player's debts). The player can scheme back: spread
// rumours about a house, lure its clerks, buy its paper. Numbers live in data/rivals.json.
//
// Rivals rolls on its own random stream, seeded from where the run's RNG stands without drawing
// from it, so adding rivals shifts no other system's rolls.
import type { DecisionResult } from "../actions";
import { maxRate } from "../borrowers";
import { checkCapacity, useCapacity, workingCount } from "../capacity";
import { fl } from "../format";
import { changeOpinion, failHouse, tradingHouses } from "../houses";
import { addEntry } from "../ledger";
import { oddsWords } from "../letters";
import { freeCash } from "../reserves";
import { createRng, type Rng, type SeededRng } from "../rng";
import { cloneState } from "../state";
import type { GameData, Temperament } from "../tuning";
import type { Decision, GameState, Loan, NewsKind, OtherHouse, Sentiment } from "../types";
import { freeDesks, joinStaff, skillOf, working, type Staff } from "./counting";

type Range = number[];
type ByTemper = Record<Temperament, number>;

export type SchemeKind = "rumours" | "lure_clerk";
export type PlotKind = "rumours" | "buy_debt";

interface SchemeData {
  cost: number;
  /** Chance it works before the head's Connections and the house's reputation. */
  success: number;
  /** Added per point of the head's Connections above 5. */
  per_connection: number;
  /** Added per point of the house's reputation above 50. */
  per_reputation: number;
}

/** data/rivals.json */
export interface RivalsData {
  contracts: {
    /** A house this hostile or worse may undercut the player's bid for a state loan... */
    spite_opinion: number;
    /** ...with this chance, by one step. */
    spite_chance: number;
    step: number;
    min_commission: number;
  };
  loans: {
    /** Requests of this much or more draw a rival's offer. */
    large_from: number;
    /** A house competes only with wealth at least this many times the amount. */
    wealth_cover: number;
    /** How far below the borrower's highest rate each temper offers. */
    undercut: ByTemper;
    spite_opinion: number;
    spite_undercut: number;
    min_rate: number;
    /** Chance the borrower goes to the rival when the player asks more: base, plus per_point for every 1% above the rival, up to max. */
    steal: { base: number; per_point: number; max: number };
  };
  sales: {
    wealth_cover: number;
    /** A house of opinion 100 pays this share of the principal more; one of -100 this much less. */
    opinion_premium: number;
    /** The buyer's opinion rises by this. */
    opinion: number;
    /** Who buys when no Frankfurt house can. */
    fallback_buyer: string;
  };
  poach: {
    chance: ByTemper;
    hostile_opinion: number;
    hostile_factor: number;
    min_wealth: number;
    min_skill: number;
    /** The offer's rise over the member's wage, drawn in this range. */
    premium: Range;
    round_to: number;
    per_quarter: number;
  };
  plots: {
    /** Houses below this opinion may plot. */
    from_opinion: number;
    /** Chance a quarter at opinion -opinion_scale; scales with dislike, up to twice this. */
    chance: ByTemper;
    opinion_scale: number;
    /** Chance a plot is to buy the player's debts, when the player owes another house. */
    debt_share: number;
    /** Chance the player hears of a plot before it strikes. */
    hear: { base: number; per_correspondent: number; per_connection: number; max: number };
    counter_cost: Record<PlotKind, number>;
    rumours: { reputation: Range; deposit_share: number };
    per_quarter: number;
  };
  schemes: {
    rumours: SchemeData & { reputation: number; wealth_share: number };
    lure_clerk: SchemeData & { skill: Range; short_quarters: number };
    discovery: { base: number; per_connection: number; min: number; max: number };
    found_out: Record<SchemeKind, { reputation: number; opinion: number; others: number }>;
    chance_min: number;
    chance_max: number;
  };
  paper: {
    discount: number;
    rate: number;
    quarters: number;
    step: number;
    min_amount: number;
    /** Most of a house's wealth the player may hold in its paper. */
    max_share: number;
    /** Share of the face a house loses when its paper is presented early. */
    present_drain: number;
    present_opinion: number;
    /** In a panic, a house pushed below this share of its starting wealth by presented paper fails. */
    fail_below: number;
    recovery: Record<Sentiment, number>;
  };
}

/** A scheme of the player's, paid when queued and settled at End Turn. */
export interface Scheme {
  id: number;
  house: string;
  kind: SchemeKind;
  turn: number;
  cost: number;
  /** Null until End Turn. */
  worked: boolean | null;
  found_out: boolean | null;
}

/** A house's plot against the player: laid at one End Turn, strikes at the next. */
export interface Plot {
  id: number;
  house: string;
  kind: PlotKind;
  laid_turn: number;
  strike_turn: number;
  /** The player has heard of it, and may counter it. */
  heard: boolean;
  status: "laid" | "countered" | "struck" | "fizzled";
}

/** A house offers one of the player's staff a better wage. Open for one quarter. */
export interface PoachOffer {
  staff: number;
  house: string;
  /** The wage offered a quarter. */
  wage: number;
  open_turn: number;
  matched: boolean;
}

/** Bills of another house the player bought on the bourse. */
export interface Paper {
  id: number;
  house: string;
  face: number;
  /** What the player paid; the book value. */
  cost: number;
  rate: number;
  start_turn: number;
  due_turn: number;
  status: "held" | "repaid" | "presented" | "lost";
  /** The turn it stopped being held. */
  closed_turn: number | null;
}

/** state.rivals */
export interface RivalsState {
  rng_state: number;
  next_id: number;
  schemes: Scheme[];
  plots: Plot[];
  poach_offers: PoachOffer[];
  paper: Paper[];
  /** House id to the last turn it is short-handed (a lured clerk): no bids, no poaching. */
  short_until: Record<string, number>;
}

export interface SchemeDecision {
  kind: "scheme";
  house: string;
  scheme: SchemeKind;
}
export interface CounterPlotDecision {
  kind: "counter_plot";
  plot: number;
}
export interface MatchWageDecision {
  kind: "match_wage";
  /** Staff id. */
  staff: number;
}
export interface BuyPaperDecision {
  kind: "buy_paper";
  house: string;
  /** Face value, whole gulden. */
  amount: number;
}
export interface PresentPaperDecision {
  kind: "present_paper";
  paper: number;
}

export type RivalsDecision = SchemeDecision | CounterPlotDecision | MatchWageDecision | BuyPaperDecision | PresentPaperDecision;
export const RIVALS_KINDS = ["scheme", "counter_plot", "match_wage", "buy_paper", "present_paper"] as const;

export type RivalsCategory =
  | "scheme"
  | "counter_plot"
  | "rumour_withdrawal"
  | "paper_purchase"
  | "paper_interest"
  | "paper_repaid"
  | "paper_recovery"
  | "loan_refinanced";

/** Ledger accounts this system holds, counted in net worth through `rivalsBook`. */
export type RivalsAccount = "rival_paper";

// ---------- Helpers ----------

export function createRivals(_data: GameData, rng: Rng): RivalsState {
  const seed = ((rng as Partial<SeededRng>).state ?? Math.floor(rng.next() * 0x100000000)) ^ 0x2b1a75e5;
  return { rng_state: createRng(seed >>> 0).state, next_id: 1, schemes: [], plots: [], poach_offers: [], paper: [], short_until: {} };
}

/** Runs `fn` with rivals' own random stream and stores where it got to. Mutates `state`. */
export function withRivalsRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = createRng(state.rivals.rng_state);
  const out = fn(rng);
  state.rivals.rng_state = rng.state;
  return out;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const between = (rng: Rng, r: Range) => r[0]! + (r[1]! - r[0]!) * rng.next();
const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;

function news(state: GameState, text: string, title?: string, kind: NewsKind = "houses"): void {
  state.news.push({ turn: state.world.turn, kind, text, ...(title ? { title } : {}) });
}

function nextId(state: GameState): number {
  return state.rivals.next_id++;
}

/** The living head's Connections, or 5 if there is none. */
export function headConnections(state: GameState): number {
  return state.people.find((p) => p.is_head && p.death_year === null)?.connections ?? 5;
}

/** The house is short of clerks (the player lured one): it neither bids nor poaches. */
export function shortHanded(state: GameState, id: string): boolean {
  return (state.rivals.short_until[id] ?? -1) >= state.world.turn;
}

const houseById = (state: GameState, id: string) => state.houses.find((h) => h.id === id);

/** Paper of `house` the player still holds. */
export function heldPaper(state: GameState, house?: string): Paper[] {
  return state.rivals.paper.filter((p) => p.status === "held" && (!house || p.house === house));
}

/** What the player's holdings in this system are worth: paper at cost. */
export function rivalsBook(state: GameState): number {
  return heldPaper(state).reduce((s, p) => s + p.cost, 0);
}

/** Balances of the ledger accounts this system adds, for the save check. */
export function rivalsAccounts(state: GameState): Record<RivalsAccount, number> {
  return { rival_paper: rivalsBook(state) };
}

// ---------- State loans (called from src/sim/finance/contracts.ts) ----------

/**
 * A rival's bid for a state loan, after A5 has rolled whether it bids and at what commission. A
 * short-handed house does not bid. A hostile house that knows the player has bid may undercut the
 * player by one step (one roll on rivals' stream, only when the player has bid and the house is
 * hostile). Returns the commission, or null for no bid. Mutates `state` (the rivals stream).
 */
export function rivalBid(state: GameState, h: OtherHouse, commission: number, playerBid: number | null, data: GameData): number | null {
  if (shortHanded(state, h.id)) return null;
  const t = data.rivals.contracts;
  if (playerBid === null || h.opinion > t.spite_opinion || commission < playerBid) return commission;
  const spite = withRivalsRng(state, (rng) => rng.next() < t.spite_chance);
  if (!spite) return commission;
  return Math.round(Math.max(t.min_commission, playerBid - t.step) * 10000) / 10000;
}

// ---------- Large borrowers ----------

export interface RivalLoanOffer {
  house: string;
  name: string;
  rate: number;
}

/**
 * The best rate another house offers a borrower asking for `amount` at most `max_rate`, or null
 * when the request is small or no house can lend that much. Draws nothing, so the Desk can show it.
 */
export function rivalLoanOffer(state: GameState, req: { amount: number; max_rate: number }, data: GameData): RivalLoanOffer | null {
  const t = data.rivals.loans;
  if (req.amount < t.large_from) return null;
  const offers = tradingHouses(state)
    .filter((h) => !shortHanded(state, h.id) && h.wealth >= req.amount * t.wealth_cover)
    .map((h) => {
      const spite = h.opinion <= t.spite_opinion ? t.spite_undercut : 0;
      const rate = Math.round(Math.max(t.min_rate, req.max_rate - t.undercut[h.temperament] - spite) * 1000) / 1000;
      return { house: h.id, name: h.name, rate, wealth: h.wealth };
    })
    .sort((a, b) => a.rate - b.rate || b.wealth - a.wealth || a.house.localeCompare(b.house));
  const best = offers[0];
  return best ? { house: best.house, name: best.name, rate: best.rate } : null;
}

/** Chance a borrower lent to at `rate` goes to the rival offering `rivalRate` instead. */
export function stealChance(rate: number, rivalRate: number, data: GameData): number {
  if (rate <= rivalRate + 1e-9) return 0;
  const s = data.rivals.loans.steal;
  return clamp(s.base + (s.per_point * (rate - rivalRate)) / 0.01, 0, s.max);
}

/** The rival offer and the odds, in words, of losing the borrower at `rate`, for the Desk. */
export function rivalLoanWords(state: GameState, req: { amount: number; max_rate: number }, rate: number, data: GameData): string | null {
  const o = rivalLoanOffer(state, req, data);
  if (!o) return null;
  const p = stealChance(rate, o.rate, data);
  return p === 0 ? `${o.name} offers ${pct(o.rate)}; at your rate the borrower stays with you.` : `${o.name} offers ${pct(o.rate)}; at ${pct(rate)}, ${oddsWords(p)} the borrower goes to them.`;
}

/** Large loans made this quarter may be taken by a rival who offers less: the borrower repays the principal now. One roll per loan at risk. */
function rivalsTakeLoans(state: GameState, rng: Rng, data: GameData): void {
  const turn = state.world.turn;
  for (const loan of state.loans) {
    if (loan.status !== "active" || loan.start_turn !== turn || loan.principal <= 0) continue;
    const b = state.borrowers.find((x) => x.id === loan.borrower_id);
    if (!b) continue;
    const req = { amount: loan.principal, max_rate: maxRate(b.market_quality, data.tuning, loan.kind, loan.term_quarters) };
    const o = rivalLoanOffer(state, req, data);
    if (!o) continue;
    const p = stealChance(loan.rate, o.rate, data);
    if (p === 0 || rng.next() >= p) continue;
    takeLoan(state, loan, o);
  }
}

function takeLoan(state: GameState, loan: Loan, o: RivalLoanOffer): void {
  const note = `Loan #${loan.id}: ${loan.borrower_name} took ${o.name}'s offer of ${pct(o.rate)} and repaid you`;
  state.house.cash += loan.principal;
  addEntry(state, "cash", "loan_refinanced", loan.principal, note);
  addEntry(state, "loans", "loan_refinanced", -loan.principal, note);
  loan.status = "repaid";
  news(state, `${loan.borrower_name} has taken ${o.name}'s offer of ${pct(o.rate)} and repaid the ${fl(loan.principal)} you lent at ${pct(loan.rate)}.`, "A borrower is lured away");
}

// ---------- Selling loans (called from src/sim/systems/credit.ts) ----------

export interface LoanBuyer {
  /** The buying house, or null for the fallback buyer outside Frankfurt. */
  house: string | null;
  name: string;
  price: number;
}

/**
 * Who buys a loan of `principal` the player sells, and for how much. Every house trading that is
 * rich enough bids the market's price (`baseDiscount` off) adjusted by its opinion of the player;
 * the best price wins (ties to the richer house). When no Frankfurt house can buy, a house abroad
 * pays the market's price. Draws nothing.
 */
export function loanBuyer(state: GameState, principal: number, baseDiscount: number, data: GameData): LoanBuyer {
  const t = data.rivals.sales;
  const bids = tradingHouses(state)
    .filter((h) => h.wealth >= principal * t.wealth_cover)
    .map((h) => ({ h, price: Math.round(principal * clamp(1 - baseDiscount + (t.opinion_premium * h.opinion) / 100, 0, 1)) }))
    .sort((a, b) => b.price - a.price || b.h.wealth - a.h.wealth || a.h.id.localeCompare(b.h.id));
  const best = bids[0];
  if (!best) return { house: null, name: t.fallback_buyer, price: Math.round(principal * (1 - baseDiscount)) };
  return { house: best.h.id, name: best.h.name, price: best.price };
}

/** The buying house takes the loan: its wealth gains the discount and it thinks a little better of the player. Mutates `state`. */
export function recordLoanSale(state: GameState, buyer: LoanBuyer, principal: number, data: GameData): void {
  if (!buyer.house) return;
  const h = houseById(state, buyer.house);
  if (!h) return;
  h.wealth += principal - buyer.price;
  changeOpinion(state, h.id, data.rivals.sales.opinion, data.tuning);
}

// ---------- The player's schemes ----------

/** Chance a scheme against `h` works. */
export function schemeChance(state: GameState, h: OtherHouse, kind: SchemeKind, data: GameData): number {
  const t = data.rivals.schemes;
  const s = t[kind];
  return clamp(s.success + s.per_connection * (headConnections(state) - 5) + s.per_reputation * (h.reputation - 50), t.chance_min, t.chance_max);
}

/** Chance a scheme is found out, whether or not it works. */
export function discoveryChance(state: GameState, data: GameData): number {
  const d = data.rivals.schemes.discovery;
  return clamp(d.base + d.per_connection * (headConnections(state) - 5), d.min, d.max);
}

/** A scheme's cost and odds in words, for the Desk and the terminal. */
export function schemeTerms(state: GameState, h: OtherHouse, kind: SchemeKind, data: GameData): { cost: number; odds: string; found: string } {
  return {
    cost: data.rivals.schemes[kind].cost,
    odds: `${oddsWords(schemeChance(state, h, kind, data))} it works`,
    found: `${oddsWords(discoveryChance(state, data))} it is found out`,
  };
}

export function checkScheme(state: GameState, d: SchemeDecision, data: GameData): string | null {
  const noAction = checkCapacity(state, "scheme", data.tuning);
  if (noAction) return noAction;
  const h = houseById(state, d.house);
  if (!h) return `Unknown house "${d.house}"`;
  if (h.failed_turn !== null) return `${h.name} has failed`;
  const s = data.rivals.schemes[d.scheme];
  if (!s || (d.scheme !== "rumours" && d.scheme !== "lure_clerk")) return `Unknown scheme "${d.scheme}"`;
  if (state.rivals.schemes.some((x) => x.turn === state.world.turn && x.house === h.id)) return `The house already has a scheme against ${h.name} this quarter`;
  if (d.scheme === "lure_clerk") {
    if (shortHanded(state, h.id)) return `${h.name} is already short of clerks`;
    const queued = state.rivals.schemes.filter((x) => x.turn === state.world.turn && x.kind === "lure_clerk").length;
    if (freeDesks(state, data) - queued <= 0) return "No desk free in the counting room for a new clerk: build a larger room";
  }
  if (s.cost > freeCash(state)) return `Not enough cash above the reserve (cost ${fl(s.cost)}, free ${fl(freeCash(state))})`;
  return null;
}

/** Queues a scheme: paid now, settled at End Turn. Returns a new state. */
export function scheme(state: GameState, d: SchemeDecision, data: GameData): DecisionResult {
  const reason = checkScheme(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const cost = data.rivals.schemes[d.scheme].cost;
  const h = houseById(next, d.house)!;
  next.house.cash -= cost;
  addEntry(next, "cash", "scheme", -cost, d.scheme === "rumours" ? `Agents to talk down ${h.name} on the bourse` : `A signing fee for a clerk of ${h.name}`);
  next.rivals.schemes.push({ id: nextId(next), house: h.id, kind: d.scheme, turn: next.world.turn, cost, worked: null, found_out: null });
  useCapacity(next, "scheme", data.tuning);
  return { ok: true, state: next };
}

/** Settles this quarter's schemes, two rolls each (works, found out). Mutates `state`. */
function settleSchemes(state: GameState, rng: Rng, data: GameData): void {
  const t = data.rivals.schemes;
  for (const s of state.rivals.schemes) {
    if (s.turn !== state.world.turn || s.worked !== null) continue;
    const h = houseById(state, s.house);
    const worked = rng.next() < (h ? schemeChance(state, h, s.kind, data) : 0);
    const found = rng.next() < discoveryChance(state, data);
    s.worked = worked;
    s.found_out = found;
    if (!h || h.failed_turn !== null) {
      s.worked = false;
      continue;
    }
    if (worked && s.kind === "rumours") {
      h.reputation = clamp(h.reputation - t.rumours.reputation, 0, 100);
      h.wealth = Math.max(0, h.wealth - Math.round(h.wealth * t.rumours.wealth_share));
      news(state, `Talk on the bourse turns against ${h.name}; its name has slipped.`);
    }
    if (worked && s.kind === "lure_clerk") {
      if (freeDesks(state, data) > 0) {
        const skill = Math.round(between(rng, t.lure_clerk.skill));
        const name = `${data.counting.names.first[Math.floor(rng.next() * data.counting.names.first.length)]} ${data.counting.names.surnames[Math.floor(rng.next() * data.counting.names.surnames.length)]}`;
        const trait = data.counting.traits[Math.floor(rng.next() * data.counting.traits.length)]!.id;
        joinStaff(state, { name, skill, trait }, "clerk");
        state.rivals.short_until[h.id] = state.world.turn + t.lure_clerk.short_quarters;
        news(state, `${name}, a clerk of ${h.name}, has taken a desk in your counting house. ${h.name} is short-handed for a year.`);
      } else {
        s.worked = false;
        news(state, `The clerk from ${h.name} would have come, but there was no desk to give the clerk.`);
      }
    }
    if (!worked) news(state, s.kind === "rumours" ? `The bourse paid no mind to the talk against ${h.name}.` : `The clerk of ${h.name} would not leave the desk.`);
    if (found) {
      const f = t.found_out[s.kind];
      state.house.reputation = clamp(state.house.reputation + f.reputation, 0, 100);
      changeOpinion(state, h.id, f.opinion, data.tuning);
      if (f.others) for (const o of tradingHouses(state)) if (o.id !== h.id) changeOpinion(state, o.id, f.others, data.tuning);
      news(state, `${h.name} has learned who was behind it, and the bourse is talking.`, "A scheme found out");
    }
  }
}

// ---------- Paper ----------

/** Face value of `house`'s paper the player may still buy. */
export function paperRoom(state: GameState, h: OtherHouse, data: GameData): number {
  const t = data.rivals.paper;
  const held = heldPaper(state, h.id).reduce((s, p) => s + p.face, 0);
  return Math.max(0, Math.floor((h.wealth * t.max_share - held) / t.step) * t.step);
}

export const paperCost = (face: number, data: GameData) => Math.round(face * (1 - data.rivals.paper.discount));

export function checkBuyPaper(state: GameState, d: BuyPaperDecision, data: GameData): string | null {
  const noAction = checkCapacity(state, "buy_paper", data.tuning);
  if (noAction) return noAction;
  const t = data.rivals.paper;
  const h = houseById(state, d.house);
  if (!h) return `Unknown house "${d.house}"`;
  if (h.failed_turn !== null) return `${h.name} has failed`;
  if (!Number.isInteger(d.amount) || d.amount % t.step !== 0) return `Amount must be a multiple of ${fl(t.step)}`;
  if (d.amount < t.min_amount) return `Amount must be at least ${fl(t.min_amount)}`;
  const room = paperRoom(state, h, data);
  if (d.amount > room) return `Only ${fl(room)} of ${h.name}'s paper is to be had`;
  const cost = paperCost(d.amount, data);
  if (cost > freeCash(state)) return `Not enough cash above the reserve (cost ${fl(cost)}, free ${fl(freeCash(state))})`;
  return null;
}

/** Buys a house's bills on the bourse at a discount. Returns a new state. */
export function buyPaper(state: GameState, d: BuyPaperDecision, data: GameData): DecisionResult {
  const reason = checkBuyPaper(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const t = data.rivals.paper;
  const h = houseById(next, d.house)!;
  const cost = paperCost(d.amount, data);
  const p: Paper = { id: nextId(next), house: h.id, face: d.amount, cost, rate: t.rate, start_turn: next.world.turn, due_turn: next.world.turn + t.quarters, status: "held", closed_turn: null };
  next.rivals.paper.push(p);
  next.house.cash -= cost;
  const note = `Paper #${p.id}: ${fl(d.amount)} of ${h.name}'s bills, bought for ${fl(cost)}`;
  addEntry(next, "cash", "paper_purchase", -cost, note);
  addEntry(next, "rival_paper", "paper_purchase", cost, note);
  useCapacity(next, "buy_paper", data.tuning);
  return { ok: true, state: next };
}

export function checkPresentPaper(state: GameState, d: PresentPaperDecision, data: GameData): string | null {
  const noAction = checkCapacity(state, "present_paper", data.tuning);
  if (noAction) return noAction;
  const p = state.rivals.paper.find((x) => x.id === d.paper);
  if (!p) return `No paper #${d.paper}`;
  if (p.status !== "held") return `Paper #${p.id} is no longer held`;
  const h = houseById(state, p.house);
  if (!h || h.failed_turn !== null) return `${h?.name ?? p.house} has failed`;
  return null;
}

/** Presents a house's paper for payment at par before it is due: it pays at once, and is drained and offended. Returns a new state. */
export function presentPaper(state: GameState, d: PresentPaperDecision, data: GameData): DecisionResult {
  const reason = checkPresentPaper(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const t = data.rivals.paper;
  const p = next.rivals.paper.find((x) => x.id === d.paper)!;
  const h = houseById(next, p.house)!;
  next.house.cash += p.face;
  const note = `Paper #${p.id}: presented to ${h.name} for ${fl(p.face)} at par`;
  addEntry(next, "cash", "paper_repaid", p.face, note);
  addEntry(next, "rival_paper", "paper_repaid", -p.cost, note);
  p.status = "presented";
  p.closed_turn = next.world.turn;
  h.wealth = Math.max(0, h.wealth - Math.round(p.face * t.present_drain));
  changeOpinion(next, h.id, t.present_opinion, data.tuning);
  useCapacity(next, "present_paper", data.tuning);
  return { ok: true, state: next };
}

/**
 * The quarter's paper: a failed house's paper recovers a share; a house squeezed by presented
 * paper in a panic below `fail_below` of its starting wealth fails; held paper pays interest
 * (from the quarter after it was bought) and is repaid at par when due. Draws nothing. Mutates `state`.
 */
function settlePaper(state: GameState, data: GameData): void {
  const t = data.rivals.paper;
  const turn = state.world.turn;
  if (state.world.sentiment === "panic") {
    const squeezed = new Set(state.rivals.paper.filter((p) => p.status === "presented" && p.closed_turn === turn).map((p) => p.house));
    for (const id of squeezed) {
      const h = houseById(state, id);
      if (h && h.failed_turn === null && h.wealth < h.start_wealth * t.fail_below) {
        news(state, `${h.name} could not meet the bills presented to it, and has closed its doors.`, "A house fails");
        failHouse(state, h, data);
      }
    }
  }
  for (const p of heldPaper(state)) {
    const h = houseById(state, p.house);
    if (!h) continue;
    if (h.failed_turn !== null) {
      const back = Math.round(p.face * t.recovery[state.world.sentiment]);
      state.house.cash += back;
      const note = `Paper #${p.id}: ${h.name} has failed; the receivers pay ${fl(back)}`;
      addEntry(state, "cash", "paper_recovery", back, note);
      addEntry(state, "rival_paper", "paper_recovery", -p.cost, note);
      p.status = "lost";
      p.closed_turn = turn;
      continue;
    }
    if (p.start_turn < turn) {
      const interest = Math.round((p.face * p.rate) / 4);
      state.house.cash += interest;
      h.wealth = Math.max(0, h.wealth - interest);
      addEntry(state, "cash", "paper_interest", interest, `Paper #${p.id}: interest from ${h.name}`);
    }
    if (p.due_turn <= turn) {
      state.house.cash += p.face;
      const note = `Paper #${p.id}: ${h.name} pays ${fl(p.face)} at par`;
      addEntry(state, "cash", "paper_repaid", p.face, note);
      addEntry(state, "rival_paper", "paper_repaid", -p.cost, note);
      p.status = "repaid";
      p.closed_turn = turn;
    }
  }
}

// ---------- Poaching ----------

/** The wage a member is paid now: the role's wage plus any raise. */
export function wageOf(m: { role: keyof GameData["counting"]["roles"]; raise?: number }, data: GameData): number {
  return data.counting.roles[m.role].wage + (m.raise ?? 0);
}

/** Offers open this quarter. */
export function openPoachOffers(state: GameState): PoachOffer[] {
  return state.rivals.poach_offers.filter((o) => o.open_turn === state.world.turn);
}

export function checkMatchWage(state: GameState, d: MatchWageDecision, data: GameData): string | null {
  const noAction = checkCapacity(state, "match_wage", data.tuning);
  if (noAction) return noAction;
  const o = openPoachOffers(state).find((x) => x.staff === d.staff);
  if (!o) return `No house is courting staff #${d.staff} this quarter`;
  if (o.matched) return "The wage is already matched";
  const m = state.counting.staff.find((x) => x.id === d.staff);
  if (!m || m.leaving) return "That member of staff is leaving anyway";
  return null;
}

/** Matches a rival's wage: the member stays, at the higher wage from now on. Free. Returns a new state. */
export function matchWage(state: GameState, d: MatchWageDecision, data: GameData): DecisionResult {
  const reason = checkMatchWage(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const o = openPoachOffers(next).find((x) => x.staff === d.staff)!;
  const m = next.counting.staff.find((x) => x.id === d.staff)!;
  m.raise = o.wage - data.counting.roles[m.role].wage;
  o.matched = true;
  useCapacity(next, "match_wage", data.tuning);
  return { ok: true, state: next };
}

/** Unmatched offers this quarter are taken: the member leaves for the rival house. Draws nothing. */
function settlePoaching(state: GameState, data: GameData): void {
  for (const o of openPoachOffers(state)) {
    if (o.matched) continue;
    const m = state.counting.staff.find((x) => x.id === o.staff);
    const h = houseById(state, o.house);
    if (!m || m.leaving || !h || h.failed_turn !== null) continue;
    state.counting.staff = state.counting.staff.filter((x) => x.id !== m.id);
    news(state, `${m.name}, your ${data.counting.roles[m.role].name.toLowerCase()}, has gone to ${h.name} for ${fl(o.wage)} a quarter.`, "Staff poached");
  }
}

/** Chance a house tries to poach this quarter. */
export function poachChance(h: OtherHouse, data: GameData): number {
  const t = data.rivals.poach;
  return t.chance[h.temperament] * (h.opinion <= t.hostile_opinion ? t.hostile_factor : 1);
}

/**
 * Next quarter's offers: each house trading that is rich enough and not short-handed rolls (one
 * roll); one that hits draws a premium over the role's wage (one roll) and courts the player's
 * most skilled member paid less than that (partners never). At most `per_quarter` offers. Mutates `state`.
 */
function drawPoachOffers(state: GameState, rng: Rng, data: GameData): void {
  const t = data.rivals.poach;
  const turn = state.world.turn;
  const offers: PoachOffer[] = [];
  for (const h of tradingHouses(state)) {
    if (offers.length >= t.per_quarter) break;
    if (shortHanded(state, h.id) || h.wealth < t.min_wealth) continue;
    if (rng.next() >= poachChance(h, data)) continue;
    // Offers are set against the role's wage, so matching once makes a member dear to court again.
    const wage = (m: Staff) => Math.ceil((data.counting.roles[m.role].wage * (1 + premium)) / t.round_to) * t.round_to;
    const premium = between(rng, t.premium);
    const target = working(state)
      .filter((m) => m.role !== "partner" && !m.leaving && skillOf(m, turn + 1, data) >= t.min_skill && !offers.some((o) => o.staff === m.id) && wage(m) > wageOf(m, data))
      .sort((a, b) => skillOf(b, turn + 1, data) - skillOf(a, turn + 1, data) || a.id - b.id)[0];
    if (!target) continue;
    const now = wageOf(target, data);
    offers.push({ staff: target.id, house: h.id, wage: wage(target), open_turn: turn + 1, matched: false });
    news(state, `${h.name} has offered ${target.name} ${fl(wage(target))} a quarter (now ${fl(now)}) to join it. Match it this quarter, or lose them.`, "A rival courts your staff");
  }
  state.rivals.poach_offers = offers;
}

// ---------- Plots against the player ----------

/** Chance the player hears of a plot before it strikes. */
export function hearChance(state: GameState, data: GameData): number {
  const t = data.rivals.plots.hear;
  return clamp(t.base + t.per_correspondent * workingCount(state, "correspondent") + t.per_connection * (headConnections(state) - 5), 0, t.max);
}

/** Chance a house lays a plot this quarter. */
export function plotChance(state: GameState, h: OtherHouse, data: GameData): number {
  const t = data.rivals.plots;
  if (h.opinion >= t.from_opinion || shortHanded(state, h.id) || heldPaper(state, h.id).length) return 0;
  return t.chance[h.temperament] * Math.min(2, -h.opinion / t.opinion_scale);
}

/** The player's largest active debt owed to a house other than `house`, if any. */
function debtToBuy(state: GameState, house: string) {
  return state.debts.filter((d) => d.status === "active" && d.house !== house).sort((a, b) => b.principal - a.principal || a.id - b.id)[0];
}

/** Plots the player has heard of that strike this quarter and may still be countered. */
export function heardPlots(state: GameState): Plot[] {
  return state.rivals.plots.filter((p) => p.status === "laid" && p.heard && p.strike_turn === state.world.turn);
}

export function plotWords(p: Plot, state: GameState): string {
  const name = houseById(state, p.house)?.name ?? p.house;
  return p.kind === "rumours" ? `${name} means to whisper on the bourse that your house is short of cash` : `${name} means to buy up your debts and call them in`;
}

export function checkCounterPlot(state: GameState, d: CounterPlotDecision, data: GameData): string | null {
  const noAction = checkCapacity(state, "counter_plot", data.tuning);
  if (noAction) return noAction;
  const p = heardPlots(state).find((x) => x.id === d.plot);
  if (!p) return `No plot #${d.plot} known this quarter`;
  const cost = data.rivals.plots.counter_cost[p.kind];
  if (cost > freeCash(state)) return `Not enough cash above the reserve (cost ${fl(cost)}, free ${fl(freeCash(state))})`;
  return null;
}

/** Counters a plot the player has heard of: paid now, the plot comes to nothing. Returns a new state. */
export function counterPlot(state: GameState, d: CounterPlotDecision, data: GameData): DecisionResult {
  const reason = checkCounterPlot(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const p = next.rivals.plots.find((x) => x.id === d.plot)!;
  const cost = data.rivals.plots.counter_cost[p.kind];
  const name = houseById(next, p.house)?.name ?? p.house;
  next.house.cash -= cost;
  addEntry(next, "cash", "counter_plot", -cost, p.kind === "rumours" ? `Friends on the bourse to speak for the house against ${name}` : `A sweetener to keep your debts out of ${name}'s hands`);
  p.status = "countered";
  useCapacity(next, "counter_plot", data.tuning);
  return { ok: true, state: next };
}

/** Plots due this quarter strike (one roll for the size of a rumour). Mutates `state`. */
function strikePlots(state: GameState, rng: Rng, data: GameData): void {
  const t = data.rivals.plots;
  for (const p of state.rivals.plots) {
    if (p.status !== "laid" || p.strike_turn !== state.world.turn) continue;
    const h = houseById(state, p.house);
    if (!h || h.failed_turn !== null) {
      p.status = "fizzled";
      continue;
    }
    if (p.kind === "rumours") {
      const hit = Math.round(between(rng, t.rumours.reputation));
      state.house.reputation = clamp(state.house.reputation - hit, 0, 100);
      const leave = Math.min(Math.max(0, state.house.cash), Math.round((state.house.deposits * t.rumours.deposit_share) / 100) * 100);
      if (leave > 0) {
        state.house.cash -= leave;
        state.house.deposits -= leave;
        const note = `Depositors frightened by ${h.name}'s rumours`;
        addEntry(state, "cash", "rumour_withdrawal", -leave, note);
        addEntry(state, "deposits", "rumour_withdrawal", -leave, note);
      }
      news(state, `${h.name} whispers on the bourse that your house is short of cash. Your name suffers${leave > 0 ? `, and ${fl(leave)} of deposits leave` : ""}.`, "Rumours on the bourse");
      p.status = "struck";
      continue;
    }
    const debt = debtToBuy(state, h.id);
    if (!debt) {
      p.status = "fizzled";
      continue;
    }
    const was = debt.lender;
    debt.house = h.id;
    debt.lender = h.name;
    debt.term_quarters = Math.min(debt.term_quarters, state.world.turn + 2 - debt.start_turn);
    news(state, `${h.name} has bought your debt #${debt.id} of ${fl(debt.principal)} from ${was}, and calls it in: it falls due next quarter.`, "Your debts are bought");
    p.status = "struck";
  }
}

/** Next quarter's plots: one roll per house that may plot, one for the kind, one for whether the player hears of it. Mutates `state`. */
function layPlots(state: GameState, rng: Rng, data: GameData): void {
  const t = data.rivals.plots;
  const turn = state.world.turn;
  let laid = 0;
  for (const h of tradingHouses(state)) {
    if (laid >= t.per_quarter) break;
    const chance = plotChance(state, h, data);
    if (chance === 0 || rng.next() >= chance) continue;
    const kind: PlotKind = debtToBuy(state, h.id) && rng.next() < t.debt_share ? "buy_debt" : "rumours";
    const heard = rng.next() < hearChance(state, data);
    const p: Plot = { id: nextId(state), house: h.id, kind, laid_turn: turn, strike_turn: turn + 1, heard, status: "laid" };
    state.rivals.plots.push(p);
    laid += 1;
    if (heard) news(state, `Your correspondents hear that ${plotWords(p, state)}. It can be countered this quarter, at a cost.`, "A plot against the house");
  }
}

// ---------- End Turn ----------

/**
 * The system's End Turn step, after the houses' quarter and politics:
 * 1. the player's schemes settle, 2. paper pays, matures, recovers or squeezes, 3. staff courted
 * this quarter and not matched leave, 4. plots due strike, 5. rivals take large new loans offered
 * at less, 6. next quarter's plots are laid and poaching offers made, 7. old records are dropped.
 * Mutates `state`.
 */
export function resolveRivals(state: GameState, _rng: Rng, data: GameData): void {
  if (state.house.status === "bankrupt") return;
  withRivalsRng(state, (rng) => {
    settleSchemes(state, rng, data);
    settlePaper(state, data);
    settlePoaching(state, data);
    strikePlots(state, rng, data);
    rivalsTakeLoans(state, rng, data);
    layPlots(state, rng, data);
    drawPoachOffers(state, rng, data);
  });
  const keep = state.world.turn - 8;
  const r = state.rivals;
  r.schemes = r.schemes.filter((s) => s.turn > keep);
  r.plots = r.plots.filter((p) => p.status === "laid" || p.laid_turn > keep);
  r.paper = r.paper.filter((p) => p.status === "held" || (p.closed_turn ?? 0) > keep);
  for (const [id, until] of Object.entries(r.short_until)) if (until < state.world.turn) delete r.short_until[id];
}

// ---------- Decisions ----------

const KINDS: ReadonlySet<string> = new Set(RIVALS_KINDS);
export const isRivalsDecision = (d: Decision): d is RivalsDecision => KINDS.has(d.kind);

export function applyRivalsDecision(state: GameState, d: RivalsDecision, data: GameData): DecisionResult {
  switch (d.kind) {
    case "scheme":
      return scheme(state, d, data);
    case "counter_plot":
      return counterPlot(state, d, data);
    case "match_wage":
      return matchWage(state, d, data);
    case "buy_paper":
      return buyPaper(state, d, data);
    case "present_paper":
      return presentPaper(state, d, data);
  }
}

export function describeRivalsDecision(d: RivalsDecision, state: GameState, data: GameData): string {
  switch (d.kind) {
    case "scheme": {
      const name = houseById(state, d.house)?.name ?? d.house;
      const cost = data.rivals.schemes[d.scheme]?.cost ?? 0;
      return d.scheme === "rumours" ? `Spread rumours about ${name} (${fl(cost)})` : `Lure a clerk from ${name} (${fl(cost)})`;
    }
    case "counter_plot": {
      const p = state.rivals.plots.find((x) => x.id === d.plot);
      return p ? `Counter the plot: ${plotWords(p, state)} (${fl(data.rivals.plots.counter_cost[p.kind])})` : `Counter plot #${d.plot}`;
    }
    case "match_wage": {
      const o = state.rivals.poach_offers.find((x) => x.staff === d.staff);
      const m = state.counting.staff.find((x) => x.id === d.staff);
      return `Match ${o ? fl(o.wage) : "the"} wage for ${m?.name ?? `staff #${d.staff}`}`;
    }
    case "buy_paper": {
      const name = houseById(state, d.house)?.name ?? d.house;
      return `Buy ${fl(d.amount)} of ${name}'s paper for ${fl(paperCost(d.amount, data))}`;
    }
    case "present_paper": {
      const p = state.rivals.paper.find((x) => x.id === d.paper);
      const name = p ? (houseById(state, p.house)?.name ?? p.house) : "a house";
      return `Present ${p ? fl(p.face) : ""} of ${name}'s paper for payment`.replace("  ", " ");
    }
  }
}
