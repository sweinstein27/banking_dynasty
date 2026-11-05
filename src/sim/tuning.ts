import type { Quarter, Sentiment } from "./types";

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
  family: {
    /** Children's starting stats are each drawn as a whole number in this range. */
    child_stats: { min: number; max: number };
    /** A stat at this value changes nothing. */
    neutral_stat: number;
    max_stat: number;
    /** Each point of the head's Acumen above neutral cuts venture failure risk by this share (below neutral, raises it). */
    acumen_step: number;
    /** Each point of the head's Connections above neutral lowers states' reputation gates by this much. */
    connections_step: number;
    /** The head's yearly chance of death from from_age: base + per_year * (age - from_age), rolled each quarter. */
    death: { from_age: number; base: number; per_year: number };
    succession: {
      /** An heir is trained if adult and their stats total at least trained_total. */
      adult_age: number;
      trained_total: number;
      /** Reputation lost when a trained or an untrained heir takes over. */
      reputation_trained: number;
      reputation_untrained: number;
      /** An untrained head's stats count this much lower, for this many quarters. */
      inexperience_penalty: number;
      inexperience_quarters: number;
      /** Stats of the distant cousin who takes over when no heir is left. */
      cousin_stat: number;
    };
    /** At each year end, a head of these ages with fewer than max_heirs heirs has this chance of a child. */
    births: { min_head_age: number; max_head_age: number; max_heirs: number; chance: number };
    /** The three forms of investing in the family, each one action. */
    invest: {
      /** One heir's chosen stat rises by gain, up to max_stat. */
      educate: { cost: number; gain: number };
      charity: { cost: number; reputation: number };
      /** The head's Connections and the house's reputation rise. */
      patronage: { cost: number; connections: number; reputation: number };
    };
  };
  /** Last quarter of the run. Once it has been played the run is finished. */
  end: {
    year: number;
    quarter: Quarter;
  };
  events: {
    /** Chance each quarter that one random event fires. */
    random_chance: number;
    /** Quarters before the same random event can fire again, unless the event sets its own. */
    cooldown_quarters: number;
  };
  /** Responses open to the house while the market is uneasy, panicking, or under a panic warning. */
  crisis: {
    /** Emergency loans from the rival house. */
    rival: { name: string; rate: number; term_quarters: number; max_outstanding: number; min_amount: number; reputation_cost: number };
    /** Pay depositors this share of what they ask this quarter. */
    pay_slowly: { share: number; reputation_cost: number };
    suspend: { reputation_cost: number };
    /** A called loan returns this share of its principal now; the borrower stays away for absence_quarters. */
    call_loan: { recovery: number; absence_quarters: number };
  };
  /** Shared by every decision type. */
  actions_per_turn: number;
  sentiment_multiplier: Record<Sentiment, number>;
  sentiment: {
    /** Chance per quarter of moving from one mood to another. Whatever is left over is the chance of staying. */
    transitions: Record<Sentiment, Partial<Record<Sentiment, number>>>;
    /** Share of deposits withdrawn each quarter in each mood. */
    withdrawal_share: Record<Sentiment, number>;
    /** Scales withdrawals by reputation: 1 + weight * (neutral - reputation) / neutral. */
    reputation_withdrawals: { neutral: number; weight: number };
    /** Quarters of warning before a panic that the mood roll brings: a whole number from min to max. */
    panic_warning_quarters: { min: number; max: number };
    /** Warning signs for the news, one per warning quarter, in turn. */
    warning_signs: string[];
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
    /** Borrowers asking for a loan each quarter. */
    requests_per_quarter: number;
    /** A request is drawn between min and max, then grows by growth_per_repaid for each loan repaid, up to max_growth times. */
    request_amount: { min: number; max: number; growth_per_repaid: number; max_growth: number };
    /** Highest rate a borrower pays: base + spread * (1 - market_quality), to the nearest half percent. */
    rate: { base: number; spread: number };
    /** Market quality is true quality plus up to +/- noise; a default lowers it, a repayment raises it. */
    market: { noise: number; default_penalty: number; repaid_bonus: number };
    /**
     * The player's estimate is a range of +/- width around a point that always lies within width of the
     * truth. Each point of Prudence narrows width by prudence_step; a report sets it to report_width.
     */
    estimate: { width: number; prudence_step: number; report_width: number; report_cost: number };
    /** A borrower who defaults asks for nothing for this many quarters. */
    defaulter_absence_quarters: number;
  };
}

/** Everything loaded from data/*.json. The sim receives it as an argument and does no I/O. */
export interface GameData {
  tuning: Tuning;
  /** Merchant houses that borrow, from data/borrowers.json. */
  borrowers: BorrowerType[];
  family: FamilyData;
  /** States whose bonds can be bought, from data/states.json. */
  states: BondIssuer[];
  /** Kinds of venture the house can back, from data/ventures.json. */
  ventures: VentureType[];
  /** Historical and random events, from data/events.json. */
  events: GameEvent[];
}

/** All must hold for an event to fire. Years refer to the quarter the event describes. */
export interface EventConditions {
  min_year?: number;
  max_year?: number;
  sentiment?: Sentiment[];
  min_reputation?: number;
  max_reputation?: number;
  has_active_loans?: boolean;
  /** Id of a state whose bonds the house holds. */
  holds_bonds_of?: string;
  /** The head has at least one living heir. */
  has_heirs?: boolean;
}

export type EventEffect =
  | { kind: "set_sentiment"; sentiment: Sentiment }
  | { kind: "reputation"; delta: number }
  /** Cash gained (positive) or lost (negative): a fixed amount, or a share of current cash. */
  | { kind: "cash"; amount?: number; share?: number }
  /** One active loan, picked at random, defaults. */
  | { kind: "loan_default" }
  | { kind: "state_risk"; state: string; delta: number }
  /** Multiplies every loan's default chance from now on (0.8 makes trade lending safer). */
  | { kind: "trade_risk"; factor: number }
  /** Starts a countdown to a panic in `quarters` quarters, unless one is running or the market already panics. */
  | { kind: "panic_warning"; quarters: number }
  /** One living heir, picked at random, gains `gain` in one stat, also picked at random (up to max_stat). */
  | { kind: "heir_talent"; gain: number };

/** One record in data/events.json. Historical events fire once at their date; random ones by weight. */
export interface GameEvent {
  id: string;
  title: string;
  text: string;
  historical: boolean;
  /** Historical events: the quarter they describe. */
  year?: number;
  quarter?: Quarter;
  /** Random events: relative chance of being picked among those eligible. */
  weight?: number;
  cooldown_quarters?: number;
  conditions: EventConditions;
  /** May be empty for news-only events. */
  effects: EventEffect[];
}

/** data/family.json: the house's starting family. Names are invented. */
export interface FamilyData {
  head: { name: string; birth_year: number; acumen: number; prudence: number; connections: number };
  children: { name: string; birth_year: number }[];
  surname: string;
  /** Takes over if the head dies with no heir left. */
  cousin: { name: string; age: number };
  /** First names for children born during the game, used in turn. */
  child_names: string[];
}

export interface BorrowerType {
  name: string;
  trade: string;
  /** True quality is drawn from this range at the start of each game. */
  quality: [number, number];
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
