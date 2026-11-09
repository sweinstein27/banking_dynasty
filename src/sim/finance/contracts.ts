// State loan contracts. A state announces a loan (size, coupon, term); houses bid the commission
// they ask; the state takes the lowest, counting a better name as worth some commission. The
// winner pays caution money, places the bonds with investors over two quarters at the issue price,
// keeps its commission on what it places, and at the close buys what it could not place (a firm
// contract). Those bonds join the house's holdings and are redeemed at par when the term ends.
import type { DecisionResult } from "../actions";
import { bondValue, reputationGate, statePrice, stateRisk } from "../bonds";
import { contractFavour } from "../systems/politics";
import { warContractFactor } from "../systems/war";
import { checkCapacity, useCapacity, workingCount } from "../capacity";
import { fl } from "../format";
import { tradingHouses } from "../houses";
import { rivalBid } from "../systems/rivals";
import { addEntry } from "../ledger";
import { freeCash } from "../reserves";
import type { Rng } from "../rng";
import { cloneState } from "../state";
import type { BondIssuer, GameData } from "../tuning";
import type { Bond, GameState } from "../types";
import { between, changeReputation, clamp, ensureCash, financeNews, nextId, pct, roundTo } from "./common";
import type { BidContractDecision, Contract } from "./types";

const issuerOf = (data: GameData, id: string): BondIssuer | undefined => data.states.find((s) => s.id === id);

/** Reputation a state asks of a house bidding for its loan: its bond gate (less the head's Connections) plus the contract premium. */
export function contractGate(state: GameState, issuer: BondIssuer, data: GameData): number {
  return reputationGate(state, issuer, data) + data.finance.contracts.reputation_premium;
}

/** Caution money for a contract, whole gulden. */
export const cautionFor = (c: Pick<Contract, "size">, data: GameData) => Math.round(c.size * data.finance.contracts.caution);

/** Loans open for bids this quarter. */
export function openContracts(state: GameState): Contract[] {
  return state.finance.contracts.filter((c) => c.status === "open" && c.open_turn === state.world.turn);
}

/** How a state ranks a bid: lower is better. A better name is worth some commission. */
export function bidScore(commission: number, reputation: number, data: GameData): number {
  return commission - (data.finance.contracts.prestige_weight * (reputation - 50)) / 100;
}

/** Caution money the states hold for contracts still placing. */
export function cautionBook(state: GameState): number {
  return state.finance.contracts.filter((c) => c.status === "placing").reduce((s, c) => s + c.caution, 0);
}

export function checkBidContract(state: GameState, d: BidContractDecision, data: GameData): string | null {
  const c = state.finance.contracts.find((x) => x.id === d.contract);
  if (!c || c.status !== "open" || c.open_turn !== state.world.turn) return `No loan ${d.contract} is open for bids this quarter`;
  const issuer = issuerOf(data, c.state);
  if (!issuer) return `Unknown state "${c.state}"`;
  const noAction = checkCapacity(state, "bid_contract", data.tuning);
  if (noAction) return noAction;
  if (c.player_bid !== null) return `The house has already bid for the ${issuer.name} loan`;
  if (!data.finance.contracts.commissions.includes(d.commission)) return `Commission must be one of ${data.finance.contracts.commissions.map(pct).join(", ")}`;
  const gate = contractGate(state, issuer, data);
  if (state.house.reputation < gate) return `${issuer.name} will only give its loan to a house of reputation ${gate} or more (yours is ${state.house.reputation})`;
  const caution = cautionFor(c, data);
  if (caution > freeCash(state)) return `The caution money (${fl(caution)}) is more than the cash above the reserve (${fl(freeCash(state))})`;
  return null;
}

/** Bids for a state's loan. Nothing is paid until the award at End Turn. Returns a new state. */
export function bidContract(state: GameState, d: BidContractDecision, data: GameData): DecisionResult {
  const reason = checkBidContract(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  next.finance.contracts.find((x) => x.id === d.contract)!.player_bid = d.commission;
  useCapacity(next, "bid_contract", data.tuning);
  return { ok: true, state: next };
}

/**
 * Awards this quarter's open loans. Each house still trading that is rich enough (wealth at least
 * `wealth_cover` x the size) and well enough thought of may bid (one roll, then one for its
 * commission). The best score wins; a tie goes to the better name, then to the player. The player
 * pays caution money at once (a bid the house can no longer cover lapses); a rival's commission is
 * added to its wealth. Mutates `state`.
 */
export function awardContracts(state: GameState, rng: Rng, data: GameData): void {
  const t = data.finance.contracts;
  for (const c of openContracts(state)) {
    const issuer = issuerOf(data, c.state)!;
    // rank: the commission the bid is ranked at, when it differs from the fee (C2 favour).
    type Bid = { who: string; name: string; commission: number; rank?: number; reputation: number };
    const bids: Bid[] = [];
    if (c.player_bid !== null) {
      if (state.house.cash >= cautionFor(c, data) && state.house.status !== "bankrupt")
        // C2: influence and a court post make the player's bid rank as if it asked less; the fee stays the bid.
        bids.push({ who: "player", name: state.house.name, commission: c.player_bid, rank: Math.max(0, c.player_bid - contractFavour(state, c.state, data)), reputation: state.house.reputation });
      else financeNews(state, `${state.house.name}'s bid for the ${issuer.name} loan lapsed: the caution money was not in the till.`);
    }
    for (const h of tradingHouses(state)) {
      if (h.wealth < c.size * t.rivals.wealth_cover || h.reputation < issuer.min_reputation + t.reputation_premium) continue;
      if (rng.next() >= t.rivals.bid_chance[h.temperament]) continue;
      const drawn = Math.round((Math.round(between(rng, t.rivals.commission[h.temperament]) / 0.0025) * 0.0025) * 10000) / 10000;
      // B1: a short-handed house sits out; a hostile one may undercut the player's bid.
      const commission = rivalBid(state, h, drawn, c.player_bid, data);
      if (commission === null) continue;
      bids.push({ who: h.id, name: h.name, commission, reputation: h.reputation });
    }
    if (!bids.length) {
      c.status = "unawarded";
      financeNews(state, `No house would take the ${issuer.name} loan of ${fl(c.size)}; the state has withdrawn it.`);
      continue;
    }
    bids.sort((a, b) => bidScore(a.rank ?? a.commission, a.reputation, data) - bidScore(b.rank ?? b.commission, b.reputation, data) || b.reputation - a.reputation || Number(b.who === "player") - Number(a.who === "player"));
    const win = bids[0]!;
    c.winner = win.who;
    c.commission = win.commission;
    if (win.who === "player") {
      c.status = "placing";
      c.issue_price = statePrice(state, issuer, data);
      c.caution = cautionFor(c, data);
      state.house.cash -= c.caution;
      const note = `Caution money for the ${issuer.name} loan of ${fl(c.size)}`;
      addEntry(state, "cash", "contract_caution", -c.caution, note);
      addEntry(state, "caution", "contract_caution", c.caution, note);
      financeNews(state, `${issuer.name} has given its loan of ${fl(c.size)} at ${pct(c.coupon)} to ${state.house.name}, at a commission of ${pct(win.commission)}. The bonds go to investors at ${c.issue_price}.`, "A state loan is ours");
    } else {
      c.status = "lost";
      const h = state.houses.find((x) => x.id === win.who)!;
      h.wealth += Math.round(win.commission * c.size);
      h.reputation = Math.min(100, h.reputation + t.rivals.reputation_gain);
      const ours = c.player_bid !== null ? ` Your bid of ${pct(c.player_bid)} was passed over.` : "";
      financeNews(state, `${h.name} has won the ${issuer.name} loan of ${fl(c.size)} at a commission of ${pct(win.commission)}.${ours}`);
    }
  }
}

/** Share of the unplaced bonds investors take this quarter, before noise. */
export function placementRate(state: GameState, c: Contract, data: GameData): number {
  const p = data.finance.contracts.placement;
  const issuer = issuerOf(data, c.state)!;
  if (state.defaulted_states.includes(issuer.id)) return 0;
  const name = p.reputation_floor + (p.reputation_slope * state.house.reputation) / 100;
  const risk = 1 - p.risk_drag * stateRisk(state, issuer);
  return clamp(p.base[state.world.sentiment] * name * risk + p.per_correspondent * workingCount(state, "correspondent"), 0, p.max);
}

/**
 * One quarter of placing for each contract the player is placing (one roll each): investors take a
 * share of what is left at the issue price and the house keeps its commission on it. After the last
 * quarter the contract closes. Mutates `state`.
 */
export function placeContracts(state: GameState, rng: Rng, data: GameData): void {
  const p = data.finance.contracts.placement;
  for (const c of state.finance.contracts) {
    if (c.status !== "placing" || c.open_turn >= state.world.turn) continue;
    const noise = 1 + p.noise * (2 * rng.next() - 1);
    const remaining = c.size - c.placed;
    const placed = Math.min(remaining, roundTo(remaining * clamp(placementRate(state, c, data) * noise, 0, p.max), 100));
    c.placed += placed;
    c.quarters_placed += 1;
    const issuer = issuerOf(data, c.state)!;
    const fee = Math.round(placed * c.issue_price! * c.commission!);
    if (fee > 0) {
      state.house.cash += fee;
      addEntry(state, "cash", "contract_fee", fee, `Commission on ${fl(placed)} of ${issuer.name} bonds placed with investors`);
    }
    if (c.quarters_placed >= p.quarters) closeContract(state, c, data);
  }
}

/**
 * Closes a contract: the caution money comes back and the house buys what investors would not
 * take, at the issue price less its commission. If the state has defaulted meanwhile, the contract
 * collapses: the caution money is lost and nothing more is bought. Mutates `state`.
 */
export function closeContract(state: GameState, c: Contract, data: GameData): void {
  const issuer = issuerOf(data, c.state)!;
  c.status = "closed";
  const caution = c.caution;
  c.caution = 0;
  if (state.defaulted_states.includes(issuer.id)) {
    addEntry(state, "caution", "contract_caution", -caution, `Caution money for the ${issuer.name} loan, lost in its default`);
    financeNews(state, `${issuer.name} has defaulted before its loan was placed. The caution money of ${fl(caution)} is lost.`);
    return;
  }
  state.house.cash += caution;
  const back = `Caution money returned by ${issuer.name}`;
  addEntry(state, "cash", "contract_caution", caution, back);
  addEntry(state, "caution", "contract_caution", -caution, back);

  const t = data.finance.contracts;
  const remaining = c.size - c.placed;
  if (remaining > 0) {
    const price = Math.round(c.issue_price! * (1 - c.commission!) * 10000) / 10000;
    const cost = Math.round(remaining * price);
    if (!ensureCash(state, cost, data, `to take up the unplaced ${issuer.name} bonds`)) return;
    const bond: Bond = {
      id: state.bonds.length + 1,
      issuer_state: issuer.id,
      face_value: remaining,
      coupon: c.coupon,
      price,
      risk: stateRisk(state, issuer),
      purchase_turn: state.world.turn,
      status: "active",
    };
    state.bonds.push(bond);
    c.carried = remaining;
    state.house.cash -= bondValue(bond);
    const note = `Bond #${bond.id}: ${remaining} face of ${issuer.name} that investors would not take, at ${price}`;
    addEntry(state, "cash", "contract_carry", -bondValue(bond), note);
    addEntry(state, "bonds", "contract_carry", bondValue(bond), note);
    state.finance.redemptions.push({ bond: bond.id, turn: state.world.turn + c.term_years * 4 });
  }
  const share = c.placed / c.size;
  let rep = 0;
  if (share >= t.prestige.good_share) rep = c.size >= t.prestige.big_size ? t.prestige.big : t.prestige.good;
  else if (share < t.prestige.stuck_share) rep = t.prestige.stuck;
  changeReputation(state, rep);
  const carried = remaining > 0 ? ` The house carries ${fl(remaining)} of face value.` : "";
  const word = rep > 0 ? "The bourse speaks well of the issue." : rep < 0 ? "The issue stuck, and the bourse has noticed." : "";
  financeNews(state, `The ${issuer.name} loan is closed: ${Math.round(share * 100)}% placed with investors.${carried} ${word}`.trim(), "A loan is placed");
}

/** Bonds carried from contracts are redeemed at par when their term ends. Mutates `state`. */
export function redeemBonds(state: GameState, data: GameData): void {
  const due = state.finance.redemptions.filter((r) => r.turn <= state.world.turn);
  if (!due.length) return;
  state.finance.redemptions = state.finance.redemptions.filter((r) => r.turn > state.world.turn);
  for (const r of due) {
    const b = state.bonds.find((x) => x.id === r.bond);
    if (!b || b.status !== "active") continue;
    const name = issuerOf(data, b.issuer_state)?.name ?? b.issuer_state;
    const note = `Bond #${b.id}: ${name} redeems ${fl(b.face_value)} at par`;
    state.house.cash += b.face_value;
    addEntry(state, "cash", "contract_redemption", b.face_value, note);
    addEntry(state, "bonds", "contract_redemption", -bondValue(b), note);
    b.status = "sold";
    financeNews(state, `${name} has redeemed ${fl(b.face_value)} of its bonds at par.`);
  }
}

/** The era factor on announcements for a year. */
export function eraFactor(year: number, data: GameData): number {
  return data.finance.contracts.eras.filter((e) => year >= e.from && year <= e.to).reduce((f, e) => f * e.factor, 1);
}

/**
 * Each state with sizes in data/finance.json that has not defaulted and has no loan open or placing
 * may announce a loan, open for bids next quarter (one roll per state, three more on an
 * announcement: size, coupon premium, term). Mutates `state`.
 */
export function announceContracts(state: GameState, rng: Rng, data: GameData): void {
  const t = data.finance.contracts;
  const chance = t.announce_chance * eraFactor(state.world.year, data) * t.mood_factor[state.world.sentiment];
  for (const issuer of data.states) {
    const sizes = t.sizes[issuer.id];
    if (!sizes || state.defaulted_states.includes(issuer.id)) continue;
    if (state.finance.contracts.some((c) => c.state === issuer.id && (c.status === "open" || c.status === "placing"))) continue;
    if (rng.next() >= chance * warContractFactor(state, issuer.id, data)) continue;
    const size = roundTo(between(rng, sizes), t.size_step);
    const coupon = Math.round((issuer.coupon + Math.round(between(rng, t.coupon_premium) / 0.0025) * 0.0025) * 10000) / 10000;
    const term = t.terms[Math.floor(rng.next() * t.terms.length)]!;
    state.finance.contracts.push({
      id: nextId(state), state: issuer.id, size, coupon, term_years: term, open_turn: state.world.turn + 1, status: "open",
      player_bid: null, winner: null, commission: null, issue_price: null, placed: 0, quarters_placed: 0, caution: 0, carried: 0,
    });
    financeNews(state, `${issuer.name} seeks a loan of ${fl(size)} at ${pct(coupon)} for ${term} years, and invites the houses to bid.`, "A state seeks a loan");
  }
}
