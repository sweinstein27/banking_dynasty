// Branches run by family members, and bills of exchange on foreign cities: the decisions, each
// branch's quarter of local business, forced closures, and the books in gulden.
import type { DecisionResult } from "../actions";
import { checkCapacity, useCapacity } from "../capacity";
import { ageIn, effectiveStat, type Stat } from "../family";
import { fl } from "../format";
import { addEntry } from "../ledger";
import { freeCash } from "../reserves";
import type { Rng } from "../rng";
import { cloneState } from "../state";
import type { GameData } from "../tuning";
import type { GameState, Person } from "../types";
import type {
  AppointBranchHeadDecision,
  Bill,
  Branch,
  BranchTraitEffect,
  BuyBillDecision,
  CityData,
  CityState,
  CloseBranchDecision,
  FundBranchDecision,
  OpenBranchDecision,
} from "./types";
import { cityData, cityState, onOrAfter, quote } from "./world";

// Books ---------------------------------------------------------------------------------------

export const branchIn = (state: GameState, city: string): Branch | undefined => state.europe.branches.find((b) => b.city === city);

/** Every branch at its book value in gulden. */
export function branchesBook(state: GameState): number {
  return state.europe.branches.reduce((s, b) => s + b.book, 0);
}

/** Every bill held, at cost. */
export function billsBook(state: GameState): number {
  return state.europe.bills.reduce((s, b) => s + b.cost, 0);
}

function news(state: GameState, title: string, text: string): void {
  state.news.push({ turn: state.world.turn, kind: "europe", title, text });
}

// Heads ---------------------------------------------------------------------------------------

/** Why `p` cannot head a branch, or null: a living adult of the line, not the head of house, heading no other branch (`except` aside). */
export function headProblem(state: GameState, p: Person | undefined, data: GameData, except?: string): string | null {
  if (!p) return "No such family member";
  if (p.death_year !== null) return `${p.name} is dead`;
  if (p.role !== "line") return `${p.name} is not of the family line`;
  if (p.is_head) return `${p.name} is the head of the house and stays in Frankfurt`;
  if (ageIn(p, state.world.year) < data.tuning.family.succession.adult_age) return `${p.name} is too young to run a branch`;
  const other = state.europe.branches.find((b) => b.head === p.id && b.city !== except);
  if (other) return `${p.name} already runs the branch in ${cityData(data, other.city)?.name ?? other.city}`;
  return null;
}

/** Family members who could head a branch now. */
export function branchCandidates(state: GameState, data: GameData): Person[] {
  return state.people.filter((p) => headProblem(state, p, data) === null);
}

/** The branch's head, if still able to serve (alive, of the line, not called home as head of house). */
export function branchHead(state: GameState, b: Branch): Person | undefined {
  const p = state.people.find((x) => x.id === b.head);
  return p && p.death_year === null && p.role === "line" && !p.is_head ? p : undefined;
}

/** The head's trait effects on a branch, multiplied together. */
export function branchTraits(p: Person | undefined, data: GameData): Required<Omit<BranchTraitEffect, "lend_share">> & { lend_share: number | null } {
  const out = { lend_share: null as number | null, defaults: 1, bills: 1, deposits: 1, close: 1 };
  for (const t of p?.traits ?? []) {
    const e = data.europe.branch.traits[t];
    if (!e) continue;
    if (e.lend_share !== undefined) out.lend_share = e.lend_share;
    out.defaults *= e.defaults ?? 1;
    out.bills *= e.bills ?? 1;
    out.deposits *= e.deposits ?? 1;
    out.close *= e.close ?? 1;
  }
  return out;
}

const statOf = (p: Person | undefined, stat: Stat, data: GameData) => (p ? effectiveStat(p, stat, data) : data.tuning.family.neutral_stat);

// The branch's quarter -------------------------------------------------------------------------

export interface BranchQuarter {
  deposits: number;
  income: number;
  defaults: number;
  upkeep: number;
  profit: number;
}

/**
 * One quarter of a branch's local business, in its own currency: deposits move toward their level
 * (or run in a panic), it lends a share of capital and deposits at the local rate plus a margin,
 * pays its depositors, trades bills, loses a share of its loans to defaults and pays its upkeep.
 * Pure: draws nothing.
 */
export function branchQuarter(b: Branch, city: CityData, cs: Pick<CityState, "mood" | "status">, head: Person | undefined, reputation: number, rate: number, data: GameData): BranchQuarter {
  const e = data.europe.branch;
  const t = branchTraits(head, data);
  const acumen = statOf(head, "acumen", data);
  const prudence = statOf(head, "prudence", data);
  const connections = statOf(head, "connections", data);
  const headless = head ? { bills: 1, defaults: 1 } : e.headless;

  const level = b.capital * e.deposit_multiple * (0.5 + connections / 10) * (reputation / 50) * t.deposits;
  const deposits = cs.mood === "panic" ? b.deposits * (1 - e.panic_withdrawal) : b.deposits + (level - b.deposits) * e.deposit_catch_up;
  const lent = Math.max(0, b.capital + deposits) * (t.lend_share ?? e.lend_share);
  const income =
    (lent * (city.rate + e.loan_margin)) / 4 - (deposits * Math.max(0, city.rate - e.deposit_margin)) / 4 + Math.max(0, b.capital) * e.bill_yield * (0.5 + acumen / 10) * t.bills * headless.bills;
  const defaults = lent * e.defaults[cs.mood] * (cs.status === "war" ? e.war_defaults : 1) * Math.max(0.1, 1.5 - prudence / 10) * t.defaults * headless.defaults;
  const upkeep = city.upkeep / rate;
  const r = (n: number) => Math.round(n * 100) / 100;
  return { deposits: r(deposits), income: r(income), defaults: r(defaults), upkeep: r(upkeep), profit: r(income - defaults - upkeep) };
}

/** The chance this quarter that trouble in the city forces the branch to close (0 in peace and calm or unease). */
export function closeChance(cs: Pick<CityState, "mood" | "status">, head: Person | undefined, data: GameData): number {
  const e = data.europe.branch;
  const trouble = cs.status === "war" ? "war" : cs.status === "unrest" ? "unrest" : cs.mood === "panic" ? "panic" : null;
  if (!trouble) return 0;
  const prudence = statOf(head, "prudence", data);
  return Math.min(1, e.close[trouble] * Math.max(0.1, 1.4 - prudence / 10) * branchTraits(head, data).close);
}

export function closeLoss(cs: Pick<CityState, "mood" | "status">, data: GameData): number {
  const l = data.europe.branch.close_loss;
  return cs.status === "war" ? l.war : cs.status === "unrest" ? l.unrest : l.panic;
}

/** Removes a branch, bringing `cash` home and writing its book off. Mutates `state`. */
function removeBranch(state: GameState, b: Branch, cash: number, note: string): void {
  if (cash > 0) {
    state.house.cash += cash;
    addEntry(state, "cash", "branch_closed", cash, note);
  }
  if (b.book !== 0) addEntry(state, "branches", "branch_closed", -b.book, note);
  state.europe.branches = state.europe.branches.filter((x) => x !== b);
}

/** Keeps a branch's book at its capital at the Frankfurt quote, writing the difference as exchange. Mutates `state`. */
export function revalue(state: GameState, b: Branch, data: GameData): void {
  const book = Math.max(0, Math.round(b.capital * quote(state, data, b.city)));
  if (book === b.book) return;
  addEntry(state, "branches", "exchange", book - b.book, `Branch in ${cityData(data, b.city)?.name}: revalued at the Frankfurt quote`);
  b.book = book;
}

/**
 * Every branch's quarter, in branch order: a head who has died, married out or become head of house
 * leaves the branch headless; the branch does its business (the result written to the branches
 * account at the Frankfurt quote); one roll each for a forced closure in war, unrest or panic; a
 * branch whose capital is gone fails. Mutates `state`.
 */
export function runBranches(state: GameState, rng: Rng, data: GameData): void {
  for (const b of [...state.europe.branches]) {
    const city = cityData(data, b.city)!;
    const cs = cityState(state, b.city)!;
    const name = city.name;
    if (b.head !== null && !branchHead(state, b)) {
      const p = state.people.find((x) => x.id === b.head);
      const why = !p ? "has gone" : p.death_year !== null ? "has died" : p.is_head ? "has come home to lead the house" : "has left the family";
      news(state, `The ${name} branch has no head`, `${p?.name ?? "Its head"} ${why}. The ${name} branch carries on under its clerks, earning less and lending worse, until someone of the family takes it over.`);
      b.head = null;
    }
    const head = branchHead(state, b);
    const q = quote(state, data, b.city);
    const r = branchQuarter(b, city, cs, head, state.house.reputation, q, data);
    b.deposits = r.deposits;
    b.capital = Math.round((b.capital + r.profit) * 100) / 100;
    b.last_profit = r.profit;
    const inFl = Math.round(r.profit * q);
    if (inFl !== 0) {
      addEntry(state, "branches", inFl > 0 ? "branch_profit" : "branch_loss", inFl, `Branch in ${name}: the quarter's ${inFl > 0 ? "profit" : "loss"}`);
      b.book += inFl;
    }

    const u = rng.next();
    if (b.capital <= 0) {
      removeBranch(state, b, 0, `Branch in ${name} has failed`);
      state.house.reputation = Math.max(0, state.house.reputation - 5);
      news(state, `The ${name} branch fails`, `The ${name} branch has lost all its capital and closes its doors. The bourse talks of it.`);
      continue;
    }
    if (u < closeChance(cs, head, data)) {
      const loss = closeLoss(cs, data);
      const why = cs.status === "war" ? "the fighting" : cs.status === "unrest" ? "the unrest" : "the panic";
      const back = Math.round(b.capital * (1 - loss) * q);
      removeBranch(state, b, back, `Branch in ${name} closed by ${why}`);
      news(state, `The ${name} branch closes`, `${why[0]!.toUpperCase()}${why.slice(1)} in ${name} forces the branch to close. ${Math.round(loss * 100)}% of its capital is lost; ${fl(back)} comes home${head ? `, and ${head.name} with it` : ""}.`);
    }
  }
}

/** A disaster abroad takes a share of the branch's capital there. Mutates `state`. */
export function branchDisaster(state: GameState, cityId: string, loss: number, title: string, data: GameData): void {
  const b = branchIn(state, cityId);
  if (!b) return;
  const lostLocal = Math.round(b.capital * loss * 100) / 100;
  b.capital = Math.round((b.capital - lostLocal) * 100) / 100;
  const lost = Math.round(lostLocal * quote(state, data, cityId));
  if (lost > 0) {
    addEntry(state, "branches", "branch_loss", -lost, `Branch in ${cityData(data, cityId)?.name}: ${title}`);
    b.book -= lost;
  }
}

// Bills ---------------------------------------------------------------------------------------

/** The discount on a 3-month bill on `city`: a quarter of its local rate plus the house's spread. */
export const billDiscount = (city: CityData, data: GameData) => city.rate / 4 + data.europe.bills.spread;

/** Face, in the city's currency, of a bill bought for `amount` gulden now. */
export function billFace(state: GameState, data: GameData, cityId: string, amount: number): number {
  const city = cityData(data, cityId)!;
  return Math.round((amount / (quote(state, data, cityId) * (1 - billDiscount(city, data)))) * 100) / 100;
}

/** Bills on `city` the house may still buy, gulden. */
export function billRoom(state: GameState, data: GameData, cityId: string): number {
  const held = state.europe.bills.filter((b) => b.city === cityId).reduce((s, b) => s + b.cost, 0);
  return Math.max(0, data.europe.bills.limit + (branchIn(state, cityId)?.book ?? 0) - held);
}

/**
 * Settles the bills due this quarter: one roll each (in bill order) for the payer failing, by the
 * city's mood during the quarter (`moods`); a paid bill comes home at the Frankfurt quote, a failed
 * one brings back the recovery share. Mutates `state`.
 */
export function rollBills(state: GameState, rng: Rng, data: GameData): Map<number, boolean> {
  const failed = new Map<number, boolean>();
  for (const bill of state.europe.bills) {
    if (bill.due_turn > state.world.turn) continue;
    const mood = cityState(state, bill.city)!.mood;
    failed.set(bill.id, rng.next() < data.europe.bills.defaults[mood]);
  }
  return failed;
}

export function settleBills(state: GameState, failed: Map<number, boolean>, data: GameData): void {
  const keep: Bill[] = [];
  for (const bill of state.europe.bills) {
    if (!failed.has(bill.id)) {
      keep.push(bill);
      continue;
    }
    const name = cityData(data, bill.city)!.name;
    const value = bill.face * quote(state, data, bill.city);
    const bad = failed.get(bill.id)!;
    const got = Math.round(bad ? value * data.europe.bills.recovery : value);
    const note = `Bill #${bill.id} on ${name}: ${bad ? "the payer failed" : "paid"}`;
    state.house.cash += got;
    addEntry(state, "cash", bad ? "bill_default" : "bill_paid", got, note);
    addEntry(state, "bills", bad ? "bill_default" : "bill_paid", -bill.cost, note);
    if (bad) news(state, `A bill on ${name} is refused`, `The payer of bill #${bill.id} on ${name} has failed. Of ${fl(bill.cost)} laid out, ${fl(got)} comes back.`);
  }
  state.europe.bills = keep;
}

// Decisions -----------------------------------------------------------------------------------

function foreignCity(data: GameData, id: string): CityData | string {
  const city = cityData(data, id);
  if (!city) return `Unknown city "${id}"`;
  if (id === data.europe.home) return "Frankfurt is the house's home";
  return city;
}

const wholeAbove = (n: number) => Number.isInteger(n) && n > 0;

export function checkOpenBranch(state: GameState, d: OpenBranchDecision, data: GameData): string | null {
  const city = foreignCity(data, d.city);
  if (typeof city === "string") return city;
  const noCapacity = checkCapacity(state, d.kind, data.tuning);
  if (noCapacity) return noCapacity;
  if (branchIn(state, d.city)) return `The house already has a branch in ${city.name}`;
  if (!onOrAfter(state.world, city.opens)) return `A branch in ${city.name} cannot open before ${city.opens.year}`;
  if (state.house.reputation < city.min_reputation) return `${city.name} needs a reputation of ${city.min_reputation} (the house has ${state.house.reputation})`;
  if (cityState(state, d.city)!.known.status === "war") return `${city.name} is at war`;
  const who = headProblem(state, state.people.find((p) => p.id === d.head), data);
  if (who) return who;
  if (!wholeAbove(d.capital) || d.capital < data.europe.branch.min_capital) return `A branch needs at least ${fl(data.europe.branch.min_capital)} of capital`;
  const cost = city.setup + d.capital;
  if (cost > freeCash(state)) return `Not enough cash above the reserve (costs ${fl(cost)}, free ${fl(freeCash(state))})`;
  return null;
}

function openBranch(state: GameState, d: OpenBranchDecision, data: GameData): DecisionResult {
  const why = checkOpenBranch(state, d, data);
  if (why) return { ok: false, reason: why };
  const next = cloneState(state);
  useCapacity(next, d.kind, data.tuning);
  const city = cityData(data, d.city)!;
  const q = quote(next, data, d.city);
  const head = next.people.find((p) => p.id === d.head)!;
  next.house.cash -= city.setup;
  addEntry(next, "cash", "branch_opening", -city.setup, `Branch in ${city.name}: premises, licences and clerks`);
  next.house.cash -= d.capital;
  const capital = Math.round(((d.capital * (1 - data.europe.branch.transfer_spread)) / q) * 100) / 100;
  const book = Math.round(capital * q);
  const note = `Branch in ${city.name}: capital sent, ${head.name} at its head`;
  addEntry(next, "cash", "branch_capital", -d.capital, note);
  addEntry(next, "branches", "branch_capital", book, note);
  next.europe.branches.push({ city: d.city, head: d.head, opened_turn: next.world.turn, capital, deposits: 0, book, last_profit: 0 });
  return { ok: true, state: next };
}

export function checkFundBranch(state: GameState, d: FundBranchDecision, data: GameData): string | null {
  const city = foreignCity(data, d.city);
  if (typeof city === "string") return city;
  const noCapacity = checkCapacity(state, d.kind, data.tuning);
  if (noCapacity) return noCapacity;
  const b = branchIn(state, d.city);
  if (!b) return `The house has no branch in ${city.name}`;
  if (!Number.isInteger(d.amount) || d.amount === 0) return "The amount must be a whole number of gulden, not zero";
  if (d.amount > 0 && d.amount > freeCash(state)) return `Not enough cash above the reserve (free ${fl(freeCash(state))})`;
  if (d.amount < 0 && b.book + d.amount < data.europe.branch.min_capital)
    return `The branch must keep ${fl(data.europe.branch.min_capital)} of capital; close it to bring everything home`;
  return null;
}

function fundBranch(state: GameState, d: FundBranchDecision, data: GameData): DecisionResult {
  const why = checkFundBranch(state, d, data);
  if (why) return { ok: false, reason: why };
  const next = cloneState(state);
  useCapacity(next, d.kind, data.tuning);
  const b = branchIn(next, d.city)!;
  const name = cityData(data, d.city)!.name;
  const q = quote(next, data, d.city);
  const spread = data.europe.branch.transfer_spread;
  if (d.amount > 0) {
    next.house.cash -= d.amount;
    b.capital = Math.round((b.capital + (d.amount * (1 - spread)) / q) * 100) / 100;
    addEntry(next, "cash", "branch_capital", -d.amount, `Branch in ${name}: capital sent`);
  } else {
    const a = -d.amount;
    b.capital = Math.round((b.capital - a / q) * 100) / 100;
    const got = Math.round(a * (1 - spread));
    next.house.cash += got;
    addEntry(next, "cash", "branch_capital", got, `Branch in ${name}: capital recalled`);
  }
  const book = Math.round(b.capital * q);
  addEntry(next, "branches", "branch_capital", book - b.book, `Branch in ${name}: capital ${d.amount > 0 ? "sent" : "recalled"}`);
  b.book = book;
  return { ok: true, state: next };
}

export function checkAppointHead(state: GameState, d: AppointBranchHeadDecision, data: GameData): string | null {
  const city = foreignCity(data, d.city);
  if (typeof city === "string") return city;
  const noCapacity = checkCapacity(state, d.kind, data.tuning);
  if (noCapacity) return noCapacity;
  const b = branchIn(state, d.city);
  if (!b) return `The house has no branch in ${city.name}`;
  if (b.head === d.head) return "Already at its head";
  return headProblem(state, state.people.find((p) => p.id === d.head), data, d.city);
}

function appointHead(state: GameState, d: AppointBranchHeadDecision, data: GameData): DecisionResult {
  const why = checkAppointHead(state, d, data);
  if (why) return { ok: false, reason: why };
  const next = cloneState(state);
  useCapacity(next, d.kind, data.tuning);
  branchIn(next, d.city)!.head = d.head;
  return { ok: true, state: next };
}

export function checkCloseBranch(state: GameState, d: CloseBranchDecision, data: GameData): string | null {
  const city = foreignCity(data, d.city);
  if (typeof city === "string") return city;
  const noCapacity = checkCapacity(state, d.kind, data.tuning);
  if (noCapacity) return noCapacity;
  if (!branchIn(state, d.city)) return `The house has no branch in ${city.name}`;
  return null;
}

function closeBranch(state: GameState, d: CloseBranchDecision, data: GameData): DecisionResult {
  const why = checkCloseBranch(state, d, data);
  if (why) return { ok: false, reason: why };
  const next = cloneState(state);
  useCapacity(next, d.kind, data.tuning);
  const b = branchIn(next, d.city)!;
  removeBranch(next, b, Math.round(b.book * (1 - data.europe.branch.transfer_spread)), `Branch in ${cityData(data, d.city)!.name} closed; its capital comes home`);
  return { ok: true, state: next };
}

export function checkBuyBill(state: GameState, d: BuyBillDecision, data: GameData): string | null {
  const city = foreignCity(data, d.city);
  if (typeof city === "string") return city;
  const noCapacity = checkCapacity(state, d.kind, data.tuning);
  if (noCapacity) return noCapacity;
  if (!wholeAbove(d.amount)) return "The amount must be a whole number of gulden above zero";
  if (d.amount > freeCash(state)) return `Not enough cash above the reserve (free ${fl(freeCash(state))})`;
  const room = billRoom(state, data, d.city);
  if (d.amount > room) return `The house may hold only ${fl(room)} more of bills on ${city.name}`;
  return null;
}

function buyBill(state: GameState, d: BuyBillDecision, data: GameData): DecisionResult {
  const why = checkBuyBill(state, d, data);
  if (why) return { ok: false, reason: why };
  const next = cloneState(state);
  useCapacity(next, d.kind, data.tuning);
  const id = next.europe.next_bill_id++;
  const face = billFace(next, data, d.city, d.amount);
  next.house.cash -= d.amount;
  const note = `Bill #${id} on ${cityData(data, d.city)!.name}: bought, due in 3 months`;
  addEntry(next, "cash", "bill_purchase", -d.amount, note);
  addEntry(next, "bills", "bill_purchase", d.amount, note);
  next.europe.bills.push({ id, city: d.city, face, cost: d.amount, bought_turn: next.world.turn, due_turn: next.world.turn });
  return { ok: true, state: next };
}

export const europeAppliers = { open_branch: openBranch, fund_branch: fundBranch, appoint_branch_head: appointHead, close_branch: closeBranch, buy_bill: buyBill };
