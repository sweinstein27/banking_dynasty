// Types for the markets system (milestone A3): data/markets.json and state.markets.
import type { Quarter, Sentiment } from "../types";

/** Price shocks: temporary multipliers that fade back to 1, and permanent level changes. */
export interface MarketShock {
  /** Every listed company's price. */
  shares?: number;
  /** Companies of one sector, on top of `shares`. */
  sectors?: Record<string, number>;
  /** Temporary multipliers on a commodity's target price. */
  commodities?: Record<string, number>;
  /** Permanent multipliers on a commodity's base price (the Zollverein, railway building). */
  levels?: Record<string, number>;
}

export interface CommodityType {
  id: string;
  name: string;
  /** Unit of trade, singular ("Malter"). */
  unit: string;
  /** Gulden per unit in a fair year. */
  base_price: number;
  /** Warehouse space one unit takes. */
  space: number;
  /** Gulden per unit held per quarter: handling, insurance. */
  storage: number;
  /** Share of units lost each quarter (grain rots, wine leaks). */
  spoilage: number;
  /** Half-width of the quarterly random move in log price. */
  volatility: number;
  /** Share of the gap to the target closed each quarter. */
  reversion: number;
  /** Price never leaves [min, max] times the base price (before levels). */
  bounds: { min: number; max: number };
  /** Target price moves with the harvest of these regions: target *= index ^ -elasticity. */
  harvest?: { regions: string[]; elasticity: number };
  /** Lift to the target in the Frankfurt fair quarters, before the fairs fade. */
  fair_lift?: number;
}

export interface SectorType {
  id: string;
  name: string;
  /** Dividend yield investors require in a calm market. */
  required_yield: number;
  /** Added to the required yield in each mood. */
  mood_premium: Record<Sentiment, number>;
  /** Earnings multiplier in each mood. */
  mood_earnings: Record<Sentiment, number>;
  /** Half-width of the additive quarterly earnings noise, as a share of normal earnings. */
  earnings_noise: number;
  /** Half-width of the quarterly random move in price. */
  price_noise: number;
  /** Yearly earnings growth while listed, up to growth_cap times the start. */
  growth: number;
  growth_cap: number;
  /** Earnings follow the harvest (index ^ elasticity) or a commodity's price against its base. */
  driver?: { harvest?: number; commodity?: string; elasticity?: number };
  /** Chance a quarter that a company with a trailing loss fails, before the mood multiplier. */
  failure: number;
}

export interface CompanyType {
  id: string;
  name: string;
  sector: string;
  /** Appears on the bourse in this quarter. */
  list_year: number;
  list_quarter: Quarter;
  shares: number;
  /** Gulden per share at issue. */
  par: number;
  /** Yearly earnings on capital at par in a calm market. */
  base_yield: number;
  /** Share of earnings paid out as dividends. */
  payout: number;
  description: string;
}

export interface HarvestOutcome {
  id: string;
  name: string;
  /** Output against a fair year. */
  index: number;
  weight: number;
}

export interface RegionType {
  id: string;
  name: string;
  /** Weight in the grain-price harvest index. */
  weight: number;
}

/** News that only the markets react to, for the quarter it describes. */
export interface MarketNews {
  id: string;
  year: number;
  quarter: Quarter;
  title: string;
  text: string;
  shock: MarketShock;
}

export interface ReportTier {
  name: string;
  /** Half-width of the earnings estimate, as a share of true earnings. */
  width: number;
  cost: number;
  /** Quarters the report stays current (0 for bourse talk, which never lapses). */
  quarters: number;
}

/** data/markets.json */
export interface MarketsData {
  commodities: CommodityType[];
  sectors: SectorType[];
  companies: CompanyType[];
  regions: RegionType[];
  harvest: {
    outcomes: HarvestOutcome[];
    /** Chance a region's harvest follows the shared weather of the year instead of its own. */
    shared_weather: number;
    /** Harvests fixed by history: year to region id (or "all") to outcome id. */
    historic: Record<string, Record<string, string>>;
  };
  /** Borrowers' trades hurt by a bad harvest: default chance *= index ^ -elasticity, capped. */
  trades: Record<string, { regions: string[]; elasticity: number }>;
  trade_factor_cap: number;
  fairs: { quarters: Quarter[]; fade_from: number; fade_to: number; floor: number };
  /** Shocks when an event from data/events.json fires, by event id. */
  event_shocks: Record<string, MarketShock>;
  news: MarketNews[];
  /** Share of a temporary shock that fades each quarter. */
  shock_decay: number;
  prices: {
    /** Share of the gap between price and fair value closed each quarter. */
    speed: number;
    /** A share's price stays within [min, max] times its fair value. */
    bounds: { min: number; max: number };
    /** Fair value of a company with no dividend, as a share of par. */
    distress_value: number;
    min_price: number;
  };
  warehouse: { default_space: number };
  reports: ReportTier[];
  /** Broker's commission on each trade, as a share of its value. */
  commission: { shares: number; commodities: number };
}

export type CompanyStatus = "upcoming" | "listed" | "failed";

/** A company of the bourse: from data, or floated from one of the house's ventures. */
export interface Company {
  id: string;
  name: string;
  sector: string;
  status: CompanyStatus;
  /** Turn it listed, or null while upcoming. */
  listed_turn: number | null;
  shares: number;
  par: number;
  base_yield: number;
  payout: number;
  /** Price per share at the last mark. */
  price: number;
  /** Total earnings of the last four quarters, oldest first. */
  earnings: number[];
  /** Dividend per share paid at the last year end. */
  last_dividend: number;
  /** Temporary price shock (1 when none), fading each quarter. */
  shock: number;
  /** Capital that earns, when less than shares * par (a great work still opening its sections). Null means all of it. */
  earning_capital: number | null;
  /** Fixed draw in [-1, 1] placing the estimate of earnings around the truth. */
  estimate_noise: number;
  /** Report tier bought (0 is bourse talk) and the turn it lapses. */
  report_tier: number;
  report_until: number;
  /** The venture it was floated from, or null. */
  venture: number | null;
}

export interface CommodityMarket {
  price: number;
  /** Temporary shock on the target (1 when none). */
  shock: number;
  /** Permanent level on the base price. */
  level: number;
}

/** state.markets */
export interface MarketsState {
  /** Mulberry32 state of the markets' own random stream (seeded from the run's RNG at the start). */
  rng_state: number;
  companies: Company[];
  commodities: Record<string, CommodityMarket>;
  /** This year's harvest outcome id per region (from the Q3 roll; a fair year at the start). */
  harvest: Record<string, string>;
  /** Shares held, by company id. */
  shares: Record<string, number>;
  /** Units held, by commodity id. */
  goods: Record<string, number>;
}

export interface BuySharesDecision {
  kind: "buy_shares";
  company: string;
  shares: number;
}
export interface SellSharesDecision {
  kind: "sell_shares";
  company: string;
  shares: number;
}
export interface BuyCommodityDecision {
  kind: "buy_commodity";
  commodity: string;
  units: number;
}
export interface SellCommodityDecision {
  kind: "sell_commodity";
  commodity: string;
  units: number;
}
/** Buy a better look at a company's books: tier 1 (a report) or 2 (a full inquiry). */
export interface CompanyReportDecision {
  kind: "company_report";
  company: string;
  tier: number;
}
/** Sell an unlisted venture stake privately, at a heavy discount. */
export interface SellVentureDecision {
  kind: "sell_venture";
  venture: number;
}

export type MarketsDecision = BuySharesDecision | SellSharesDecision | BuyCommodityDecision | SellCommodityDecision | CompanyReportDecision | SellVentureDecision;

export const MARKETS_KINDS = ["buy_shares", "sell_shares", "buy_commodity", "sell_commodity", "company_report", "sell_venture"] as const;

export type MarketsCategory =
  | "share_purchase"
  | "share_sale"
  | "dividend"
  | "commodity_purchase"
  | "commodity_sale"
  | "storage"
  | "spoilage"
  | "market_revaluation"
  | "venture_call"
  | "venture_dividend"
  | "venture_listing"
  | "venture_sale"
  | "venture_forfeit"
  | "company_failure"
  | "company_report";

export type MarketsAccount = "shares" | "commodities";
