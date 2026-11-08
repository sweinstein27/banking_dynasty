// Insurance underwriting. Merchants ask cover for a ship's voyage or a warehouse for a year. The
// house takes a line (a share of the value), takes the premium at once, and pays its share of any
// loss. Losses are rare and independent, except in a great storm (every ship at sea at once) or a
// great fire (the Hamburg fire of May 1842).
import type { DecisionResult } from "../actions";
import { checkCapacity, useCapacity } from "../capacity";
import { fl } from "../format";
import { addEntry } from "../ledger";
import type { Rng } from "../rng";
import { cloneState } from "../state";
import type { GameData } from "../tuning";
import type { GameState } from "../types";
import { seasonFactor } from "./auctions";
import { between, ensureCash, financeNews, nextId, pct, roundTo } from "./common";
import type { CoverRequest, Policy, UnderwriteDecision } from "./types";

export function openCoverRequests(state: GameState): CoverRequest[] {
  return state.finance.cover_requests.filter((r) => r.open_turn === state.world.turn);
}

export const activePolicies = (state: GameState) => state.finance.policies.filter((p) => p.status === "active");

/** The house's share of the value it insures now. */
export function exposure(state: GameState): number {
  return activePolicies(state).reduce((s, p) => s + p.value, 0);
}

export const premiumFor = (r: Pick<CoverRequest, "value" | "premium_rate">, line: number) => Math.round(r.value * line * r.premium_rate);

export function checkUnderwrite(state: GameState, d: UnderwriteDecision, data: GameData): string | null {
  const r = openCoverRequests(state).find((x) => x.id === d.request);
  if (!r) return `No request for cover ${d.request} is open this quarter`;
  const noAction = checkCapacity(state, "underwrite", data.tuning);
  if (noAction) return noAction;
  if (!data.finance.insurance.lines.includes(d.line)) return `A line must be one of ${data.finance.insurance.lines.map(pct).join(", ")}`;
  return null;
}

/** Writes a policy: the premium comes in now; the cover starts this quarter. Returns a new state. */
export function underwrite(state: GameState, d: UnderwriteDecision, data: GameData): DecisionResult {
  const reason = checkUnderwrite(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const r = next.finance.cover_requests.find((x) => x.id === d.request)!;
  const premium = premiumFor(r, d.line);
  const policy: Policy = {
    id: nextId(next), kind: r.kind, insured: r.insured, what: r.what, value: Math.round(r.value * d.line), line: d.line, premium,
    start_turn: next.world.turn, end_turn: next.world.turn + r.quarters - 1, status: "active",
  };
  next.finance.policies.push(policy);
  next.finance.cover_requests = next.finance.cover_requests.filter((x) => x.id !== r.id);
  next.house.cash += premium;
  addEntry(next, "cash", "premium", premium, `Premium: ${policyName(policy)}, ${pct(d.line)} of ${fl(r.value)}`);
  useCapacity(next, "underwrite", data.tuning);
  return { ok: true, state: next };
}

export const policyName = (p: Pick<Policy, "kind" | "insured" | "what">) => (p.kind === "ship" ? `the ${p.what} (${p.insured})` : `${p.insured}'s warehouse at ${p.what}`);

/** The great fire due this quarter in a city, if any. */
function fireIn(state: GameState, city: string, data: GameData) {
  return data.finance.insurance.great_fires.find((f) => f.year === state.world.year && f.quarter === state.world.quarter && f.city === city);
}

/**
 * Rolls a great storm (one roll, likelier in winter). Returns the factor on ships' loss chance
 * this quarter. Mutates `state` (records the storm).
 */
export function rollStorm(state: GameState, rng: Rng, data: GameData): number {
  const s = data.finance.insurance.storm;
  const chance = seasonFactor(state, data) > 1 ? s.winter_chance : s.chance;
  if (rng.next() >= chance) return 1;
  state.finance.storm_turn = state.world.turn;
  const exposed = activePolicies(state).some((p) => p.kind === "ship") || state.finance.assets.some((a) => a.kind === "ship");
  if (exposed) financeNews(state, "A great storm has swept the North Sea and the river mouths. Ships are overdue at every port.", "A great storm");
  return s.ship_factor;
}

/**
 * Each active policy may suffer a loss (one roll, and one for its size when it does), then those
 * whose term ends expire. Claims are paid at once, selling assets if cash is short; a house that
 * still cannot pay is bankrupt. Mutates `state`.
 */
export function settlePolicies(state: GameState, rng: Rng, data: GameData, stormFactor: number): void {
  const t = data.finance.insurance;
  let fireNewsDone = false;
  for (const p of activePolicies(state)) {
    let chance: number;
    if (p.kind === "ship") chance = t.ship.loss_chance * seasonFactor(state, data) * stormFactor;
    else {
      const fire = fireIn(state, p.what, data);
      chance = fire ? fire.chance : t.warehouse.loss_chance;
      if (fire && !fireNewsDone) {
        financeNews(state, fire.text, fire.title);
        fireNewsDone = true;
      }
    }
    if (rng.next() < chance) {
      const lostShare = p.kind === "ship" ? 1 - between(rng, t.ship.salvage) : between(rng, t.warehouse.damage);
      const claim = roundTo(p.value * lostShare, 100);
      p.status = "claimed";
      if (claim > 0) {
        if (!ensureCash(state, claim, data, `to pay the claim on ${policyName(p)}`)) return;
        state.house.cash -= claim;
        addEntry(state, "cash", "claim", -claim, `Claim: ${policyName(p)} ${p.kind === "ship" ? "lost" : "burned"}`);
      }
      financeNews(state, `${p.kind === "ship" ? `The ${p.what}, insured for ${p.insured}, is lost` : `${p.insured}'s warehouse at ${p.what} has burned`}. The house pays ${fl(claim)}`, "A claim");
      continue;
    }
    if (state.world.turn >= p.end_turn) p.status = "expired";
  }
  // Keep the last few years of policies for the record.
  state.finance.policies = state.finance.policies.filter((p) => p.status === "active" || p.end_turn > state.world.turn - 16);
}

/**
 * Next quarter's requests for cover: `requests_per_quarter`, each a ship (by `ship_weight`) or a
 * warehouse, insured by a merchant the house knows, with a value and a premium of the expected
 * loss over the term plus the load (season of the request's quarter for ships). Four rolls each.
 */
export function drawCoverRequests(state: GameState, rng: Rng, data: GameData): void {
  const t = data.finance.insurance;
  state.finance.cover_requests = state.finance.cover_requests.filter((r) => r.open_turn > state.world.turn);
  const names = state.borrowers.map((b) => b.name);
  if (!names.length) return;
  const nextQuarter = state.world.quarter === 4 ? 1 : state.world.quarter + 1;
  const winter = data.finance.auctions.winter_quarters.includes(nextQuarter) ? data.finance.auctions.winter_factor : 1;
  for (let i = 0; i < t.requests_per_quarter; i++) {
    const ship = rng.next() < t.ship_weight;
    const spec = ship ? t.ship : t.warehouse;
    const insured = names[Math.floor(rng.next() * names.length)]!;
    const what = ship ? t.ship_names[Math.floor(rng.next() * t.ship_names.length)]! : t.cities[Math.floor(rng.next() * t.cities.length)]!;
    const value = roundTo(between(rng, spec.value), t.value_step);
    const expected = spec.loss_chance * (ship ? winter : 1) * spec.quarters;
    const premium_rate = Math.round(expected * (1 + t.load) * 10000) / 10000;
    state.finance.cover_requests.push({ id: nextId(state), kind: ship ? "ship" : "warehouse", insured, what, value, quarters: spec.quarters, premium_rate, open_turn: state.world.turn + 1 });
  }
}
