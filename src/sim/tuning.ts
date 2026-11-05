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
}
