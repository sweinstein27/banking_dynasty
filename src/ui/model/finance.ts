// What the Finance panel shows: state loans to bid for and being placed, credit asked by other
// houses, lots at auction and assets owned, and requests for cover and policies written. Built only
// from A5's own read, check and price functions (src/sim/finance/*), so a screen can never offer
// what the sim would refuse. tests/ui-wave3-screens.test.ts checks every row against the sim.
import { bondValue, statePrice, stateRisk } from "../../sim/bonds";
import { workingCount } from "../../sim/capacity";
import { fl } from "../../sim/format";
import { assetSalePrice, bidPrice, checkBidLot, checkSellAsset, openLots, seasonFactor } from "../../sim/finance/auctions";
import { pct } from "../../sim/finance/common";
import { bidScore, cautionFor, checkBidContract, contractGate, openContracts, placementRate } from "../../sim/finance/contracts";
import { activeHouseLoans, checkLendHouse, gratitude, openHouseRequests } from "../../sim/finance/houseLoans";
import { activePolicies, checkUnderwrite, exposure, openCoverRequests, policyName, premiumFor } from "../../sim/finance/insurance";
import type { Asset, AssetKind, Contract, CoverRequest, HouseLoan, HouseRequest, Lot, Policy } from "../../sim/finance/types";
import { freeCash } from "../../sim/reserves";
import { financeBook } from "../../sim/systems/finance";
import type { BondIssuer, GameData } from "../../sim/tuning";
import type { GameState } from "../../sim/types";
import type { Line, Section } from "./breakdowns";

const issuerOf = (data: GameData, id: string): BondIssuer | undefined => data.states.find((s) => s.id === id);
const houseName = (state: GameState, id: string) => state.houses.find((h) => h.id === id)?.name ?? id;

/** One choice in a decision dialog: what it is, what it costs or brings, and why the sim would refuse it. */
export interface Choice {
  value: number;
  label: string;
  /** Lines under the choice: price, what it brings. */
  notes: string[];
  blocked: string | null;
}

// ---------------------------------------------------------------- the summary

/** What the house holds in high finance, as a section adding up to the sim's financeBook. */
export function financeSection(state: GameState): Section {
  const credit = activeHouseLoans(state).reduce((s, l) => s + l.principal, 0);
  const assets = state.finance.assets.reduce((s, a) => s + a.appraisal, 0);
  const caution = state.finance.contracts.filter((c) => c.status === "placing").reduce((s, c) => s + c.caution, 0);
  const total = financeBook(state);
  return {
    heading: "What the house holds in high finance",
    lines: [
      { label: "Credit to other houses", value: fl(credit), amount: credit, term: "house_credit" },
      { label: "Assets bought at auction, at appraisal", value: fl(assets), amount: assets, term: "auction" },
      { label: "Caution money held by states", value: fl(caution), amount: caution, term: "caution_money" },
    ],
    total: { label: "In the books", value: fl(total), amount: total },
  };
}

// ---------------------------------------------------------------- state loans

export interface ContractRow {
  contract: Contract;
  stateName: string;
  /** Reputation the state asks of a house bidding. */
  gate: number;
  caution: number;
  /** "open" for bids now; "announced" for next quarter; "placing"; or done. */
  phase: "open" | "announced" | "placing" | "done";
  /** The words for a finished contract: closed, lost, withdrawn. */
  outcome: string | null;
  /** Placing: the share of what is left investors take a quarter, before noise, and its sums. */
  placement: { rate: number; sections: Section[] } | null;
  /** Why no bid can be made now (the first commission's refusal, ignoring the commission). */
  blocked: string | null;
}

/** The sums behind the placement rate: base for the mood x the house's name x the state's risk, plus correspondents, capped. */
export function placementSections(state: GameState, c: Contract, data: GameData): Section[] {
  const p = data.finance.contracts.placement;
  const issuer = issuerOf(data, c.state)!;
  const mood = state.world.sentiment;
  const name = p.reputation_floor + (p.reputation_slope * state.house.reputation) / 100;
  const risk = stateRisk(state, issuer);
  const drag = 1 - p.risk_drag * risk;
  const corr = workingCount(state, "correspondent");
  const rate = placementRate(state, c, data);
  const lines: Line[] = state.defaulted_states.includes(issuer.id)
    ? [{ label: `${issuer.name} has defaulted: no investor will take its bonds`, value: "0%" }]
    : [
        { label: `Base, the market ${mood}`, value: pct(p.base[mood]) },
        { label: `Times the house's name (reputation ${state.house.reputation})`, value: `x ${name.toFixed(2)}` },
        { label: `Times ${issuer.name}'s risk (${risk})`, value: `x ${drag.toFixed(2)}` },
        { label: `Plus ${corr} correspondent${corr === 1 ? "" : "s"}`, value: `+ ${pct(p.per_correspondent * corr)}` },
        { label: "At most", value: pct(p.max) },
      ];
  return [
    { heading: "Investors take a share of what is left each quarter", lines, total: { label: "This quarter, before luck", value: pct(rate) } },
    {
      heading: "Luck",
      lines: [{ label: "The share moves either way by up to", value: pct(p.noise) + " of itself" }],
    },
  ];
}

export function contractRows(state: GameState, data: GameData): ContractRow[] {
  const turn = state.world.turn;
  const open = new Set(openContracts(state).map((c) => c.id));
  const shown = state.finance.contracts.filter((c) => c.status === "open" || c.status === "placing" || (c.open_turn >= turn - 8 && c.player_bid !== null) || c.winner === "player");
  return shown
    .map((c) => {
      const issuer = issuerOf(data, c.state);
      const phase: ContractRow["phase"] = c.status === "placing" ? "placing" : c.status === "open" ? (open.has(c.id) ? "open" : "announced") : "done";
      const outcome =
        c.status === "closed" ? `Closed: ${Math.round((100 * c.placed) / c.size)}% placed${c.carried ? `, ${fl(c.carried)} carried` : ""}`
        : c.status === "lost" ? `Won by ${houseName(state, c.winner ?? "")} at ${pct(c.commission ?? 0)}`
        : c.status === "unawarded" ? "Withdrawn: no house would take it"
        : null;
      return {
        contract: c,
        stateName: issuer?.name ?? c.state,
        gate: issuer ? contractGate(state, issuer, data) : 0,
        caution: cautionFor(c, data),
        phase,
        outcome,
        placement: phase === "placing" ? { rate: placementRate(state, c, data), sections: placementSections(state, c, data) } : null,
        blocked: phase === "open" ? checkBidContract(state, { kind: "bid_contract", contract: c.id, commission: data.finance.contracts.commissions[0]! }, data) : null,
      };
    })
    .sort((a, b) => ORDER[a.phase] - ORDER[b.phase] || b.contract.id - a.contract.id);
}
const ORDER = { open: 0, placing: 1, announced: 2, done: 3 } as const;

/** Each commission the house may ask: its score against a rival of the same name, the fee at full placement, and the sim's verdict. */
export function commissionChoices(state: GameState, c: Contract, data: GameData): Choice[] {
  const issuer = issuerOf(data, c.state)!;
  const price = statePrice(state, issuer, data);
  return data.finance.contracts.commissions.map((commission) => ({
    value: commission,
    label: pct(commission),
    notes: [
      `About ${fl(Math.round(c.size * price * commission))} if every bond is placed`,
      `Weighed as ${pct(bidScore(commission, state.house.reputation, data))} once your name is counted`,
    ],
    blocked: checkBidContract(state, { kind: "bid_contract", contract: c.id, commission }, data),
  }));
}

/** What a bid for a state loan sets in motion, in lines for the dialog. */
export function contractTerms(state: GameState, c: Contract, data: GameData): Section {
  const issuer = issuerOf(data, c.state)!;
  const t = data.finance.contracts;
  return {
    heading: `${issuer.name} seeks ${fl(c.size)}`,
    lines: [
      { label: "Coupon", value: pct(c.coupon) },
      { label: "Term", value: `${c.term_years} years` },
      { label: "Reputation asked", value: `${contractGate(state, issuer, data)} (yours ${state.house.reputation})`, tone: state.house.reputation >= contractGate(state, issuer, data) ? "good" : "bad" },
      { label: "Caution money, paid at the award, back at the close", value: fl(cautionFor(c, data)), term: "caution_money" },
      { label: "Free cash now", value: fl(freeCash(state)) },
      { label: "Placing takes", value: `${t.placement.quarters} quarters` },
      { label: "What investors will not take, the house buys", value: "at the issue price less its commission" },
      { label: "A state weighs a better name as commission given up", value: `${pct(t.prestige_weight)} per 100 reputation above 50` },
    ],
  };
}

/** Bonds carried from contracts and when they are redeemed. */
export function redemptionRows(state: GameState, data: GameData): { bond: number; name: string; face: number; book: number; turn: number }[] {
  return state.finance.redemptions.flatMap((r) => {
    const b = state.bonds.find((x) => x.id === r.bond && x.status === "active");
    if (!b) return [];
    return [{ bond: b.id, name: issuerOf(data, b.issuer_state)?.name ?? b.issuer_state, face: b.face_value, book: bondValue(b), turn: r.turn }];
  });
}

// ---------------------------------------------------------------- credit to houses

export interface RequestRow {
  request: HouseRequest;
  name: string;
  opinion: number;
  /** Open now, or arriving next quarter. */
  open: boolean;
  blocked: string | null;
}

export function requestRows(state: GameState, data: GameData): RequestRow[] {
  const open = new Set(openHouseRequests(state).map((r) => r.id));
  return state.finance.house_requests.map((r) => ({
    request: r,
    name: houseName(state, r.house),
    opinion: state.houses.find((h) => h.id === r.house)?.opinion ?? 0,
    open: open.has(r.id),
    blocked: open.has(r.id) ? checkLendHouse(state, { kind: "lend_house", request: r.id, rate: r.max_rate }, data) : null,
  }));
}

/**
 * Rates the house may ask: from the floor to the house's top rate in about five even steps (whole
 * half points), plus the top of each gratitude band, each with the opinion it earns.
 */
export function rateChoices(state: GameState, r: HouseRequest, data: GameData): Choice[] {
  const t = data.finance.house_loans;
  const lo = t.min_rate;
  const step = Math.max(0.005, Math.ceil((r.max_rate - lo) / 5 / 0.005) * 0.005);
  const set = new Set<number>();
  for (let x = lo; x < r.max_rate - 1e-9; x = Math.round((x + step) * 10000) / 10000) set.add(x);
  for (const g of t.gratitude) if (g.up_to > lo && g.up_to < r.max_rate - 1e-9) set.add(g.up_to);
  set.add(r.max_rate);
  const rates = [...set].sort((a, b) => a - b);
  return rates.map((rate) => {
    const g = gratitude(rate, data);
    return {
      value: rate,
      label: pct(rate),
      notes: [`${fl(Math.round((r.amount * rate) / 4))} a quarter in interest`, `${houseName(state, r.house)}'s opinion ${g >= 0 ? "+" : ""}${g}`],
      blocked: checkLendHouse(state, { kind: "lend_house", request: r.id, rate }, data),
    };
  });
}

export interface HouseLoanRow {
  loan: HouseLoan;
  name: string;
  interest: number;
  quartersLeft: number;
}

export function houseLoanRows(state: GameState): HouseLoanRow[] {
  return activeHouseLoans(state).map((l) => ({
    loan: l,
    name: houseName(state, l.house),
    interest: Math.round((l.principal * l.rate) / 4),
    quartersLeft: Math.max(0, l.due_turn - state.world.turn),
  }));
}

// ---------------------------------------------------------------- auctions and assets

export const LOT_WORDS: Record<Lot["kind"], string> = { warehouse: "Warehouse", ship: "Ships", broker_place: "Broker's place", shares: "Shares" };

export interface LotRow {
  lot: Lot;
  open: boolean;
  blocked: string | null;
  /** What it earns a year if bought, in words. */
  earns: string;
}

export function assetSpec(kind: AssetKind, data: GameData) {
  return data.finance.auctions.assets[kind];
}

function earnsWords(kind: Lot["kind"], data: GameData): string {
  if (kind === "shares") return "Joins the house's shares at the market price";
  const s = assetSpec(kind, data);
  const loss = s.loss_chance > 0 ? `, ${pct(s.loss_chance)} a quarter chance of loss${kind === "ship" ? " (more in winter and storms)" : ""}` : ", never lost";
  return `${pct(s.yield)} a year${s.mood_income ? " with the market's mood" : ""}${loss}`;
}

export function lotRows(state: GameState, data: GameData): LotRow[] {
  const open = new Set(openLots(state).map((l) => l.id));
  return state.finance.lots
    .filter((l) => l.open_turn >= state.world.turn)
    .map((l) => ({
      lot: l,
      open: open.has(l.id),
      blocked: open.has(l.id) ? checkBidLot(state, { kind: "bid_lot", lot: l.id, bid: data.finance.auctions.bids[0]! }, data) : null,
      earns: earnsWords(l.kind, data),
    }));
}

export function bidChoices(state: GameState, lot: Lot, data: GameData): Choice[] {
  return data.finance.auctions.bids.map((bid) => ({
    value: bid,
    label: `${pct(bid)} of the appraisal`,
    notes: [`Pays ${fl(bidPrice(lot, bid))} if it wins`],
    blocked: checkBidLot(state, { kind: "bid_lot", lot: lot.id, bid }, data),
  }));
}

export interface AssetRow {
  asset: Asset;
  /** Income a quarter at today's mood, before any loss. */
  income: number;
  lossChance: number;
  salePrice: number;
  blocked: string | null;
  sections: Section[];
}

export function assetRows(state: GameState, data: GameData): AssetRow[] {
  const t = data.finance.auctions;
  return state.finance.assets.map((a) => {
    const s = t.assets[a.kind];
    const mood = s.mood_income ? t.mood_income[state.world.sentiment] : 1;
    const income = Math.round(((a.appraisal * s.yield) / 4) * mood);
    const season = a.kind === "ship" ? seasonFactor(state, data) : 1;
    const lossChance = s.loss_chance * season;
    const sections: Section[] = [
      {
        heading: "Income a quarter",
        lines: [
          { label: "Appraisal", value: fl(a.appraisal) },
          { label: "Yield a year, a quarter of it", value: `${pct(s.yield)} / 4` },
          ...(s.mood_income ? [{ label: `The market ${state.world.sentiment}`, value: `x ${mood}` }] : []),
        ],
        total: { label: "This quarter, if not lost", value: fl(income) },
      },
      {
        heading: "Chance of loss this quarter",
        lines: [
          { label: a.kind === "ship" ? "Lost on the river" : a.kind === "warehouse" ? "Fire" : "Never lost", value: pct(s.loss_chance) },
          ...(a.kind === "ship" && season !== 1 ? [{ label: "Winter", value: `x ${season}` }] : []),
          ...(a.kind === "ship" ? [{ label: "A great storm would multiply it", value: `x ${data.finance.insurance.storm.ship_factor}` }] : []),
        ],
        total: { label: "Before any storm", value: pct(lossChance) },
      },
    ];
    return { asset: a, income, lossChance, salePrice: assetSalePrice(a, t.sale_discount), blocked: checkSellAsset(state, { kind: "sell_asset", asset: a.id }, data), sections };
  });
}

// ---------------------------------------------------------------- insurance

export interface CoverRow {
  request: CoverRequest;
  name: string;
  open: boolean;
  blocked: string | null;
}

export function coverRows(state: GameState, data: GameData): CoverRow[] {
  const open = new Set(openCoverRequests(state).map((r) => r.id));
  return state.finance.cover_requests
    .filter((r) => r.open_turn >= state.world.turn)
    .map((r) => ({
      request: r,
      name: policyName(r),
      open: open.has(r.id),
      blocked: open.has(r.id) ? checkUnderwrite(state, { kind: "underwrite", request: r.id, line: data.finance.insurance.lines[0]! }, data) : null,
    }));
}

export function lineChoices(state: GameState, r: CoverRequest, data: GameData): Choice[] {
  return data.finance.insurance.lines.map((line) => ({
    value: line,
    label: `${pct(line)} of the value`,
    notes: [`Premium ${fl(premiumFor(r, line))}, paid now`, `At risk: up to ${fl(Math.round(r.value * line))}`],
    blocked: checkUnderwrite(state, { kind: "underwrite", request: r.id, line }, data),
  }));
}

/** The odds behind a request for cover, as the house's underwriter would see them. */
export function coverSections(state: GameState, r: CoverRequest, data: GameData): Section[] {
  const i = data.finance.insurance;
  const spec = r.kind === "ship" ? i.ship : i.warehouse;
  const lines: Line[] = [
    { label: r.kind === "ship" ? "Chance a voyage is lost" : "Chance of fire a quarter", value: pct(spec.loss_chance) },
    { label: "Quarters covered", value: String(r.quarters) },
  ];
  if (r.kind === "ship") lines.push({ label: "In a great storm, times", value: String(i.storm.ship_factor) }, { label: "Salvage on a loss", value: `${pct(i.ship.salvage[0]!)} to ${pct(i.ship.salvage[1]!)}` });
  else lines.push({ label: "Share burned in a fire", value: `${pct(i.warehouse.damage[0]!)} to ${pct(i.warehouse.damage[1]!)}` });
  lines.push({ label: "Premium for the whole term", value: pct(r.premium_rate) });
  return [{ heading: `${r.kind === "ship" ? "A voyage" : "A warehouse"} insured for ${fl(r.value)}`, lines }];
}

export interface PolicyRow {
  policy: Policy;
  name: string;
  quartersLeft: number;
}

export function policyRows(state: GameState): PolicyRow[] {
  return activePolicies(state).map((p) => ({ policy: p, name: policyName(p), quartersLeft: p.end_turn - state.world.turn + 1 }));
}

/** The house's share of the value it insures, policy by policy, adding up to the sim's exposure. */
export function exposureSection(state: GameState): Section {
  const total = exposure(state);
  return {
    heading: "What the house would pay if every insured ship and warehouse were lost",
    lines: activePolicies(state).map((p) => ({ label: policyName(p), value: fl(p.value), amount: p.value })),
    total: { label: "Exposure", value: fl(total), amount: total },
  };
}
