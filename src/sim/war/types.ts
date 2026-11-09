// Types for war and revolution (milestone C3): historical campaigns in dated phases, the war loans
// states ask of Frankfurt houses, unrest pressure in every city, and Frankfurt's own troubles.
// Data comes from data/war.json; the state lives in state.war.
import type { MarketShock } from "../markets/types";
import type { CityStatus, QuarterDate } from "../europe/types";

/** Where a campaign stands. "before" until its first dated phase, "over" after its peace. */
export type Phase = "mobilizing" | "fighting" | "settling";
export type CampaignStage = "before" | Phase | "over";

/** A dated turn in a campaign: from this quarter it is in `stage` ("peace" ends it). */
export interface TimelineData extends QuarterDate {
  stage: Phase | "peace";
  title: string;
  text: string;
}

/** A war loan a borrower asks of the Frankfurt houses while its campaign is in one of `phases`. */
export interface OfferData {
  id: string;
  /** A state id from data/states.json, or a lender id from `borrowers` in data/war.json. */
  borrower: string;
  phases: Phase[];
  /** Interest a year. */
  rate: number;
  term_quarters: number;
  /** The most the house may lend on this offer, fl. */
  max: number;
  /** Chance the borrower fails to repay at the end of the term, before its fortunes. */
  default_chance: number;
  /** Share recovered when it fails. */
  recovery: number;
  /** Reputation lost on first lending: the loan pays to put down a rising. */
  repression?: number;
  text: string;
}

/** A borrower that is not a state in data/states.json (the Central Power of 1848). */
export interface BorrowerData {
  id: string;
  name: string;
  min_reputation: number;
}

export interface CampaignData {
  id: string;
  name: string;
  /** States (data/states.json) at war: their risk moves with the campaign and its fortunes. */
  states: string[];
  timeline: TimelineData[];
  /** Risk added to each state at war, by phase. */
  risk: Partial<Record<Phase, number>>;
  /** Factor on every loan's default chance (trade cut off), by phase. */
  trade?: Partial<Record<Phase, number>>;
  /** Price shocks applied once when a phase begins (or at peace). */
  shocks?: Partial<Record<Phase | "peace", MarketShock>>;
  /** Risk a state keeps after the peace (an indemnity, a lost province). */
  residual?: Record<string, number>;
  offers: OfferData[];
}

/** A dated trouble in Frankfurt itself. */
export interface HomeData extends QuarterDate {
  id: string;
  kind: CityStatus | "news";
  quarters?: number;
  /** Pressure let out in Frankfurt. */
  release?: number;
  title: string;
  text: string;
}

export interface CurvePoint {
  year: number;
  level: number;
}

export interface WarData {
  borrowers: BorrowerData[];
  campaigns: CampaignData[];
  fortune: {
    /** Risk a state gains (bad news) or loses (good news) per fighting quarter, at most. */
    swing: number;
    /** Chance the quarter's news is bad for a state. */
    bad: number;
    /** Fortunes never pass this many steps either way. */
    cap: number;
    /** Each step of bad fortune raises a war loan's default chance by this share. */
    default_weight: number;
  };
  pressure: {
    /** The level pressure drifts toward, by year (straight lines between points). */
    curve: CurvePoint[];
    /** Per city: the curve is multiplied by this (1 if missing). */
    scale: Record<string, number>;
    /** Share of the gap to the target closed each quarter. */
    speed: number;
    /** Uniform noise each quarter, points either way. */
    noise: number;
    /** Points per 100% that grain stands above its base price. */
    grain: number;
    /** Points added while the city is in a panic. */
    panic: number;
    /** Points let out each quarter the city is in unrest or at war. */
    release: number;
    /** News as pressure rises through these levels. */
    warn: number[];
    /** Random unrest abroad is multiplied by 1 + pressure / unrest_scale. */
    unrest_scale: number;
    /** Risk a city's state gains at pressure 100 (straight line from 0). */
    state_risk: number;
    /** Frankfurt: above `from`, random unrest with a chance rising to `chance` at 100. */
    home: { from: number; chance: number };
  };
  /** Factor on every loan's default chance while Frankfurt is in unrest or at war. */
  home_trade: Record<"unrest" | "war", number>;
  /** Hooks for the integrator: finance announces this many times as often from a state at war, and its bond price is cut by this share, by phase. */
  hooks: { contract_factor: Partial<Record<Phase, number>>; bond_discount: Partial<Record<Phase, number>> };
  home: HomeData[];
  texts: {
    /** News as pressure rises through each `warn` level: {city} is replaced. */
    warn: { title: string; text: string }[];
    home_unrest: { title: string; text: string };
    home_peace: { title: string; text: string };
    fortune_good: string;
    fortune_bad: string;
  };
}

export type WarLoanStatus = "active" | "repaid" | "defaulted" | "sold";

export interface WarLoan {
  id: number;
  campaign: string;
  offer: string;
  borrower: string;
  principal: number;
  rate: number;
  start_turn: number;
  /** Repaid (or failed) at the End Turn of this turn. */
  due_turn: number;
  status: WarLoanStatus;
}

export interface CampaignState {
  stage: CampaignStage;
  /** Steps of bad (positive) or good (negative) fortune per state at war. */
  fortune: Record<string, number>;
}

export interface WarState {
  rng_state: number;
  campaigns: Record<string, CampaignState>;
  /** What this system has added to state.risk_shift per state, and its factor on state.trade_risk, so both can be taken back. */
  applied: { risk: Record<string, number>; trade: number };
  loans: WarLoan[];
  next_id: number;
  /** Unrest pressure, 0 to 100, per city id (Frankfurt included). */
  pressure: Record<string, number>;
  /** The highest warning level reported per city. */
  warned: Record<string, number>;
  /** Frankfurt happenings that have fired. */
  fired: string[];
  /** Offers the house has lent on (repression costs reputation once). */
  lent_on: string[];
}

export interface SubscribeWarLoanDecision {
  kind: "subscribe_war_loan";
  /** Offer id. */
  offer: string;
  amount: number;
}

export type WarDecision = SubscribeWarLoanDecision;
export const WAR_KINDS = ["subscribe_war_loan"] as const;

export type WarCategory = "war_loan" | "war_interest" | "war_repaid" | "war_default";
export type WarAccount = "war_loans";
