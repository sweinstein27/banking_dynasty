// Strategies for the balancing harness: simple, readable players for the spec's "cautious,
// aggressive and bond-heavy" comparison, plus an idle baseline and a venture-heavy probe.
// Each lists what it wants in priority order; the house's capacity (src/sim/capacity.ts) cuts the list short.
import { bondDefaultChance } from "../sim/bonds";
import { lenders } from "../sim/crisis";
import { STATS, statTotal, successor } from "../sim/family";
import { bondOffers, lendOffers, ventureOffers } from "../sim/offers";
import { withdrawalDemand } from "../sim/sentiment";
import { warningKnown } from "../sim/systems/counting";
import type { GameData } from "../sim/tuning";
import type { Decision, GameState } from "../sim/types";
import { accepted as acceptedCore, letterReplies, lendShare, marriageMakers, safestFirst, shareOfFree, type Maker, type Strategy } from "./common";
import { countingMakers } from "./systems/counting";
import { europeMakers } from "./systems/europe";
import { financeMakers } from "./systems/finance";
import { peopleMakers } from "./systems/people";
import { progressMakers } from "./systems/progress";
import { rivalsMakers } from "./systems/rivals";
import { legacyMakers } from "./systems/legacy";
import { politicsMakers } from "./systems/politics";
import { warMakers } from "./systems/war";
import { creditMakers, readOffer } from "./systems/credit";
import { investorWants, marketsMakers, shareOfUncommitted } from "./systems/markets";

/** Every system's early makers, the strategy's own wants, then every system's late makers. */
function accepted(name: string, state: GameState, data: GameData, wanted: Maker[]): Decision[] {
  const systems = [creditMakers, countingMakers, marketsMakers, financeMakers, peopleMakers, europeMakers, progressMakers, rivalsMakers, legacyMakers, politicsMakers, warMakers].map((f) => f(name, state, data));
  return acceptedCore(state, data, [...systems.flatMap((m) => m.early), ...wanted, ...systems.flatMap((m) => m.late)]);
}


const toThousand = (n: number) => Math.round(n / 1000) * 1000;

/** Sets the reserve to `share` of deposits when it is more than 5,000 fl. away from that. */
function reserveAt(share: number): Maker {
  return (s) => {
    const target = toThousand(s.house.deposits * share);
    return Math.abs(s.house.reserve - target) > 5000 ? { kind: "set_reserve", amount: target } : null;
  };
}

/** True when cash cannot cover what depositors will ask this quarter. */
function shortForWithdrawals(s: GameState, data: GameData): boolean {
  return s.house.cash < withdrawalDemand(s.house.deposits, s.world.sentiment, data.tuning, s.house.reputation);
}

/** Does nothing: the baseline every other strategy must beat. Its only decisions are the systems' (A2: dismissing its staff). */
export const idle: Strategy = (state, data) => accepted("idle", state, data, []);

/**
 * Cautious: keeps 40% of deposits in reserve (60% from the first warning sign), checks borrowers
 * before lending, lends only where even the low end of the estimate is 0.6 or better, buys bonds
 * only from the safest states (risk 0.25 or less), and educates the heir who would take over until
 * their stats are enough to be trained. In a panic it pays depositors slowly when cash is short.
 * It answers letters with the paid, certain response when it can afford it, and marries each heir
 * of age into the house that agrees and pays the largest dowry, else into a merchant family. It never courts other
 * houses: it never borrows, so their favour would buy it nothing (measured in D4).
 */
export function cautious(state: GameState, data: GameData): Decision[] {
  return cautiousPlay(state, data, true);
}

/** The cautious strategy without any investment in the family, to measure whether educating pays (T7). It answers letters as cautious does. */
export function cautiousNoFamily(state: GameState, data: GameData): Decision[] {
  return cautiousPlay(state, data, false);
}

function cautiousPlay(state: GameState, data: GameData, educate: boolean): Decision[] {
  // What the house knows (A2): without a courier stable a warning reaches it a quarter late.
  const worried = warningKnown(state, data) || state.world.sentiment !== "calm";
  const wanted: Maker[] = letterReplies(state, data, "safe");
  if (state.world.sentiment === "panic" && shortForWithdrawals(state, data)) wanted.push(() => ({ kind: "pay_slowly" }));
  wanted.push(reserveAt(worried ? 0.6 : 0.4));
  wanted.push(...marriageMakers(state, data, "best"));
  // Reports and inquiries come from the credit makers (src/harness/systems/credit.ts).
  for (let i = 0; i < 2; i++) {
    wanted.push((s) => {
      const o = safestFirst(s, data)[0];
      return o && readOffer(o, data) >= 0.65 ? lendShare(s, o, 0.25) : null;
    });
  }
  if (educate) wanted.push((s) => {
    // Only the heir who would take over, and only until their stats reach the trained total
    // (age does the rest).
    const heir = successor(s, data);
    if (!heir || statTotal(heir) >= data.tuning.family.succession.trained_total || shareOfFree(s, 1) < 10000) return null;
    const stat = [...STATS].sort((a, b) => heir[a] - heir[b])[0]!;
    return { kind: "invest_family", form: "educate", heir: heir.id, stat };
  });
  wanted.push((s) => {
    // Safe states only (risk 0.25 or less): never Naples or France, even when they are all that is open.
    const safe = bondOffers(s, data).filter((o) => !o.blocked && o.risk <= 0.25).sort((a, b) => a.risk - b.risk)[0];
    return safe && shareOfFree(s, 1) > 20000 ? { kind: "buy_bond", state: safe.id, face_value: shareOfFree(s, 0.2) } : null;
  });
  return accepted(educate ? "cautious" : "cautious_no_family", state, data, wanted);
}

/**
 * Aggressive: no reserve, lends most of its free cash to whoever pays the most, buys the riskiest
 * bonds still for sale and backs a venture every year. When a panic leaves it short, it borrows
 * all it can, from the cheapest house willing to lend and then the next. Its heirs marry into
 * merchant families, as do bond-heavy's and venture-heavy's. It answers letters with the free response that takes a chance.
 */
export function aggressive(state: GameState, data: GameData): Decision[] {
  const wanted: Maker[] = letterReplies(state, data, "risky");
  if (state.world.sentiment === "panic" && shortForWithdrawals(state, data)) {
    // All it can: the cheapest willing house first, then the next, while actions last.
    for (let i = 0; i < 2; i++) {
      wanted.push((s) => {
        const best = lenders(s, data.tuning)[0];
        return best && !best.refused ? { kind: "borrow", house: best.house.id, amount: best.room } : null;
      });
    }
  }
  wanted.push((s) => (s.house.reserve > 0 ? { kind: "set_reserve", amount: 0 } : null));
  wanted.push(...marriageMakers(state, data, "merchant"));
  wanted.push((s) => {
    const o = [...lendOffers(s, data)].sort((a, b) => b.max_rate - a.max_rate || a.borrower_id - b.borrower_id)[0];
    return o ? lendShare(s, o, 0.6) : null;
  });
  wanted.push((s) => {
    const risky = bondOffers(s, data).filter((o) => !o.blocked).sort((a, b) => b.risk - a.risk)[0];
    return risky ? { kind: "buy_bond", state: risky.id, face_value: shareOfFree(s, 0.5) } : null;
  });
  if (state.world.turn % 4 === 1) wanted.push((s) => ({ kind: "invest_venture", venture: "shipping", amount: shareOfUncommitted(s, 0.5) }));
  return accepted("aggressive", state, data, wanted);
}

/** How a bond house plays: the reserve it keeps, the riskiest state it buys without limit, and its cap on riskier ones. */
export interface BondPlay {
  reserve: number;
  /** States with risk above this are "risky". */
  risky_above: number;
  /** Most of the bond book (at face) a risky state may make up; 1 means no cap. */
  risky_cap: number;
}

export const BOND_PLAY: BondPlay = { reserve: 0.15, risky_above: 0.4, risky_cap: 0.2 };

/**
 * Bond-heavy: a reserve, then most free cash into the two open states with the best coupon after
 * expected defaults (risky states only up to a share of the bond book), and a little lending to the
 * safest-looking borrower.
 */
export function bondHeavyWith(play: BondPlay): Strategy {
  return (state, data) => {
    const yieldAfterDefaults = (o: ReturnType<typeof bondOffers>[number]) => o.coupon - 4 * bondDefaultChance(o.risk, "calm", data.tuning);
    const book = (s: GameState, id?: string) => s.bonds.filter((x) => x.status === "active" && (!id || x.issuer_state === id)).reduce((n, x) => n + x.face_value, 0);
    const allowed = (s: GameState, o: ReturnType<typeof bondOffers>[number]) =>
      o.risk <= play.risky_above || play.risky_cap >= 1 || book(s, o.id) < play.risky_cap * Math.max(1, book(s));
    const ranked = (s: GameState) =>
      bondOffers(s, data)
        .filter((o) => !o.blocked && allowed(s, o))
        .sort((a, b) => yieldAfterDefaults(b) - yieldAfterDefaults(a) || a.id.localeCompare(b.id));
    const wanted: Maker[] = [reserveAt(play.reserve), ...marriageMakers(state, data, "merchant")];
    for (let i = 0; i < 2; i++) {
      wanted.push((s) => {
        const o = ranked(s)[i];
        return o ? { kind: "buy_bond", state: o.id, face_value: shareOfFree(s, 0.4) } : null;
      });
    }
    wanted.push((s) => {
      const o = safestFirst(s, data)[0];
      return o ? lendShare(s, o, 0.1) : null;
    });
    return accepted("bond_heavy", state, data, wanted);
  };
}

export const bondHeavy: Strategy = (state, data) => bondHeavyWith(BOND_PLAY)(state, data);

/**
 * Venture-heavy: a 10% reserve, then half of free cash not already promised to calls (A3) into whichever open venture has the best
 * expected gain per quarter at today's odds, and half of the rest into the next best.
 */
export function ventureHeavy(state: GameState, data: GameData): Decision[] {
  const perQuarter = (o: ReturnType<typeof ventureOffers>[number]) => ((1 - o.failure_chance) * (1 + o.expected_return) - 1) / o.term_quarters;
  const ranked = (s: GameState) => ventureOffers(s, data).filter((o) => !o.blocked).sort((a, b) => perQuarter(b) - perQuarter(a) || a.id.localeCompare(b.id));
  const wanted: Maker[] = [reserveAt(0.1), ...marriageMakers(state, data, "merchant")];
  for (let i = 0; i < 2; i++) {
    wanted.push((s) => {
      const o = ranked(s)[i];
      return o ? { kind: "invest_venture", venture: o.id, amount: shareOfUncommitted(s, 0.5) } : null;
    });
  }
  return accepted("venture_heavy", state, data, wanted);
}

/**
 * Investor (A3): a 20% reserve, then the bourse and the grain trade (src/harness/systems/markets.ts),
 * and a little lending to the safest-looking borrower with what is left.
 */
export function investor(state: GameState, data: GameData): Decision[] {
  const wanted: Maker[] = [reserveAt(0.2), ...marriageMakers(state, data, "merchant"), ...investorWants(state, data)];
  wanted.push((s) => {
    const o = safestFirst(s, data)[0];
    return o ? lendShare(s, o, 0.1) : null;
  });
  return accepted("investor", state, data, wanted);
}

/** The harness's strategies by name, in the order the summary lists them. */
export const STRATEGIES: Record<string, Strategy> = {
  idle,
  cautious,
  aggressive,
  bond_heavy: bondHeavy,
  venture_heavy: ventureHeavy,
  investor,
  cautious_no_family: cautiousNoFamily,
};
