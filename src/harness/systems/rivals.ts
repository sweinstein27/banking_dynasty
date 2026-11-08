// What each harness strategy does with the rivals system (B1): matching a rival's wage to keep
// skilled staff, countering plots it hears of, spreading rumours about the most hostile house, and
// buying a sound house's paper.
import { tradingHouses } from "../../sim/houses";
import { freeCash } from "../../sim/reserves";
import { skillOf } from "../../sim/systems/counting";
import { heardPlots, openPoachOffers, paperCost, paperRoom } from "../../sim/systems/rivals";
import type { GameData } from "../../sim/tuning";
import type { Decision, GameState } from "../../sim/types";
import type { Maker, SystemMakers } from "../common";

/** Matches every open offer for a member of `roles` (all roles if empty) of skill `min_skill` or more. */
export function matchWages(state: GameState, data: GameData, min_skill: number, roles: string[] = []): Maker[] {
  return openPoachOffers(state).map((o) => (s: GameState): Decision | null => {
    const m = s.counting.staff.find((x) => x.id === o.staff);
    if (!m || (roles.length && !roles.includes(m.role)) || skillOf(m, s.world.turn, data) < min_skill) return null;
    return { kind: "match_wage", staff: o.staff };
  });
}

/** Counters every plot heard of this quarter, while its cost is at most `share` of free cash. */
export function counterPlots(state: GameState, data: GameData, share: number): Maker[] {
  return heardPlots(state).map((p) => (s: GameState): Decision | null => (data.rivals.plots.counter_cost[p.kind] <= share * freeCash(s) ? { kind: "counter_plot", plot: p.id } : null));
}

/** Once a year (first quarter), spreads rumours about the most hostile house, if one thinks worse of the house than `below`. */
export function rumoursYearly(below: number): Maker {
  return (s) => {
    if (s.world.quarter !== 1) return null;
    const h = [...tradingHouses(s)].filter((x) => x.opinion < below).sort((a, b) => a.opinion - b.opinion || a.id.localeCompare(b.id))[0];
    return h ? { kind: "scheme", house: h.id, scheme: "rumours" } : null;
  };
}

/** In a calm market, buys paper of the richest cautious house with `share` of free cash. */
export function buyPaper(data: GameData, share: number): Maker {
  return (s) => {
    if (s.world.sentiment !== "calm") return null;
    const h = [...tradingHouses(s)].filter((x) => x.temperament === "cautious").sort((a, b) => b.wealth - a.wealth || a.id.localeCompare(b.id))[0];
    if (!h) return null;
    const step = data.rivals.paper.step;
    const amount = Math.min(paperRoom(s, h, data), Math.floor((freeCash(s) * share) / step) * step);
    return amount >= data.rivals.paper.min_amount && paperCost(amount, data) <= freeCash(s) ? { kind: "buy_paper", house: h.id, amount } : null;
  };
}

/** Makers for strategy `name`: `early` ones go before its other wants, `late` ones after. */
export function rivalsMakers(name: string, state: GameState, data: GameData): SystemMakers {
  switch (name) {
    case "cautious":
    case "cautious_no_family":
      return { early: [...matchWages(state, data, 5), ...counterPlots(state, data, 0.2)], late: [] };
    case "aggressive":
      return { early: [], late: [rumoursYearly(-20)] };
    case "bond_heavy":
      return { early: [...matchWages(state, data, 5, ["clerk"]), ...counterPlots(state, data, 0.2)], late: [buyPaper(data, 0.1)] };
    case "venture_heavy":
    case "investor":
      return { early: matchWages(state, data, 5), late: [] };
    default:
      return { early: [], late: [] };
  }
}
