// What each decision can be made with right now, for the terminal and the UI to list.
import { bondPrice, reputationGate, stateRisk } from "./bonds";
import { headEffects, headStat } from "./family";
import { estimateRange } from "./borrowers";
import type { GameData } from "./tuning";
import type { GameState } from "./types";
import { ventureFailureChance } from "./ventures";

/** A loan request as the player may see it: no true quality, only the estimate range. */
export interface LendOffer {
  borrower_id: number;
  name: string;
  trade: string;
  /** Most the borrower will take, in whole gulden. */
  amount: number;
  /** Highest annual rate the borrower will pay. */
  max_rate: number;
  /** The player's quality estimate; it always contains the true quality. */
  estimate: { low: number; high: number };
  reported: boolean;
  repaid: number;
  defaulted: number;
}

export interface BondOffer {
  id: string;
  name: string;
  coupon: number;
  risk: number;
  /** Price per gulden of face value at today's mood. */
  price: number;
  /** Why this state will not sell to the house now, or null if it will. */
  blocked: string | null;
}

export interface VentureOffer {
  id: string;
  name: string;
  term_quarters: number;
  expected_return: number;
  /** Failure chance if the venture ended in today's mood. */
  failure_chance: number;
  unlock_year: number;
  /** Why it cannot be backed now, or null if it can. */
  blocked: string | null;
}

/** This quarter's loan requests, in borrower order. */
export function lendOffers(state: GameState, data: GameData): LendOffer[] {
  return state.requests.map((r) => {
    const b = state.borrowers.find((x) => x.id === r.borrower_id)!;
    return {
      borrower_id: b.id,
      name: b.name,
      trade: b.trade,
      amount: r.amount,
      max_rate: r.max_rate,
      estimate: estimateRange(b, headStat(state, "prudence", data), data.tuning),
      reported: b.reported,
      repaid: b.repaid,
      defaulted: b.defaulted,
    };
  });
}

export function bondOffers(state: GameState, data: GameData): BondOffer[] {
  return data.states.map((st) => {
    let blocked: string | null = null;
    if (state.defaulted_states.includes(st.id)) blocked = "Defaulted";
    else if (state.house.reputation < reputationGate(state, st, data)) blocked = `Needs reputation ${reputationGate(state, st, data)}`;
    return {
      id: st.id,
      name: st.name,
      coupon: st.coupon,
      risk: stateRisk(state, st),
      price: bondPrice(stateRisk(state, st), state.world.sentiment, data.tuning),
      blocked,
    };
  });
}

export function ventureOffers(state: GameState, data: GameData): VentureOffer[] {
  return data.ventures.map((v) => ({
    id: v.id,
    name: v.name,
    term_quarters: v.term_quarters,
    expected_return: v.expected_return,
    failure_chance: ventureFailureChance(v.failure_risk, state.world.sentiment, data.tuning, headStat(state, "acumen", data), headEffects(state, data).venture_failure),
    unlock_year: v.unlock_year,
    blocked: state.world.year < v.unlock_year ? `Not before ${v.unlock_year}` : null,
  }));
}
