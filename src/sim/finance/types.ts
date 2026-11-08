// Types for high finance (milestone A5): state loan contracts, lending to other houses, bankruptcy
// auctions and insurance. Numbers live in data/finance.json.
import type { Temperament } from "../tuning";
import type { Sentiment } from "../types";

/** [low, high]. */
type Range = number[];
type ByMood = Record<Sentiment, number>;

/** data/finance.json */
export interface FinanceData {
  contracts: {
    /** Chance a quarter that each state announces a loan, before era and mood factors. */
    announce_chance: number;
    eras: { from: number; to: number; factor: number; why: string }[];
    mood_factor: ByMood;
    /** Size range per state id, whole gulden. */
    sizes: Record<string, Range>;
    size_step: number;
    /** Added to the state's coupon, drawn in this range and rounded to 0.25%. */
    coupon_premium: Range;
    terms: number[];
    /** Added to the state's min_reputation for a contract. */
    reputation_premium: number;
    /** Caution money: this share of the size, paid at the award and returned at the close. */
    caution: number;
    /** Commissions the house may ask. */
    commissions: number[];
    /** Commission a state gives up for every 100 points of reputation above 50. */
    prestige_weight: number;
    placement: {
      quarters: number;
      base: ByMood;
      reputation_floor: number;
      reputation_slope: number;
      risk_drag: number;
      per_correspondent: number;
      noise: number;
      max: number;
    };
    prestige: { good_share: number; good: number; big_size: number; big: number; stuck_share: number; stuck: number };
    rivals: {
      wealth_cover: number;
      bid_chance: Record<Temperament, number>;
      commission: Record<Temperament, Range>;
      reputation_gain: number;
    };
  };
  house_loans: {
    base_chance: number;
    distress_scale: number;
    mood_floor: ByMood;
    temperament_factor: Record<Temperament, number>;
    min_opinion: number;
    share_of_wealth: number;
    min_amount: number;
    term_quarters: number;
    max_rate: { base: number; urgency: number; dislike: number };
    urgency: ByMood;
    min_rate: number;
    gratitude: { up_to: number; opinion: number }[];
    repaid_opinion: number;
    rescue_factor: number;
    recovery: ByMood;
  };
  auctions: {
    bids: number[];
    rival_wealth_cover: number;
    rival_bid_chance: number;
    rival_bid: ByMood;
    rival_noise: number;
    collateral_share: number;
    min_appraisal: number;
    ship_trades: string[];
    house_lots: { kind: LotKind; name: string; share: number }[];
    assets: Record<AssetKind, { yield: number; loss_chance: number; mood_income: boolean }>;
    mood_income: ByMood;
    winter_quarters: number[];
    winter_factor: number;
    broker_place_reputation: number;
    sale_discount: number;
  };
  insurance: {
    requests_per_quarter: number;
    ship_weight: number;
    ship: { value: Range; quarters: number; loss_chance: number; salvage: Range };
    warehouse: { value: Range; quarters: number; loss_chance: number; damage: Range };
    value_step: number;
    load: number;
    lines: number[];
    storm: { chance: number; winter_chance: number; ship_factor: number };
    cities: string[];
    ship_names: string[];
    great_fires: { year: number; quarter: number; city: string; chance: number; title: string; text: string }[];
  };
}

/** A state's loan, from its announcement to its close. */
export interface Contract {
  id: number;
  /** Id from data/states.json. */
  state: string;
  size: number;
  coupon: number;
  term_years: number;
  /** The quarter houses may bid; the award comes at its End Turn. */
  open_turn: number;
  /** "open" for bids; "placing" after the player won; "closed" when placing ended; "lost" to another house; "unawarded" when no one bid. */
  status: "open" | "placing" | "closed" | "lost" | "unawarded";
  /** The player's bid commission, or null. */
  player_bid: number | null;
  /** "player", another house's id, or null. */
  winner: string | null;
  /** The winning commission. */
  commission: number | null;
  /** Price per gulden of face at which investors subscribe (the market price at the award). */
  issue_price: number | null;
  /** Face value placed with investors so far. */
  placed: number;
  /** Placement quarters done. */
  quarters_placed: number;
  /** Caution money the state holds, whole gulden. */
  caution: number;
  /** Face value the house carried at the close. */
  carried: number;
}

/** Bonds carried from a contract, redeemed at par when the loan's term ends. */
export interface Redemption {
  bond: number;
  turn: number;
}

/** A house in trouble asks for credit. Open for one quarter. */
export interface HouseRequest {
  id: number;
  house: string;
  amount: number;
  /** The most it can pay a year. */
  max_rate: number;
  term_quarters: number;
  open_turn: number;
}

export interface HouseLoan {
  id: number;
  house: string;
  principal: number;
  rate: number;
  start_turn: number;
  due_turn: number;
  status: "active" | "repaid" | "failed" | "sold";
}

export type AssetKind = "warehouse" | "ship" | "broker_place";
export type LotKind = AssetKind | "shares";

/** One lot from a failed house or a defaulted borrower. Open for one quarter. */
export interface Lot {
  id: number;
  kind: LotKind;
  name: string;
  /** What the receivers value it at, whole gulden. */
  appraisal: number;
  /** Who failed. */
  source: string;
  /** Shares lots: the company and the number of shares. */
  company?: string;
  shares?: number;
  open_turn: number;
  /** The player's bid as a share of the appraisal, or null. */
  player_bid: number | null;
}

/** A warehouse, a ship or a broker's place the house owns. Counted at its appraisal. */
export interface Asset {
  id: number;
  kind: AssetKind;
  name: string;
  appraisal: number;
  paid: number;
  bought_turn: number;
}

/** A merchant asks for cover. Open for one quarter. */
export interface CoverRequest {
  id: number;
  kind: "ship" | "warehouse";
  insured: string;
  /** The ship's name, or the warehouse's city. */
  what: string;
  value: number;
  quarters: number;
  /** Premium for the whole term, as a share of the value. */
  premium_rate: number;
  open_turn: number;
}

export interface Policy {
  id: number;
  kind: "ship" | "warehouse";
  insured: string;
  what: string;
  /** The house's share of the value, whole gulden. */
  value: number;
  line: number;
  premium: number;
  start_turn: number;
  /** The last quarter covered. */
  end_turn: number;
  status: "active" | "expired" | "claimed";
}

/** state.finance */
export interface FinanceState {
  /** Mulberry32 state of finance's own random stream. */
  rng_state: number;
  next_id: number;
  contracts: Contract[];
  redemptions: Redemption[];
  house_requests: HouseRequest[];
  house_loans: HouseLoan[];
  lots: Lot[];
  assets: Asset[];
  cover_requests: CoverRequest[];
  policies: Policy[];
  /** Defaulted loans whose collateral has gone to auction (or had none). */
  seen_defaults: number[];
  /** The last turn a great storm blew, or null. */
  storm_turn: number | null;
}

export interface BidContractDecision {
  kind: "bid_contract";
  contract: number;
  commission: number;
}
export interface LendHouseDecision {
  kind: "lend_house";
  request: number;
  rate: number;
}
export interface BidLotDecision {
  kind: "bid_lot";
  lot: number;
  /** Share of the appraisal. */
  bid: number;
}
export interface SellAssetDecision {
  kind: "sell_asset";
  asset: number;
}
export interface UnderwriteDecision {
  kind: "underwrite";
  request: number;
  /** Share of the value the house takes. */
  line: number;
}

export type FinanceDecision = BidContractDecision | LendHouseDecision | BidLotDecision | SellAssetDecision | UnderwriteDecision;
export const FINANCE_KINDS = ["bid_contract", "lend_house", "bid_lot", "sell_asset", "underwrite"] as const;

export type FinanceCategory =
  | "contract_caution"
  | "contract_fee"
  | "contract_carry"
  | "contract_redemption"
  | "house_loan_out"
  | "house_loan_interest"
  | "house_loan_repaid"
  | "house_loan_recovery"
  | "house_loan_loss"
  | "auction_purchase"
  | "asset_revaluation"
  | "asset_income"
  | "asset_lost"
  | "asset_sale"
  | "premium"
  | "claim";

export type FinanceAccount = "house_loans" | "assets" | "caution";
