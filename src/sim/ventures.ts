// Ventures as long projects (A3). The house commits capital, which is called in instalments while
// the venture is built; overruns raise the commitment and a failure loses the stake. Short
// ventures pay out once when built. Medium ones and great works run and pay dividends (great works
// from their first open section), and a success floats on the bourse: the stake becomes shares.
// Before listing a stake sells only at a heavy discount.
import { cloneState } from "./state";
import { acumenFactor, headEffects, headStat } from "./family";
import { fl } from "./format";
import type { DecisionResult } from "./actions";
import { checkCapacity, useCapacity } from "./capacity";
import { addEntry } from "./ledger";
import { freeCash } from "./reserves";
import type { Rng } from "./rng";
import type { GameData, Tuning, VentureType } from "./tuning";
import type { GameState, InvestVentureDecision, Sentiment, Venture } from "./types";
import { driverFactor, fairValue, quarterEarnings, sectorOf, spread } from "./markets/prices";
import { withMarketsRng } from "./markets/stream";
import type { Company, SellVentureDecision } from "./markets/types";

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Ventures at cost: the paid-in stake of every venture not yet listed. */
export function ventureBook(state: GameState): number {
  return state.ventures.filter((v) => v.status === "active").reduce((sum, v) => sum + v.invested, 0);
}

export function ventureType(data: GameData, id: string): VentureType {
  const t = data.ventures.find((v) => v.id === id);
  if (!t) throw new Error(`Unknown venture "${id}"`);
  return t;
}

/** Chance of failure: failure_risk * m_sentiment * the head's Acumen factor * their traits' factor, capped at 1. */
export function ventureFailureChance(failureRisk: number, sentiment: Sentiment, tuning: Tuning, acumen: number, traitFactor: number): number {
  return Math.min(1, failureRisk * tuning.sentiment_multiplier[sentiment] * acumenFactor(acumen, tuning) * traitFactor);
}

/** A type's calm failure risk over its whole planned build, spread evenly over each quarter of it. */
export function quarterlyFailureRisk(t: Pick<VentureType, "failure_risk" | "term_quarters">): number {
  return 1 - (1 - t.failure_risk) ** (1 / Math.max(1, t.term_quarters));
}

/** This quarter's chance that a venture of type `t` fails while building, in today's mood with today's head. */
export function buildFailureChance(state: GameState, t: VentureType, data: GameData): number {
  return ventureFailureChance(quarterlyFailureRisk(t), state.world.sentiment, data.tuning, headStat(state, "acumen", data), headEffects(state, data).venture_failure);
}

/** Cash a short venture returns when built, in whole gulden: the stake plus its expected return. */
export function venturePayout(v: Pick<Venture, "invested" | "expected_return">): number {
  return Math.round(v.invested * (1 + v.expected_return));
}

/** Quarters until the build is done; 1 means it finishes at the end of this turn. */
export function quartersLeft(state: GameState, v: Pick<Venture, "start_turn" | "term_quarters">): number {
  return v.term_quarters - (state.world.turn - v.start_turn);
}

/** Commitment still to be called, scaled down if part of the stake was sold. 0 once calls stop. */
export function remainingCommitment(v: Venture): number {
  if (v.calls_stopped || v.calls_paid >= v.calls || v.called <= 0) return 0;
  return Math.round(((v.committed - v.called) * v.invested) / v.called);
}

/** The next call, in whole gulden: what remains spread over the calls left. */
export function nextCall(v: Venture): number {
  const left = v.calls - v.calls_paid;
  return left > 0 ? Math.round(remainingCommitment(v) / left) : 0;
}

/** True when a call falls due at the end of this turn. */
export function callDue(state: GameState, v: Venture, t: VentureType): boolean {
  const since = state.world.turn - v.start_turn;
  return !v.calls_stopped && v.calls_paid < v.calls && since > 0 && since % t.call_every === 0;
}

/** The first call when committing `amount` to type `t`. */
export const firstCall = (t: Pick<VentureType, "calls">, amount: number) => Math.round(amount / t.calls);

/** Returns why an invest_venture decision is invalid, or null if it can go ahead. */
export function checkInvestVenture(state: GameState, d: InvestVentureDecision, data: GameData): string | null {
  const t = data.tuning;
  const type = data.ventures.find((v) => v.id === d.venture);
  if (!type) return `Unknown venture "${d.venture}"`;
  const noAction = checkCapacity(state, "invest_venture", t);
  if (noAction) return noAction;
  if (state.world.year < type.unlock_year) return `${type.name} ventures cannot be backed before ${type.unlock_year}`;
  if (!Number.isInteger(d.amount)) return "Amount must be whole gulden";
  if (d.amount < t.ventures.min_amount) return `Amount must be at least ${fl(t.ventures.min_amount)}`;
  const first = firstCall(type, d.amount);
  if (first > freeCash(state)) return `Not enough cash above the reserve for the first call of ${fl(first)} (free ${fl(freeCash(state))})`;
  return null;
}

/** Commits to a venture and pays its first call. Returns a new state; the input is not changed. */
export function investVenture(state: GameState, d: InvestVentureDecision, data: GameData): DecisionResult {
  const reason = checkInvestVenture(state, d, data);
  if (reason) return { ok: false, reason };
  const type = ventureType(data, d.venture);
  const first = firstCall(type, d.amount);

  const next = cloneState(state);
  const venture: Venture = {
    id: next.ventures.length + 1,
    type: type.id,
    invested: first,
    expected_return: type.expected_return,
    failure_risk: type.failure_risk,
    unlock_year: type.unlock_year,
    start_turn: next.world.turn,
    term_quarters: type.term_quarters,
    status: "active",
    phase: "building",
    committed: d.amount,
    called: first,
    calls: type.calls,
    calls_paid: 1,
    calls_stopped: false,
    sections_open: 0,
    earnings: [],
    run_start_turn: null,
    company: null,
  };
  next.ventures.push(venture);
  next.house.cash -= first;
  useCapacity(next, "invest_venture", data.tuning);
  const note = `Venture #${venture.id}: ${type.name}, ${fl(d.amount)} committed over ${type.calls} calls, first call`;
  addEntry(next, "cash", "venture_in", -first, note);
  addEntry(next, "ventures", "venture_in", first, note);
  return { ok: true, state: next };
}

/** What an unlisted stake fetches when sold, in whole gulden. */
export function stakeSalePrice(invested: number, tuning: Tuning): number {
  return Math.round(invested * (1 - tuning.ventures.unlisted_discount));
}

export function checkSellVenture(state: GameState, d: SellVentureDecision, data: GameData): string | null {
  const v = state.ventures.find((x) => x.id === d.venture);
  if (!v) return `Unknown venture #${d.venture}`;
  const noAction = checkCapacity(state, d.kind, data.tuning);
  if (noAction) return noAction;
  if (v.status === "listed") return `Venture #${v.id} is listed: sell its shares on the bourse instead`;
  if (v.status !== "active") return `Venture #${v.id} has no stake left to sell`;
  return null;
}

/** Sells an unlisted stake privately at the unlisted discount; no further calls. */
export function sellVenture(state: GameState, d: SellVentureDecision, data: GameData): DecisionResult {
  const reason = checkSellVenture(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const v = next.ventures.find((x) => x.id === d.venture)!;
  const name = ventureType(data, v.type).name;
  const price = stakeSalePrice(v.invested, data.tuning);
  const note = `Venture #${v.id}: ${name} stake sold privately at a discount`;
  addEntry(next, "cash", "venture_sale", price, note);
  addEntry(next, "ventures", "venture_sale", -v.invested, note);
  next.house.cash += price;
  v.invested = 0;
  v.status = "sold";
  v.calls_stopped = true;
  useCapacity(next, d.kind, data.tuning);
  return { ok: true, state: next };
}

// End Turn ------------------------------------------------------------------------------------

function news(state: GameState, text: string, title?: string): void {
  state.news.push({ turn: state.world.turn, kind: "markets", text, ...(title ? { title } : {}) });
}

/** Pays a due call, or forfeits the stake if cash cannot cover it. Listed ventures' calls buy shares at par. */
function payCall(state: GameState, v: Venture, t: VentureType, data: GameData, rng: Rng): void {
  if (v.status === "active" && rng.next() < t.overrun.chance) {
    const extra = Math.round(v.committed * t.overrun.share);
    v.committed += extra;
    v.calls += t.overrun.extra_calls;
    v.term_quarters += t.overrun.extra_calls * t.call_every;
    const q = t.overrun.extra_calls * t.call_every;
    news(state, `Venture #${v.id} (${t.name}) is over budget: the house's commitment rises by ${fl(extra)} and the build by ${q} ${q === 1 ? "quarter" : "quarters"}.`);
  }
  const call = nextCall(v);
  if (call <= 0) return;
  if (state.house.cash < call) {
    v.calls_stopped = true;
    if (v.status === "listed") {
      news(state, `The house could not pay a call of ${fl(call)} on its ${t.company_name} shares; it takes no part in the rest of the issue.`);
      return;
    }
    const lost = Math.round(v.invested * data.tuning.ventures.forfeit_penalty);
    v.invested -= lost;
    addEntry(state, "ventures", "venture_forfeit", -lost, `Venture #${v.id}: ${t.name}, call of ${fl(call)} unpaid, part of the stake forfeited`);
    news(state, `The house could not pay a call of ${fl(call)} on venture #${v.id} (${t.name}). ${fl(lost)} of its stake is forfeited, and it is called on no more.`);
    return;
  }
  state.house.cash -= call;
  v.called += call;
  v.calls_paid += 1;
  const note = `Venture #${v.id}: ${t.name}, call ${v.calls_paid} of ${v.calls}`;
  addEntry(state, "cash", "venture_call", -call, note);
  if (v.status === "active") {
    v.invested += call;
    addEntry(state, "ventures", "venture_call", call, note);
    return;
  }
  // Listed: the call buys new shares at par.
  const c = state.markets.companies.find((x) => x.id === v.company)!;
  v.invested += call;
  const newShares = Math.round(call / c.par);
  const before = Math.round((state.markets.shares[c.id] ?? 0) * c.price);
  state.markets.shares[c.id] = (state.markets.shares[c.id] ?? 0) + newShares;
  c.shares += Math.round(newShares / t.stake_share);
  addEntry(state, "shares", "venture_call", Math.round(state.markets.shares[c.id]! * c.price) - before, note);
}

/** Sections of a great work open by this turn: evenly through the build. */
export function sectionsOpen(state: GameState, v: Venture, t: VentureType): number {
  const elapsed = state.world.turn - v.start_turn + 1;
  return Math.min(t.sections, Math.floor((elapsed * t.sections) / v.term_quarters));
}

/** The house's stake once every call is paid. */
const finalStake = (v: Venture) => v.invested + remainingCommitment(v);

/** A unique company id and name for a venture that floats. */
function companyName(state: GameState, t: VentureType): string {
  const same = state.markets.companies.filter((c) => c.name === t.company_name || c.name.startsWith(`${t.company_name} (`)).length;
  return same ? `${t.company_name} (${same + 1})` : t.company_name;
}

/** Floats a venture: its stake becomes shares at par, priced at a discount to fair value. Mutates `state`. */
export function floatVenture(state: GameState, v: Venture, t: VentureType, data: GameData): Company {
  const f = data.tuning.ventures.float;
  const held = Math.max(1, Math.round(v.invested / f.par));
  const total = Math.round(held / t.stake_share);
  const scale = total / held;
  const built = state.world.turn - v.start_turn + 1 >= v.term_quarters;
  const c: Company = {
    id: `venture-${v.id}`,
    name: companyName(state, t),
    sector: t.sector,
    status: "listed",
    listed_turn: state.world.turn,
    shares: total,
    par: f.par,
    base_yield: t.expected_return,
    payout: data.tuning.ventures.payout,
    price: 0,
    earnings: v.earnings.map((e) => Math.round(e * scale)),
    last_dividend: 0,
    shock: 1,
    earning_capital: built ? null : Math.round((finalStake(v) / t.stake_share) * (v.sections_open / t.sections)),
    estimate_noise: 0,
    report_tier: 0,
    report_until: 0,
    venture: v.id,
  };
  c.price = Math.round(Math.max(data.markets.prices.min_price, fairValue(c, state.world.sentiment, data.markets) * f.discount) * 100) / 100;
  state.markets.companies.push(c);
  state.markets.shares[c.id] = held;
  const value = Math.round(held * c.price);
  const note = `Venture #${v.id}: ${t.name} floated on the bourse as ${c.name}, ${held} shares at ${fl(c.price)}`;
  addEntry(state, "ventures", "venture_listing", -v.invested, note);
  addEntry(state, "shares", "venture_listing", value, note);
  v.status = "listed";
  v.company = c.id;
  news(state, `${t.name} venture #${v.id} floats on the bourse as ${c.name}. The house's stake of ${fl(v.invested)} becomes ${held} shares worth ${fl(value)} at the opening price.`, "A venture lists");
  return c;
}

/**
 * One quarter of every venture, in id order. For each one not yet listed: a failure roll while
 * building; a due call (an overrun roll first; forfeit if cash is short); sections opening;
 * earnings on open sections; a short venture pays out when built, the rest start running; year-end
 * dividends; floating once proven; a running venture losing money may fail. Listed ventures still
 * pay their calls (into shares) and open sections. Draws come from `rng`. Mutates `state`.
 */
export function stepVentures(state: GameState, rng: Rng, data: GameData): void {
  const tv = data.tuning.ventures;
  for (const v of state.ventures) {
    if (v.status !== "active" && v.status !== "listed") continue;
    const t = ventureType(data, v.type);
    const sector = sectorOf(data.markets, t.sector);

    if (v.status === "listed") {
      const c = state.markets.companies.find((x) => x.id === v.company);
      if (!c || c.status !== "listed") {
        // The company failed: nobody calls for capital any more.
        v.calls_stopped = true;
        continue;
      }
      if (callDue(state, v, t)) payCall(state, v, t, data, rng);
      {
        v.sections_open = sectionsOpen(state, v, t);
        const built = state.world.turn - v.start_turn + 1 >= v.term_quarters;
        c.earning_capital = built ? null : Math.min(c.shares * c.par, Math.round((finalStake(v) / t.stake_share) * (v.sections_open / t.sections)));
      }
      continue;
    }

    if (v.phase === "building" && rng.next() < buildFailureChance(state, t, data)) {
      const salvage = Math.round(v.invested * tv.salvage);
      const note = `Venture #${v.id}: ${t.name} failed`;
      addEntry(state, "ventures", "venture_failure", -v.invested, note);
      if (salvage > 0) {
        state.house.cash += salvage;
        addEntry(state, "cash", "venture_failure", salvage, `${note}, ${fl(salvage)} salvaged`);
        news(state, `${fl(salvage)} is salvaged from the wreck of venture #${v.id} (${t.name}).`);
      }
      v.status = "failed";
      v.calls_stopped = true;
      continue;
    }

    if (callDue(state, v, t)) payCall(state, v, t, data, rng);

    v.sections_open = sectionsOpen(state, v, t);
    const elapsed = state.world.turn - v.start_turn + 1;
    const built = elapsed >= v.term_quarters && (v.calls_stopped || v.calls_paid >= v.calls);

    if (t.tier === "short") {
      if (!built) continue;
      const payout = venturePayout(v);
      v.status = "paid_out";
      state.house.cash += payout;
      const note = `Venture #${v.id}: ${t.name} paid out`;
      addEntry(state, "cash", "venture_payout", payout, note);
      addEntry(state, "ventures", "venture_payout", -v.invested, note);
      continue;
    }

    if (v.sections_open > 0) {
      if (v.run_start_turn === null) v.run_start_turn = state.world.turn;
      const capital = Math.min(v.invested, Math.round((finalStake(v) * v.sections_open) / t.sections));
      const e = quarterEarnings(capital, t.expected_return, sector, state.world.sentiment, driverFactor(sector, state.markets, data.markets), 1, spread(rng));
      v.earnings = [...v.earnings, e].slice(-4);
    }
    if (built && v.phase === "building") {
      v.phase = "running";
      news(state, `Venture #${v.id} (${t.name}) is built and running.`);
    }

    if (state.world.quarter === 4 && v.earnings.length) {
      const dividend = Math.round(Math.max(0, sum(v.earnings)) * tv.payout);
      if (dividend > 0) {
        state.house.cash += dividend;
        addEntry(state, "cash", "venture_dividend", dividend, `Venture #${v.id}: ${t.name}, dividend for the year`);
      }
    }

    const proven = v.run_start_turn !== null && state.world.turn - v.run_start_turn + 1 >= t.prove_quarters && v.earnings.length === 4;
    if (proven && sum(v.earnings) >= tv.float.min_yield * v.invested) {
      floatVenture(state, v, t, data);
      continue;
    }

    if (v.phase === "running" && v.earnings.length === 4 && sum(v.earnings) < 0) {
      if (rng.next() < Math.min(1, sector.failure * data.tuning.sentiment_multiplier[state.world.sentiment])) {
        addEntry(state, "ventures", "venture_failure", -v.invested, `Venture #${v.id}: ${t.name} failed after years of losses`);
        v.status = "failed";
        news(state, `Venture #${v.id} (${t.name}) closes after years of losses. The stake of ${fl(v.invested)} is lost.`);
      }
    }
  }
}

/** The ventures' End Turn step, drawing from the markets' own random stream. Mutates `state`. */
export function resolveVentures(state: GameState, _rng: Rng, data: GameData): void {
  withMarketsRng(state, (rng) => stepVentures(state, rng, data));
}
