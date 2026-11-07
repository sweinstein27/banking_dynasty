// What each harness strategy does with Europe (C1). Aggressive opens up to three branches under the
// family (London, Paris, Vienna, Hamburg, Berlin: the first its reputation opens and it believes
// calm) and closes one when it hears of war or unrest there; investor buys 3-month bills on cities
// it believes calm. The rest leave Europe alone.
import { branchCandidates, branchIn, billRoom } from "../../sim/europe/branches";
import { cityData, cityState, onOrAfter } from "../../sim/europe/world";
import { freeCash } from "../../sim/reserves";
import type { GameData } from "../../sim/tuning";
import type { Decision, GameState, Person } from "../../sim/types";
import { shareOfFree, type Maker, type SystemMakers } from "../common";

/** Where aggressive opens branches, in order, and the share of free cash it sends to each. */
export const BRANCH_PLAY = { cities: ["london", "paris", "vienna", "hamburg", "berlin"], share: 0.15, max_capital: 40000, min_free: 20000, max_branches: 3 };
/** Cities investor buys bills on, and the most it holds on each. */
export const BILL_PLAY = { cities: ["london", "amsterdam", "hamburg", "paris"], amount: 2000 };

/** The ablest candidate to run a branch: highest acumen plus prudence, then the eldest. */
function ablest(s: GameState, data: GameData): Person | undefined {
  return [...branchCandidates(s, data)].sort((a, b) => b.acumen + b.prudence - (a.acumen + a.prudence) || a.birth_year - b.birth_year)[0];
}

const troubled = (s: GameState, city: string) => {
  const k = cityState(s, city)!.known;
  return k.status !== "peace";
};

function branchMakers(state: GameState, data: GameData): SystemMakers {
  const early: Maker[] = [];
  // Close a branch on news of war or unrest in its city.
  for (const b of state.europe.branches) if (troubled(state, b.city)) early.push(() => ({ kind: "close_branch", city: b.city }));
  // Put someone at the head of a headless branch.
  for (const b of state.europe.branches) {
    if (b.head !== null) continue;
    early.push((s) => {
      const p = ablest(s, data);
      return p ? { kind: "appoint_branch_head", city: b.city, head: p.id } : null;
    });
  }
  // Open the next branch, one a quarter, before the strategy's other wants spend the cash.
  early.push((s): Decision | null => {
    if (freeCash(s) < BRANCH_PLAY.min_free || s.europe.branches.length >= BRANCH_PLAY.max_branches) return null;
    const city = BRANCH_PLAY.cities.find((c) => {
      const d = cityData(data, c)!;
      return !branchIn(s, c) && onOrAfter(s.world, d.opens) && s.house.reputation >= d.min_reputation && !troubled(s, c) && cityState(s, c)!.known.mood === "calm";
    });
    const p = ablest(s, data);
    if (!city || !p) return null;
    const capital = Math.min(BRANCH_PLAY.max_capital, Math.max(data.europe.branch.min_capital, shareOfFree(s, BRANCH_PLAY.share)));
    return { kind: "open_branch", city, head: p.id, capital };
  });
  return { early, late: [] };
}

function billMakers(data: GameData): SystemMakers {
  const late: Maker[] = BILL_PLAY.cities.map((city) => (s: GameState): Decision | null => {
    const k = cityState(s, city)!.known;
    if (k.mood !== "calm" || k.status !== "peace") return null;
    const amount = Math.min(BILL_PLAY.amount, billRoom(s, data, city), Math.floor(freeCash(s) / 100) * 100);
    return amount > 0 ? { kind: "buy_bill", city, amount } : null;
  });
  return { early: [], late };
}

/** Makers for strategy `name`: `early` ones go before its other wants, `late` ones after. */
export function europeMakers(name: string, state: GameState, data: GameData): SystemMakers {
  if (name === "aggressive") return branchMakers(state, data);
  if (name === "investor") return billMakers(data);
  return { early: [], late: [] };
}
