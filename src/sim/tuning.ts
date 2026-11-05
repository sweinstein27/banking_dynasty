import type { Quarter, Sentiment, TierName } from "./types";

export interface TierTuning {
  quality: number;
  max_rate: number;
}

export interface Tuning {
  start: {
    year: number;
    quarter: Quarter;
    house_name: string;
    city: string;
    cash: number;
    deposits: number;
    reputation: number;
    base_rate: number;
    sentiment: Sentiment;
    reserve: number;
    /** Placeholder name shown in the Family panel until Week 5 adds people. */
    head_of_house: string;
  };
  /** Last quarter of the run. Once it has been played the run is finished. */
  end: {
    year: number;
    quarter: Quarter;
  };
  /** Shared by every decision type. */
  actions_per_turn: number;
  sentiment_multiplier: Record<Sentiment, number>;
  sentiment: {
    /** Chance per quarter of moving from one mood to another. Whatever is left over is the chance of staying. */
    transitions: Record<Sentiment, Partial<Record<Sentiment, number>>>;
    /** Share of deposits withdrawn each quarter in each mood. */
    withdrawal_share: Record<Sentiment, number>;
  };
  /** Haircut taken when assets are sold to meet withdrawals. 0.3 means 70% of book value is recovered. */
  forced_sale: {
    loan_discount: number;
    /** Taken off the current market price. */
    bond_discount: number;
    /** Taken off the amount invested. */
    venture_discount: number;
  };
  ventures: {
    /** Smallest amount that can be invested. */
    min_amount: number;
  };
  bonds: {
    /** Base default chance per quarter: p_default = p0 * m_sentiment * risk. */
    p0: number;
    /** price = 1 - price_sensitivity * risk * (m_sentiment - 1), never below price_floor. */
    price_sensitivity: number;
    price_floor: number;
    /** Smallest face value that can be bought. */
    min_amount: number;
  };
  loans: {
    p0: number;
    term_quarters: number;
    min_amount: number;
    tiers: Record<TierName, TierTuning>;
  };
}

/** Everything loaded from data/*.json. The sim receives it as an argument and does no I/O. */
export interface GameData {
  tuning: Tuning;
  borrower_names: string[];
  /** States whose bonds can be bought, from data/states.json. */
  states: BondIssuer[];
  /** Kinds of venture the house can back, from data/ventures.json. */
  ventures: VentureType[];
}

export interface VentureType {
  id: string;
  name: string;
  /** Capital is locked for this many quarters, counting the quarter of investment. */
  term_quarters: number;
  /** Profit on success as a share of the amount invested, paid at maturity. */
  expected_return: number;
  /** Chance of failure at maturity when calm; scaled by the sentiment multiplier, capped at 1. */
  failure_risk: number;
  /** Cannot be backed before this year. */
  unlock_year: number;
}

export interface BondIssuer {
  id: string;
  name: string;
  /** Annual coupon on face value. */
  coupon: number;
  /** 0 (safest) to 1 (riskiest). Drives default chance and how far the price falls with sentiment. */
  risk: number;
  /** The state will not deal with a house below this reputation. */
  min_reputation: number;
}
