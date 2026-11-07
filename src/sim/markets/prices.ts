// The markets' price model: harvests, commodity prices, company earnings, dividends and share
// prices. Pure functions of their arguments; random draws come in as numbers or an Rng.
import type { Rng } from "../rng";
import type { GameData } from "../tuning";
import type { GameState, Quarter, Sentiment } from "../types";
import type { CommodityType, Company, CompanyType, HarvestOutcome, MarketShock, MarketsData, MarketsState, SectorType } from "./types";

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
/** A uniform draw in [-1, 1). */
export const spread = (rng: Rng) => 2 * rng.next() - 1;

export function sectorOf(data: MarketsData, id: string): SectorType {
  const s = data.sectors.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown sector "${id}"`);
  return s;
}

export function commodityType(data: MarketsData, id: string): CommodityType | undefined {
  return data.commodities.find((c) => c.id === id);
}

/** The year and quarter after this one. */
export function nextQuarter(year: number, quarter: Quarter): { year: number; quarter: Quarter } {
  return quarter === 4 ? { year: year + 1, quarter: 1 } : { year, quarter: (quarter + 1) as Quarter };
}

// Harvests ------------------------------------------------------------------------------------

export function outcome(data: MarketsData, id: string): HarvestOutcome {
  return data.harvest.outcomes.find((o) => o.id === id) ?? data.harvest.outcomes.find((o) => o.id === "fair")!;
}

/** The outcome whose cumulative weight first exceeds `u` (in [0, 1)). */
export function pickOutcome(data: MarketsData, u: number): HarvestOutcome {
  const total = sum(data.harvest.outcomes.map((o) => o.weight));
  let acc = 0;
  for (const o of data.harvest.outcomes) {
    acc += o.weight / total;
    if (u < acc) return o;
  }
  return data.harvest.outcomes[data.harvest.outcomes.length - 1]!;
}

/**
 * The year's harvest per region. Always draws 1 + 2 per region numbers, in region order, so a
 * historic year does not shift the stream: a shared weather draw, then for each region whether it
 * follows the shared weather and its own draw. History overrides the roll.
 */
export function rollHarvest(data: MarketsData, year: number, rng: Rng): Record<string, string> {
  const shared = rng.next();
  const fixed = data.harvest.historic[String(year)] ?? {};
  const out: Record<string, string> = {};
  for (const r of data.regions) {
    const follows = rng.next() < data.harvest.shared_weather;
    const own = rng.next();
    out[r.id] = fixed[r.id] ?? fixed.all ?? pickOutcome(data, follows ? shared : own).id;
  }
  return out;
}

/** Output index of these regions against a fair year, weighted by region. */
export function harvestIndex(harvest: Record<string, string>, regions: string[], data: MarketsData): number {
  const rs = data.regions.filter((r) => regions.includes(r.id));
  const w = sum(rs.map((r) => r.weight));
  if (!w) return 1;
  return sum(rs.map((r) => r.weight * outcome(data, harvest[r.id] ?? "fair").index)) / w;
}

/**
 * Multiplier on a borrower's default chance from this year's harvest, by trade: a bad harvest
 * hurts grain dealers, wine importers and river freight. 1 for other trades. Capped.
 */
export function tradeFactor(state: GameState, trade: string, data: GameData): number {
  const m = data.markets;
  const t = m.trades[trade];
  if (!t || !state.markets.harvest) return 1;
  const idx = harvestIndex(state.markets.harvest, t.regions, m);
  return clamp(idx ** -t.elasticity, 1 / m.trade_factor_cap, m.trade_factor_cap);
}

// Commodities ---------------------------------------------------------------------------------

/** How strong the Frankfurt fairs still are: 1 before fade_from, falling to `floor` by fade_to. */
export function fairStrength(year: number, data: MarketsData): number {
  const f = data.fairs;
  if (year <= f.fade_from) return 1;
  if (year >= f.fade_to) return f.floor;
  return 1 - ((1 - f.floor) * (year - f.fade_from)) / (f.fade_to - f.fade_from);
}

/** Where a commodity's price is heading for the quarter (year, quarter). */
export function commodityTarget(type: CommodityType, m: MarketsState, year: number, quarter: Quarter, data: MarketsData): number {
  const mk = m.commodities[type.id]!;
  let target = type.base_price * mk.level * mk.shock;
  if (type.harvest) target *= harvestIndex(m.harvest, type.harvest.regions, data) ** -type.harvest.elasticity;
  if (type.fair_lift && data.fairs.quarters.includes(quarter)) target *= 1 + type.fair_lift * fairStrength(year, data);
  return target;
}

/** The price bounds for a commodity at its current level. */
export function commodityBounds(type: CommodityType, level: number): [number, number] {
  return [type.base_price * level * type.bounds.min, type.base_price * level * type.bounds.max];
}

/**
 * Next price: log price closes `reversion` of the gap to the target, plus a move of up to
 * +/- volatility (u in [-1, 1)), kept within the bounds. Rounded to 2 decimals.
 */
export function nextCommodityPrice(price: number, target: number, u: number, type: CommodityType, level: number): number {
  const logP = Math.log(price) + type.reversion * (Math.log(target) - Math.log(price)) + type.volatility * u;
  const [lo, hi] = commodityBounds(type, level);
  return round2(clamp(Math.exp(logP), lo, hi));
}

// Companies -----------------------------------------------------------------------------------

/** Dividend yield investors want from a sector in this mood. */
export function requiredYield(sector: SectorType, sentiment: Sentiment): number {
  return sector.required_yield + sector.mood_premium[sentiment];
}

export const trailingEarnings = (c: Pick<Company, "earnings">) => sum(c.earnings);

/** Dividend per share the last four quarters' earnings would pay. */
export function dividendPerShare(c: Pick<Company, "earnings" | "payout" | "shares">): number {
  return c.shares > 0 ? (Math.max(0, trailingEarnings(c)) * c.payout) / c.shares : 0;
}

/** What a share is worth on its dividends at today's required yield; a share paying nothing is worth `distress_value` of par. */
export function fairValue(c: Company, sentiment: Sentiment, data: MarketsData): number {
  const dps = dividendPerShare(c);
  const sector = sectorOf(data, c.sector);
  return dps > 0 ? dps / requiredYield(sector, sentiment) : c.par * data.prices.distress_value;
}

/**
 * Next share price: closes `speed` of the gap to fair value times the shock, moves by up to
 * +/- the sector's price noise (u in [-1, 1)), stays within the bounds around fair value and above
 * the minimum price. Rounded to 2 decimals.
 */
export function nextSharePrice(price: number, fair: number, shock: number, u: number, sector: SectorType, data: MarketsData): number {
  const p = data.prices;
  const moved = (price + p.speed * (fair * shock - price)) * (1 + sector.price_noise * u);
  return round2(Math.max(p.min_price, clamp(moved, fair * p.bounds.min, fair * p.bounds.max)));
}

/** Capital that earns this quarter. */
export const earningCapital = (c: Pick<Company, "earning_capital" | "shares" | "par">) => c.earning_capital ?? c.shares * c.par;

/** Earnings growth since listing: (1 + growth) per year, up to the sector's cap. */
export function growthFactor(c: Pick<Company, "listed_turn">, turn: number, sector: SectorType): number {
  if (c.listed_turn === null) return 1;
  return Math.min(sector.growth_cap, (1 + sector.growth) ** ((turn - c.listed_turn) / 4));
}

/** The sector's driver this quarter: the harvest, or a commodity's price against its base. 1 without one. */
export function driverFactor(sector: SectorType, m: MarketsState, data: MarketsData): number {
  const d = sector.driver;
  if (!d) return 1;
  if (d.harvest !== undefined) return harvestIndex(m.harvest, data.regions.map((r) => r.id), data) ** d.harvest;
  if (d.commodity) {
    const type = commodityType(data, d.commodity);
    const mk = m.commodities[d.commodity];
    if (type && mk) return (mk.price / type.base_price) ** (d.elasticity ?? 1);
  }
  return 1;
}

/**
 * One quarter's earnings on `capital` at `yearly` yield: capital * yearly / 4 * (mood factor *
 * driver * growth + noise * u). The noise is additive, so a bad quarter in a bad mood can lose money.
 * Whole gulden.
 */
export function quarterEarnings(capital: number, yearly: number, sector: SectorType, sentiment: Sentiment, driver: number, growth: number, u: number): number {
  return Math.round(((capital * yearly) / 4) * (sector.mood_earnings[sentiment] * driver * growth + sector.earnings_noise * u));
}

/** A company's starting record: four quarters of normal earnings, priced at fair value. */
export function newCompany(t: CompanyType, data: MarketsData, sentiment: Sentiment, listedTurn: number | null, noise: number): Company {
  const normal = Math.round((t.shares * t.par * t.base_yield) / 4);
  const c: Company = {
    id: t.id,
    name: t.name,
    sector: t.sector,
    status: listedTurn === null ? "upcoming" : "listed",
    listed_turn: listedTurn,
    shares: t.shares,
    par: t.par,
    base_yield: t.base_yield,
    payout: t.payout,
    price: 0,
    earnings: [normal, normal, normal, normal],
    last_dividend: 0,
    shock: 1,
    earning_capital: null,
    estimate_noise: noise,
    report_tier: 0,
    report_until: 0,
    venture: null,
  };
  c.price = round2(Math.max(data.prices.min_price, fairValue(c, sentiment, data)));
  return c;
}

/** Applies a shock: temporary multipliers onto companies and commodities, permanent ones onto levels. */
export function applyShock(m: MarketsState, shock: MarketShock): void {
  for (const c of m.companies) {
    if (c.status !== "listed" && c.status !== "upcoming") continue;
    c.shock *= (shock.shares ?? 1) * (shock.sectors?.[c.sector] ?? 1);
  }
  for (const [id, f] of Object.entries(shock.commodities ?? {})) if (m.commodities[id]) m.commodities[id]!.shock *= f;
  for (const [id, f] of Object.entries(shock.levels ?? {})) if (m.commodities[id]) m.commodities[id]!.level *= f;
}

/** Fades every temporary shock by `decay` of its distance from 1. */
export function fadeShocks(m: MarketsState, decay: number): void {
  const fade = (x: number) => 1 + (x - 1) * (1 - decay);
  for (const c of m.companies) c.shock = fade(c.shock);
  for (const mk of Object.values(m.commodities)) mk.shock = fade(mk.shock);
}

/**
 * The player's view of a company's yearly earnings: a range of +/- width around a point that lies
 * within width of the truth. The width is the report tier's while the report is current, else
 * bourse talk's. Always contains the truth.
 */
export function earningsEstimate(c: Company, turn: number, data: MarketsData): { low: number; high: number; tier: number } {
  const tier = c.report_until >= turn ? c.report_tier : 0;
  const width = data.reports[tier]?.width ?? data.reports[0]!.width;
  const truth = trailingEarnings(c);
  const span = Math.abs(truth) * width;
  const point = truth + c.estimate_noise * span;
  return { low: Math.round(point - span), high: Math.round(point + span), tier };
}
