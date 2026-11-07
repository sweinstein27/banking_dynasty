// A5, high finance: state loan contracts, lending to other houses, bankruptcy auctions and
// insurance underwriting. The pieces live in src/sim/finance/; this file is the system's seam.
import type { DecisionResult } from "../actions";
import { fl } from "../format";
import { addEntry } from "../ledger";
import { amountToSell, loanSalePrice } from "../liquidity";
import { createRng, type Rng, type SeededRng } from "../rng";
import type { GameData, Tuning } from "../tuning";
import type { Decision, GameState, OtherHouse } from "../types";
import { assetsBook, bidLot, collateralLots, houseLots, openLots, runAssets, sellAsset, sellAssetAt, settleAuctions } from "../finance/auctions";
import { isBankrupt, withFinanceRng, pct } from "../finance/common";
import { announceContracts, awardContracts, bidContract, cautionBook, placeContracts, redeemBonds } from "../finance/contracts";
import { activeHouseLoans, drawHouseRequests, houseLoanBook, lendHouse, serviceHouseLoans, settleFailedHouseLoans } from "../finance/houseLoans";
import { drawCoverRequests, openCoverRequests, policyName, premiumFor, rollStorm, settlePolicies, underwrite } from "../finance/insurance";
import { FINANCE_KINDS, type FinanceDecision, type FinanceState } from "../finance/types";

export type { FinanceAccount, FinanceCategory, FinanceData, FinanceDecision, FinanceState } from "../finance/types";
export { rescueFactor } from "../finance/houseLoans";

/**
 * Finance's starting state. Its random stream is seeded from where the run's RNG stands, without
 * drawing from it, so adding finance shifts no other system's rolls.
 */
export function createFinance(_data: GameData, rng: Rng): FinanceState {
  const seed = ((rng as Partial<SeededRng>).state ?? Math.floor(rng.next() * 0x100000000)) ^ 0x5a17f1ce;
  return {
    rng_state: createRng(seed >>> 0).state,
    next_id: 1,
    contracts: [],
    redemptions: [],
    house_requests: [],
    house_loans: [],
    lots: [],
    assets: [],
    cover_requests: [],
    policies: [],
    seen_defaults: [],
    storm_turn: null,
  };
}

/** The system's End Turn step, after markets resolve. Mutates `state`. */
export function resolveFinance(state: GameState, _rng: Rng, data: GameData): void {
  withFinanceRng(state, (rng) => stepFinance(state, rng, data));
}

/**
 * One quarter of high finance, before debts, wages and withdrawals:
 * 1. contracts being placed place a share (closing after the last quarter: caution back, unplaced bonds carried),
 * 2. this quarter's loans are awarded, 3. carried bonds due are redeemed at par, 4. loans to houses
 * pay interest and fall due, 5. this quarter's lots are auctioned, 6. collateral of new defaults goes
 * to auction next quarter, 7. a storm is rolled, owned assets earn or are lost, policies may claim,
 * 8. next quarter's loans, requests from houses and requests for cover are drawn.
 * Expired requests are dropped. Mutates `state`.
 */
export function stepFinance(state: GameState, rng: Rng, data: GameData): void {
  if (state.house.status === "bankrupt") return;
  placeContracts(state, rng, data);
  awardContracts(state, rng, data);
  redeemBonds(state, data);
  serviceHouseLoans(state, data);
  settleAuctions(state, rng, data);
  collateralLots(state, data);
  const storm = rollStorm(state, rng, data);
  runAssets(state, rng, data, storm);
  settlePolicies(state, rng, data, storm);
  if (isBankrupt(state)) return;
  state.finance.house_requests = state.finance.house_requests.filter((r) => r.open_turn > state.world.turn);
  announceContracts(state, rng, data);
  drawHouseRequests(state, rng, data);
  drawCoverRequests(state, rng, data);
}

/** A house has failed (called from src/sim/houses.ts): its debts to the player are settled and its holdings go to auction. Mutates `state`. */
export function houseFailed(state: GameState, h: OtherHouse, data: GameData): void {
  settleFailedHouseLoans(state, h, data);
  withFinanceRng(state, (rng) => houseLots(state, h, rng, data));
}

/** Balances of the ledger accounts this system adds, for the save check. */
export function financeAccounts(state: GameState): Record<"house_loans" | "assets" | "caution", number> {
  return { house_loans: houseLoanBook(state), assets: assetsBook(state), caution: cautionBook(state) };
}

/** What the house's holdings in this system are worth: loans to houses, assets at appraisal, caution money. */
export function financeBook(state: GameState): number {
  return houseLoanBook(state) + assetsBook(state) + cautionBook(state);
}

/**
 * Forced sales in a bank run (called from src/sim/liquidity.ts after market holdings): assets at the
 * venture discount (whole, oldest first), then loans to houses at the loan discount (only the slice
 * needed). Returns the cash raised. Mutates `state`.
 */
export function raiseFromFinance(state: GameState, needed: number, tuning: Tuning, purpose: string): number {
  let raised = 0;
  for (const a of [...state.finance.assets]) {
    if (raised >= needed) break;
    raised += sellAssetAt(state, a, tuning.forced_sale.venture_discount, "forced_sale", `sold at a discount ${purpose},`);
  }
  for (const l of activeHouseLoans(state)) {
    if (raised >= needed) break;
    const slice = amountToSell(needed - raised, l.principal, 1 - tuning.forced_sale.loan_discount);
    const price = loanSalePrice(slice, tuning);
    l.principal -= slice;
    if (l.principal === 0) l.status = "sold";
    state.house.cash += price;
    raised += price;
    const name = state.houses.find((h) => h.id === l.house)?.name ?? l.house;
    const note = `Credit to ${name}: ${slice} sold at a discount ${purpose}`;
    addEntry(state, "cash", "forced_sale", price, note);
    addEntry(state, "house_loans", "forced_sale", -slice, note);
  }
  return raised;
}

const KINDS: ReadonlySet<string> = new Set(FINANCE_KINDS);
export const isFinanceDecision = (d: Decision): d is FinanceDecision => KINDS.has(d.kind);

export function applyFinanceDecision(state: GameState, d: FinanceDecision, data: GameData): DecisionResult {
  switch (d.kind) {
    case "bid_contract":
      return bidContract(state, d, data);
    case "lend_house":
      return lendHouse(state, d, data);
    case "bid_lot":
      return bidLot(state, d, data);
    case "sell_asset":
      return sellAsset(state, d, data);
    case "underwrite":
      return underwrite(state, d, data);
  }
}

export function describeFinanceDecision(d: FinanceDecision, state: GameState, data: GameData): string {
  switch (d.kind) {
    case "bid_contract": {
      const c = state.finance.contracts.find((x) => x.id === d.contract);
      const name = data.states.find((s) => s.id === c?.state)?.name ?? "a state";
      return `Bid ${pct(d.commission)} commission for the ${name} loan${c ? ` of ${fl(c.size)}` : ""}`;
    }
    case "lend_house": {
      const r = state.finance.house_requests.find((x) => x.id === d.request);
      const name = state.houses.find((h) => h.id === r?.house)?.name ?? "a house";
      return `Lend ${r ? fl(r.amount) : ""} to ${name} at ${pct(d.rate)}`.replace("  ", " ");
    }
    case "bid_lot": {
      const lot = openLots(state).find((l) => l.id === d.lot);
      return lot ? `Bid ${fl(Math.round(lot.appraisal * d.bid))} for ${lot.name}` : `Bid ${pct(d.bid)} for lot ${d.lot}`;
    }
    case "sell_asset": {
      const a = state.finance.assets.find((x) => x.id === d.asset);
      return `Sell ${a?.name ?? `asset ${d.asset}`}`;
    }
    case "underwrite": {
      const r = openCoverRequests(state).find((x) => x.id === d.request);
      return r ? `Insure ${pct(d.line)} of ${policyName(r)} for a premium of ${fl(premiumFor(r, d.line))}` : `Insure request ${d.request}`;
    }
  }
}
