import { fl } from "./format";
import { checkActionLeft, type DecisionResult } from "./actions";
import { addEntry } from "./ledger";
import { freeCash } from "./reserves";
import type { Rng } from "./rng";
import type { BondIssuer, GameData, Tuning } from "./tuning";
import type { Bond, BuyBondDecision, GameState, Sentiment } from "./types";

/** Market price per gulden of face value: 1 - sensitivity * risk * (m - 1), floored, to 4 decimals. */
export function bondPrice(risk: number, sentiment: Sentiment, tuning: Tuning): number {
  const t = tuning.bonds;
  const raw = 1 - t.price_sensitivity * risk * (tuning.sentiment_multiplier[sentiment] - 1);
  return Math.round(Math.max(t.price_floor, raw) * 10000) / 10000;
}

/** Book value of a holding at its last mark, in whole gulden. */
export function bondValue(bond: Pick<Bond, "face_value" | "price">): number {
  return Math.round(bond.face_value * bond.price);
}

export function bondBook(state: GameState): number {
  return state.bonds.filter((b) => b.status === "active").reduce((sum, b) => sum + bondValue(b), 0);
}

/** One quarter's coupon in whole gulden. */
export function quarterlyCoupon(bond: Pick<Bond, "face_value" | "coupon">): number {
  return Math.round((bond.face_value * bond.coupon) / 4);
}

/** p_default = p0 * m_sentiment * risk, per quarter, per state. */
export function bondDefaultChance(risk: number, sentiment: Sentiment, tuning: Tuning): number {
  return tuning.bonds.p0 * tuning.sentiment_multiplier[sentiment] * risk;
}

/** What buying `face_value` of a state's bonds costs now, in whole gulden. */
export function bondCost(state: GameState, issuer: BondIssuer, face_value: number, tuning: Tuning): number {
  return Math.round(face_value * bondPrice(issuer.risk, state.world.sentiment, tuning));
}

/** Returns why a buy_bond decision is invalid, or null if it can go ahead. */
export function checkBuyBond(state: GameState, d: BuyBondDecision, data: GameData): string | null {
  const t = data.tuning;
  const issuer = data.states.find((s) => s.id === d.state);
  if (!issuer) return `Unknown state "${d.state}"`;
  const noAction = checkActionLeft(state, t);
  if (noAction) return noAction;
  if (state.defaulted_states.includes(issuer.id)) return `${issuer.name} has defaulted and sells no new bonds`;
  if (state.house.reputation < issuer.min_reputation)
    return `${issuer.name} will only deal with houses of reputation ${issuer.min_reputation} or more (yours is ${state.house.reputation})`;
  if (!Number.isInteger(d.face_value)) return "Face value must be whole gulden";
  if (d.face_value < t.bonds.min_amount) return `Face value must be at least ${fl(t.bonds.min_amount)}`;
  const cost = bondCost(state, issuer, d.face_value, t);
  if (cost > freeCash(state)) return `Not enough cash above the reserve (cost ${fl(cost)}, free ${fl(freeCash(state))})`;
  return null;
}

/** Buys bonds at the current market price. Returns a new state; the input is not changed. */
export function buyBond(state: GameState, d: BuyBondDecision, data: GameData): DecisionResult {
  const reason = checkBuyBond(state, d, data);
  if (reason) return { ok: false, reason };
  const issuer = data.states.find((s) => s.id === d.state)!;

  const next = structuredClone(state);
  const bond: Bond = {
    id: next.bonds.length + 1,
    issuer_state: issuer.id,
    face_value: d.face_value,
    coupon: issuer.coupon,
    price: bondPrice(issuer.risk, next.world.sentiment, data.tuning),
    risk: issuer.risk,
    purchase_turn: next.world.turn,
    status: "active",
  };
  const cost = bondValue(bond);
  next.bonds.push(bond);
  next.house.cash -= cost;
  next.actions_this_turn += 1;
  const note = `Bond #${bond.id}: ${d.face_value} face of ${issuer.name} at ${bond.price}`;
  addEntry(next, "cash", "bond_purchase", -cost, note);
  addEntry(next, "bonds", "bond_purchase", cost, note);
  return { ok: true, state: next };
}

/**
 * Rolls one default per state the house holds (in data/states.json order), then pays coupons
 * on surviving holdings, including those bought this quarter. A default writes off the whole holding.
 * States the house does not hold are not rolled. Mutates `state`; callers pass a draft copy.
 */
export function resolveBonds(state: GameState, rng: Rng, data: GameData): void {
  const { sentiment } = state.world;
  for (const issuer of data.states) {
    const held = state.bonds.filter((b) => b.status === "active" && b.issuer_state === issuer.id);
    if (!held.length) continue;

    if (rng.next() < bondDefaultChance(issuer.risk, sentiment, data.tuning)) {
      state.defaulted_states.push(issuer.id);
      for (const b of held) {
        addEntry(state, "bonds", "bond_default", -bondValue(b), `Bond #${b.id}: ${issuer.name} defaulted`);
        b.status = "defaulted";
      }
      continue;
    }

    for (const b of held) {
      const coupon = quarterlyCoupon(b);
      state.house.cash += coupon;
      addEntry(state, "cash", "coupon", coupon, `Bond #${b.id}: coupon from ${issuer.name}`);
    }
  }
}

/**
 * Marks every active holding to the price for the current mood, writing a revaluation entry
 * for each change in book value. Call after the mood for the next quarter is set.
 * Mutates `state`; callers pass a draft copy.
 */
export function markBonds(state: GameState, data: GameData): void {
  for (const b of state.bonds) {
    if (b.status !== "active") continue;
    const before = bondValue(b);
    b.price = bondPrice(b.risk, state.world.sentiment, data.tuning);
    const change = bondValue(b) - before;
    if (change !== 0) {
      const name = data.states.find((s) => s.id === b.issuer_state)?.name ?? b.issuer_state;
      addEntry(state, "bonds", "revaluation", change, `Bond #${b.id}: ${name} repriced to ${b.price}`);
    }
  }
}
