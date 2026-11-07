// Types for Europe (milestone C1): cities and the courier roads between them, their moods and
// troubles, currencies and the Frankfurt exchange, branches run by family members, and bills of
// exchange. Data comes from data/europe.json; the state lives in state.europe.
import type { Sentiment } from "../types";

export interface QuarterDate {
  year: number;
  quarter: 1 | 2 | 3 | 4;
}

/** A city's political state. Unrest and war last `left` quarters, or until a roll ends them. */
export type CityStatus = "peace" | "unrest" | "war";

export interface CurrencyData {
  id: string;
  name: string;
  /** Gulden per unit at par (metal content; see docs/notes/C1-europe.md). */
  par: number;
  /** Uniform noise on the rate's deviation from par each quarter (0.006 is up to 0.6% either way). */
  noise: number;
  /** The deviation from par never goes beyond this in either direction (the specie points). */
  band: number;
  /** A fixed parity from this date (the thaler under the Dresden Convention): the rate holds within `band`, and city shocks no longer move it. */
  fixed_from?: QuarterDate & { band: number };
}

export interface CityData {
  id: string;
  name: string;
  /** Degrees, for the map. */
  lat: number;
  lon: number;
  currency: string;
  /** The state in data/states.json the city belongs to, if any. */
  state: string | null;
  /** The local interest rate a year. */
  rate: number;
  /** Scales the chance the city's mood worsens (1 is ordinary). */
  volatility: number;
  /** Chance a quarter of unrest breaking out in peace. */
  unrest_chance: number;
  /** A branch may open from this date, with at least this reputation. */
  opens: QuarterDate;
  min_reputation: number;
  /** One-off cost of opening a branch, fl. */
  setup: number;
  /** A branch's upkeep a quarter, fl. */
  upkeep: number;
}

export interface LinkData {
  from: string;
  to: string;
  /** Days by the ordinary post. */
  days: number;
}

export type HappeningKind = "panic" | "uneasy" | "calm" | "unrest" | "war" | "peace" | "disaster" | "suspension";

/** A dated happening abroad. It shapes the city for the quarter it is dated (it fires at the End Turn before, like events). */
export interface HistoryData extends QuarterDate {
  id: string;
  city: string;
  kind: HappeningKind;
  /** Quarters an unrest or war lasts before rolls may end it. */
  quarters?: number;
  /** Extra currency shock (a share off its rate), on top of the kind's own. */
  shock?: number;
  /** Share of a branch's capital lost (a fire, say). */
  loss?: number;
  title: string;
  text: string;
}

/** What a branch head's trait changes (missing fields change nothing). */
export interface BranchTraitEffect {
  lend_share?: number;
  defaults?: number;
  bills?: number;
  deposits?: number;
  close?: number;
}

type ByMood = Record<Sentiment, number>;

export interface EuropeData {
  home: string;
  quarter_days: number;
  currencies: CurrencyData[];
  cities: CityData[];
  links: LinkData[];
  delay: {
    /** Delay factor with a courier stable. */
    courier_stable: number;
    /** Delay factor from a city where the house has a branch. */
    branch: number;
    /** Each correspondent cuts the delay by this share, up to max_correspondent_cut. */
    per_correspondent: number;
    max_correspondent_cut: number;
  };
  moods: {
    /** Chances a quarter of moving between moods, as in tuning.sentiment.transitions. Worsening ones are scaled by the city's volatility. */
    transitions: Record<Sentiment, Partial<Record<Sentiment, number>>>;
    /** Chance a quarter that unrest (or a war) whose quarters have run out ends. */
    unrest_ends: number;
    war_ends: number;
  };
  rates: {
    /** Share of last quarter's deviation from par that remains. */
    revert: number;
    /** Currency shocks: a share off the rate. Panic draws between the two values. */
    panic: { low: number; high: number };
    unrest: number;
    war: number;
    suspension: number;
    /** Share of a shock left each quarter. */
    fade: number;
  };
  branch: {
    min_capital: number;
    /** Deposits move toward capital x deposit_multiple x (0.5 + connections/10) x reputation/50, by this share a quarter. */
    deposit_multiple: number;
    deposit_catch_up: number;
    lend_share: number;
    /** Branch loans earn the local rate plus this; depositors get the local rate less deposit_margin. */
    loan_margin: number;
    deposit_margin: number;
    /** Bill trading earns capital x bill_yield x (0.5 + acumen/10) a quarter. */
    bill_yield: number;
    /** Share of the loan book lost a quarter, by mood; times war_defaults at war. Scaled by (1.5 - prudence/10). */
    defaults: ByMood;
    war_defaults: number;
    /** Share of deposits withdrawn in a panic. */
    panic_withdrawal: number;
    /** Exchange cost of sending or recalling capital (a share of the amount). */
    transfer_spread: number;
    /** Chance a quarter a branch is forced to close, by trouble; scaled by (1.4 - prudence/10). */
    close: { war: number; unrest: number; panic: number };
    /** Share of the branch's capital lost when forced to close. */
    close_loss: { war: number; unrest: number; panic: number };
    /** Without a head: bill income and defaults scaled by these. */
    headless: { bills: number; defaults: number };
    traits: Record<string, BranchTraitEffect>;
  };
  bills: {
    /** The house's margin on top of the local discount, a share of face. */
    spread: number;
    /** Chance the payer fails, by the city's true mood. */
    defaults: ByMood;
    /** Share recovered from a failed payer. */
    recovery: number;
    /** Bills on one city the house may hold, fl, plus the capital of its branch there. */
    limit: number;
  };
  history: HistoryData[];
  /** Text for random happenings: {city} is replaced. */
  texts: Record<"uneasy" | "panic" | "calm" | "unrest" | "war" | "peace", { title: string; text: string }>;
}

/** What the house knows of a city: as of the latest news to reach Frankfurt. */
export interface CityView {
  mood: Sentiment;
  status: CityStatus;
  /** The currency shock as known (1 is none). */
  shock: number;
  /** The turn whose dispatch this view comes from. */
  as_of: number;
}

export interface CityState {
  id: string;
  mood: Sentiment;
  status: CityStatus;
  /** Quarters of unrest or war left before rolls may end it. */
  status_left: number;
  known: CityView;
}

export interface CurrencyState {
  /** Deviation from par, shared knowledge (the course of exchange travels with every post). */
  dev: number;
  /** Shock factor on the rate (1 is none, 0.9 is 10% cheaper). */
  shock: number;
}

/** A dispatch on its way to Frankfurt: the city as it stood, and any news. */
export interface Mail {
  city: string;
  /** The turn it was written. */
  sent: number;
  /** The first turn the house knows it, at the start of that quarter. */
  arrives: number;
  view: CityView;
  news: { title: string; text: string }[];
}

export interface Branch {
  city: string;
  /** Person id of the family member at its head, or null while it has none. */
  head: number | null;
  opened_turn: number;
  /** In the city's currency. */
  capital: number;
  deposits: number;
  /** Book value at home, whole gulden (what the "branches" ledger account holds for it). */
  book: number;
  /** Last quarter's result in local currency, for the reports. */
  last_profit: number;
}

export interface Bill {
  id: number;
  city: string;
  /** Face in the city's currency. */
  face: number;
  /** Gulden paid, the bill's book value. */
  cost: number;
  bought_turn: number;
  /** Paid at the End Turn of this turn. */
  due_turn: number;
}

export interface EuropeState {
  rng_state: number;
  cities: CityState[];
  currencies: Record<string, CurrencyState>;
  branches: Branch[];
  bills: Bill[];
  next_bill_id: number;
  mail: Mail[];
  fired: string[];
}

export interface OpenBranchDecision {
  kind: "open_branch";
  city: string;
  head: number;
  /** Gulden sent as the branch's capital. */
  capital: number;
}

export interface FundBranchDecision {
  kind: "fund_branch";
  city: string;
  /** Gulden: positive sends capital, negative recalls it. */
  amount: number;
}

export interface AppointBranchHeadDecision {
  kind: "appoint_branch_head";
  city: string;
  head: number;
}

export interface CloseBranchDecision {
  kind: "close_branch";
  city: string;
}

export interface BuyBillDecision {
  kind: "buy_bill";
  city: string;
  /** Gulden paid. */
  amount: number;
}

export type EuropeDecision = OpenBranchDecision | FundBranchDecision | AppointBranchHeadDecision | CloseBranchDecision | BuyBillDecision;
export const EUROPE_KINDS = ["open_branch", "fund_branch", "appoint_branch_head", "close_branch", "buy_bill"] as const;

export type EuropeCategory =
  | "branch_opening"
  | "branch_capital"
  | "branch_profit"
  | "branch_loss"
  | "branch_closed"
  | "exchange"
  | "bill_purchase"
  | "bill_paid"
  | "bill_default";

export type EuropeAccount = "branches" | "bills";
