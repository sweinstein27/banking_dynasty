import type { CountingData } from "./systems/counting";
import type { CreditData } from "./systems/credit";
import type { MarketsData } from "./systems/markets";
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
    /**
     * A newborn takes one of the head's traits with inherit_chance, else a random one. At 18 an heir
     * gains the virtue of any stat that has reached virtue_stat, else a random trait.
     */
    traits: { inherit_chance: number; virtue_stat: number };
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
      /** Reputation lost when the new head is not the eldest living heir (named or not). */
      passed_over_reputation: number;
      /** An untrained head's stats count this much lower, for this many quarters. */
      inexperience_penalty: number;
      inexperience_quarters: number;
      /** Stats of the distant cousin who takes over when no heir is left. */
      cousin_stat: number;
    };
    /** At each year end, a head of these ages with fewer than max_heirs heirs has this chance of a child. */
    /**
     * At each year end, every married couple in the line (head or heir, with a living spouse) whose
     * wife is min_mother_age to max_mother_age has this chance of a child, while the living heirs
     * number fewer than max_heirs.
     */
    births: { min_mother_age: number; max_mother_age: number; max_heirs: number; chance: number };
    /** A spouse from a house has stats of 2 + its reputation / 25, kept in this range. */
    spouse_stats: { min: number; max: number };
    /**
     * Arranging a marriage (one action) for a member of the line aged min_age or more with no living
     * spouse. "in": a son or daughter of a house joins this one; the house must think at least
     * min_opinion of yours and your reputation be no more than reputation_gap below its own; it pays a
     * dowry of dowry_share of its wealth; its opinion rises by `opinion` and its baseline by
     * `baseline`. "out": an heir joins the other house and leaves the line; the house must think at
     * least min_opinion of yours; you pay `dowry`. A merchant's family: always willing; costs `cost`;
     * the spouse's stats are `stat`. When a house allied by marriage fails, reputation falls by
     * ally_failure_reputation.
     */
    marriage: {
      min_age: number;
      in: { min_opinion: number; reputation_gap: number; dowry_share: number; opinion: number; baseline: number };
      out: { min_opinion: number; dowry: number; opinion: number; baseline: number };
      merchant: { cost: number; stat: number };
      ally_failure_reputation: number;
    };
    /** The three forms of investing in the family, each one action. */
    invest: {
      /** One heir's chosen stat rises by gain, up to max_stat. */
      educate: { cost: number; gain: number };
      charity: { cost: number; reputation: number };
      /** The head's Connections and the house's reputation rise. */
      patronage: { cost: number; connections: number; reputation: number };
    };
  };
  /** The other Frankfurt houses (data/houses.json). */
  houses: {
    /** Quarterly growth of a house's wealth by temperament, plus a shock for the quarter's mood, plus noise up to +/- noise. */
    growth: Record<Temperament, number>;
    shock: Record<Sentiment, Record<Temperament, number>>;
    noise: number;
    /** Each quarter a house's reputation moves this share of the way back to its starting reputation. */
    reputation_pull: number;
    /** In each panic quarter a house fails with this chance, times start wealth / wealth (between 0.5 and 3). */
    fail_chance: Record<Temperament, number>;
    /** When a house fails, this share of its wealth, times the player's reputation / 100, comes to the player as deposits. */
    depositors_share: number;
    /** Opinion of the player's house: kept between min and max, drifting each quarter toward the house's baseline by `drift` of the gap; a new head moves it `succession_reset` of the way back. */
    opinion: { min: number; max: number; drift: number; succession_reset: number };
    /** Court a house: one action, `cost` fl., opinion + `opinion`. */
    court: { cost: number; opinion: number };
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
  /**
   * Deposits follow reputation: in calm quarters they move catch_up of the way toward
   * per_reputation fl. per point of reputation. Depositors earn interest_rate a year, credited quarterly.
   */
  deposits: { per_reputation: number; catch_up: number; interest_rate: number };
  /** Responses open to the house while the market is uneasy, panicking, or under a panic warning. */
  crisis: {
    /**
     * Emergency loans from another house. A house lends if its opinion of the player is at least
     * min_opinion, at base_rate - rate_per_opinion x opinion / 100, up to wealth_share of its wealth
     * (less what it has lent already), and never more than max_outstanding from all houses together.
     * Repaying on time raises the lender's opinion by repaid_opinion.
     */
    lending: {
      base_rate: number;
      rate_per_opinion: number;
      min_opinion: number;
      wealth_share: number;
      term_quarters: number;
      max_outstanding: number;
      min_amount: number;
      reputation_cost: number;
      repaid_opinion: number;
    };
    /** Pay depositors this share of what they ask this quarter. */
    pay_slowly: { share: number; reputation_cost: number };
    /** Suspending also lowers every house's opinion of the player by opinion_cost. */
    suspend: { reputation_cost: number; opinion_cost: number };
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
  /** Character traits, from data/traits.json. */
  traits: TraitType[];
  /** States whose bonds can be bought, from data/states.json. */
  states: BondIssuer[];
  /** Kinds of venture the house can back, from data/ventures.json. */
  ventures: VentureType[];
  /** Historical and random events, from data/events.json. */
  events: GameEvent[];
  /** The other Frankfurt houses, from data/houses.json. Names are invented. */
  houses: HousesData;
  /** Each system's own data (src/sim/systems/), from data/credit.json, data/counting.json and data/markets.json. */
  credit: CreditData;
  counting: CountingData;
  markets: MarketsData;
}

export type Temperament = "cautious" | "bold";

/** data/houses.json */
export interface HousesData {
  houses: {
    id: string;
    name: string;
    surname: string;
    temperament: Temperament;
    head: { name: string; birth_year: number };
    heir: { name: string; birth_year: number };
    wealth: number;
    reputation: number;
    /** Starting opinion of the player's house, and the baseline it drifts back to. */
    opinion: number;
    /** The trait a son or daughter of this house brings when marrying in. */
    spouse_trait: string;
  }[];
  /** First names for heirs born to the houses during the run. */
  heir_names: string[];
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
  /** A borrower defaulted on the house within this many quarters (the current one included). */
  default_within_quarters?: number;
  /** The player's house is not allied by marriage to this house (or the house has failed). */
  house_not_allied?: string;
  /** A house still trading whose opinion of the player is at least `at_least` and below `below` (either may be left out). */
  house_opinion?: { house: string; at_least?: number; below?: number };
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
  | { kind: "heir_talent"; gain: number }
  /** One living heir, picked at random among those who could still gain it, gains the trait. */
  | { kind: "heir_trait"; trait: string }
  /** One house's opinion of the player changes by `delta`. */
  | { kind: "opinion"; house: string; delta: number }
  /** Fires the follow-up event `event` at the end of a quarter picked at random within `within_quarters`, if its conditions hold then. */
  | { kind: "follow_up"; event: string; within_quarters: number };

/** A chance outcome of a letter's response: with probability `p`, `effects` also apply. Settled at End Turn. */
export interface EventChance {
  p: number;
  effects: EventEffect[];
  /** News when the chance comes up. */
  text: string;
  /** News when it does not. Optional. */
  miss_text?: string;
}

/** One response to a letter. */
export interface EventOption {
  id: string;
  /** Short words on the response card, such as "Prosecute in open court". */
  label: string;
  /** What happens, in the news once the quarter ends. */
  text: string;
  effects: EventEffect[];
  chance?: EventChance;
}

/** One record in data/events.json. Historical events fire once at their date; random ones by weight; follow-ups when scheduled. */
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
  /** Fired now. May be empty for news-only events. */
  effects: EventEffect[];
  /** Fires only when another event's follow_up effect schedules it: never by date or weight. */
  follow_up?: boolean;
  /** Responses: the event also leaves a letter on the desk, answered next quarter (2 to 3 responses). */
  options?: EventOption[];
  /** Id of the response taken when a letter goes unanswered. It must cost nothing. */
  default_option?: string;
}

/** data/family.json: the house's starting family. Names are invented. */
export type Gender = "m" | "f";

export interface FamilyData {
  head: { name: string; gender: Gender; birth_year: number; acumen: number; prudence: number; connections: number; traits: string[] };
  /** The head's wife at the start, the children's mother. `born` is her maiden name. */
  head_spouse: { name: string; born: string; gender: Gender; birth_year: number; acumen: number; prudence: number; connections: number; traits: string[] };
  children: { name: string; gender: Gender; birth_year: number }[];
  surname: string;
  /** Takes over if the head dies with no heir left. */
  cousin: { name: string; gender: Gender; age: number; traits: string[] };
  /** First names for children born during the game, by gender, used in turn. */
  child_names: Record<Gender, string[]>;
  /** First names for spouses from outside the houses' own families. */
  spouse_names: Record<Gender, string[]>;
}

/**
 * What a trait does. Stat effects add to the person's stats (within 1 to 10). The rest multiply:
 * the chance of death, venture failure risk, withdrawals, family spending and reputation gains.
 * Only the head's traits act on the business.
 */
export interface TraitEffects {
  acumen?: number;
  prudence?: number;
  connections?: number;
  death_chance?: number;
  venture_failure?: number;
  withdrawals?: number;
  family_cost?: number;
  reputation_gain?: number;
}

/** One record of data/traits.json. Descriptions are invented. */
export interface TraitType {
  id: string;
  name: string;
  description: string;
  /** A trait a person can never hold together with this one. */
  opposite?: string;
  /** The virtue an heir gains at 18 when this stat has reached virtue_stat. */
  virtue_for?: "acumen" | "prudence" | "connections";
  effects: TraitEffects;
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
