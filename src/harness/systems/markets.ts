// What each harness strategy does with the markets (A3): shares, goods and long ventures.
// Market makers go late, so they use the actions a strategy's own wants leave over.
import { sharesHeld, holdingValue, spaceUsed, warehouseSpace } from "../../sim/markets/holdings";
import { commodityTarget, dividendPerShare, fairValue, nextQuarter, requiredYield, sectorOf } from "../../sim/markets/prices";
import type { Company } from "../../sim/markets/types";
import { freeCash } from "../../sim/reserves";
import { marketsBook } from "../../sim/systems/markets";
import type { GameData } from "../../sim/tuning";
import { remainingCommitment } from "../../sim/ventures";
import type { Decision, GameState } from "../../sim/types";
import { shareOfFree, type Maker, type SystemMakers } from "../common";

const listed = (s: GameState) => s.markets.companies.filter((c) => c.status === "listed");
/** Dividend yield at today's price, on the last four quarters' earnings. */
const yieldOf = (c: Company) => (c.price > 0 ? dividendPerShare(c) / c.price : 0);

/** Buys shares of the best-yielding listed company in `sectors` with `share` of free cash, if free cash is above `floor`. */
export function buySharesIn(sectors: string[] | null, share: number, floor: number): Maker {
  return (s) => {
    if (freeCash(s) < floor) return null;
    const pick = listed(s)
      .filter((c) => (!sectors || sectors.includes(c.sector)) && c.shares > sharesHeld(s, c.id))
      .sort((a, b) => yieldOf(b) - yieldOf(a) || a.id.localeCompare(b.id))[0];
    if (!pick) return null;
    const n = Math.min(pick.shares - sharesHeld(s, pick.id), Math.floor(shareOfFree(s, share) / (pick.price * 1.01)));
    return n > 0 ? { kind: "buy_shares", company: pick.id, shares: n } : null;
  };
}

/** How far a commodity's price is expected to move: next quarter's target over today's price. */
function upside(s: GameState, id: string, data: GameData): number {
  const type = data.markets.commodities.find((c) => c.id === id)!;
  const q = nextQuarter(s.world.year, s.world.quarter);
  return commodityTarget(type, s.markets, q.year, q.quarter, data.markets) / s.markets.commodities[id]!.price;
}

/** Buys grain after a bad harvest, when its price has room to rise by `margin`, with up to `share` of free cash. */
export function speculateGrain(data: GameData, margin: number, share: number): Maker {
  return (s) => {
    if (upside(s, "grain", data) < 1 + margin) return null;
    const type = data.markets.commodities.find((c) => c.id === "grain")!;
    const room = Math.floor((warehouseSpace(s, data) - spaceUsed(s, data)) / type.space);
    const n = Math.min(room, Math.floor(shareOfFree(s, share) / (s.markets.commodities.grain!.price * 1.02)));
    return n > 0 ? { kind: "buy_commodity", commodity: "grain", units: n } : null;
  };
}

/** Sells goods once their price has caught up with where it is heading. */
export function sellRipeGoods(data: GameData): Maker {
  return (s) => {
    const id = Object.keys(s.markets.goods).find((g) => upside(s, g, data) < 1.02);
    return id ? { kind: "sell_commodity", commodity: id, units: s.markets.goods[id]! } : null;
  };
}

/** Sells a holding priced above `rich` times its fair value. */
export function sellRichShares(data: GameData, rich: number): Maker {
  return (s) => {
    const c = listed(s).find((x) => sharesHeld(s, x.id) > 0 && x.price > rich * fairValue(x, s.world.sentiment, data.markets));
    return c ? { kind: "sell_shares", company: c.id, shares: sharesHeld(s, c.id) } : null;
  };
}

/** Free cash less every venture call still to come: what a strategy can commit without over-promising. */
export function uncommittedFree(s: GameState): number {
  const owed = s.ventures.reduce((sum, v) => sum + remainingCommitment(v), 0);
  return Math.max(0, freeCash(s) - owed);
}

/** `share` of uncommitted free cash, rounded down to 100 fl. */
export const shareOfUncommitted = (s: GameState, f: number) => Math.floor((uncommittedFree(s) * f) / 100) * 100;

/** Commits `share` of uncommitted free cash to venture `id` every `every` quarters, when it is open. */
export function commitEvery(id: string, every: number, share: number): Maker {
  return (s) => (s.world.turn % every === 1 ? { kind: "invest_venture", venture: id, amount: shareOfUncommitted(s, share) } : null);
}

/**
 * The investor: dividends and harvests. It sells shares that run well above fair value and goods
 * whose price has caught up, buys grain after a bad harvest, then spreads free cash over the
 * best-yielding shares that pay at least their sector's required yield, keeping any one company
 * under a third of what it holds in the markets.
 */
export function investorWants(_state: GameState, data: GameData): Maker[] {
  const diversified: Maker = (s) => {
    const book = marketsBook(s) + freeCash(s);
    const pick = listed(s)
      .filter((c) => yieldOf(c) >= requiredYield(sectorOf(data.markets, c.sector), s.world.sentiment) && holdingValue(s, c.id) < book / 3 && c.shares > sharesHeld(s, c.id))
      .sort((a, b) => yieldOf(b) - yieldOf(a) || a.id.localeCompare(b.id))[0];
    if (!pick || freeCash(s) < 5000) return null;
    const n = Math.min(pick.shares - sharesHeld(s, pick.id), Math.floor(Math.min(shareOfFree(s, 0.3), book / 3 - holdingValue(s, pick.id)) / (pick.price * 1.01)));
    return n > 0 ? ({ kind: "buy_shares", company: pick.id, shares: n } as Decision) : null;
  };
  return [sellRichShares(data, 1.3), sellRipeGoods(data), speculateGrain(data, 0.12, 0.25), diversified, diversified];
}

/** Makers for strategy `name`: `early` ones go before its other wants, `late` ones after. */
export function marketsMakers(name: string, _state: GameState, data: GameData): SystemMakers {
  const none: Maker[] = [];
  switch (name) {
    case "cautious":
      // Utilities with spare cash: steady dividends, prices that hold in a panic.
      return { early: none, late: [buySharesIn(["utility"], 0.15, 30000)] };
    case "aggressive":
      // Railway shares, and grain after a bad harvest.
      return { early: none, late: [sellRipeGoods(data), speculateGrain(data, 0.1, 0.3), buySharesIn(["railway", "industry"], 0.15, 10000)] };
    case "bond_heavy":
      // A little in banks and insurance, the bourse's bond-like shares.
      return { early: none, late: [buySharesIn(["bank", "insurance", "utility"], 0.1, 20000)] };
    case "venture_heavy":
      // Great works once they open, besides its own medium ventures.
      return { early: none, late: [commitEvery("railway", 8, 0.3), commitEvery("gasworks", 8, 0.3)] };
    default:
      return { early: none, late: none };
  }
}
