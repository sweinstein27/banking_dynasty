// What each harness strategy does with progress (C4): back new technologies once they open, and
// get out of the trades railways are killing.
import { sharesHeld } from "../../sim/markets/holdings";
import { adoption, ventureOpen } from "../../sim/systems/progress";
import type { GameData } from "../../sim/tuning";
import type { GameState } from "../../sim/types";
import type { Maker, SystemMakers } from "../common";
import { shareOfUncommitted } from "./markets";

/** Railway adoption from which share-holding strategies sell canals and shipping. */
export const DECLINE_SELL_AT = 0.3;

/** Sells the house's shares in a listed company of `sectors` once `tech` has reached `at` adoption. */
export function sellDeclining(tech: string, sectors: string[], at: number): Maker {
  return (s) => {
    if (adoption(s, tech) < at) return null;
    const c = s.markets.companies.find((x) => x.status === "listed" && sectors.includes(x.sector) && sharesHeld(s, x.id) > 0);
    return c ? { kind: "sell_shares", company: c.id, shares: sharesHeld(s, c.id) } : null;
  };
}

/** Commits `share` of uncommitted free cash to venture `id` in its first quarter open, then every `every` quarters after. */
export function backWhenOpen(id: string, every: number, share: number, data: GameData): Maker {
  const type = data.ventures.find((v) => v.id === id);
  return (s) => {
    if (!type || !ventureOpen(s, type, data)) return null;
    const last = s.ventures.filter((v) => v.type === id).reduce((t, v) => Math.max(t, v.start_turn), -Infinity);
    if (s.world.turn - last < every) return null;
    const amount = shareOfUncommitted(s, share);
    return amount >= data.tuning.ventures.min_amount ? { kind: "invest_venture", venture: id, amount } : null;
  };
}

/** Makers for strategy `name`: `early` ones go before its other wants, `late` ones after. */
export function progressMakers(name: string, _state: GameState, data: GameData): SystemMakers {
  const none: Maker[] = [];
  switch (name) {
    case "venture_heavy":
      // Backs trunk railways as soon as they open (early, once its own railway has a section running).
      return { early: none, late: [backWhenOpen("trunk_railway", 8, 0.3, data)] };
    case "investor":
    case "aggressive":
      // Gets out of canals and shipping once railways are well under way.
      return { early: [sellDeclining("railway", ["canal", "shipping"], DECLINE_SELL_AT)], late: none };
    default:
      return { early: none, late: none };
  }
}
