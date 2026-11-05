// What each decision can be made with right now, for the terminal and the UI to list.
import { bondPrice, stateRisk } from "./bonds";
import type { GameData, Tuning } from "./tuning";
import type { GameState, TierName } from "./types";
import { ventureFailureChance } from "./ventures";

export interface LendOffer {
  tier: TierName;
  quality: number;
  /** Highest annual rate this tier accepts. */
  max_rate: number;
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

export function lendOffers(tuning: Tuning): LendOffer[] {
  return (Object.keys(tuning.loans.tiers) as TierName[]).map((tier) => ({
    tier,
    quality: tuning.loans.tiers[tier].quality,
    max_rate: tuning.loans.tiers[tier].max_rate,
  }));
}

export function bondOffers(state: GameState, data: GameData): BondOffer[] {
  return data.states.map((st) => {
    let blocked: string | null = null;
    if (state.defaulted_states.includes(st.id)) blocked = "Defaulted";
    else if (state.house.reputation < st.min_reputation) blocked = `Needs reputation ${st.min_reputation}`;
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
    failure_chance: ventureFailureChance(v.failure_risk, state.world.sentiment, data.tuning),
    unlock_year: v.unlock_year,
    blocked: state.world.year < v.unlock_year ? `Not before ${v.unlock_year}` : null,
  }));
}
