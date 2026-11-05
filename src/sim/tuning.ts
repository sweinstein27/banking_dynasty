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
  };
  sentiment_multiplier: Record<Sentiment, number>;
  loans: {
    p0: number;
    term_quarters: number;
    actions_per_turn: number;
    min_amount: number;
    tiers: Record<TierName, TierTuning>;
  };
}

/** Everything loaded from data/*.json. The sim receives it as an argument and does no I/O. */
export interface GameData {
  tuning: Tuning;
  borrower_names: string[];
}
