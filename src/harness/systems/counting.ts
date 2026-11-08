// What each harness strategy does with the counting house (A2): hire the staff its wants need, so
// no strategy is short of capacity, and build what pays for its kind of play, early, while it has the cash.
// Idle dismisses everyone, so it stays a pure "do nothing" baseline.
import { checkBuild, checkHire, type FacilityId, type StaffRole } from "../../sim/systems/counting";
import type { GameData } from "../../sim/tuning";
import type { Decision, GameState } from "../../sim/types";
import type { Maker, SystemMakers } from "../common";

interface Plan {
  /** Staff wanted, by role. */
  staff: Partial<Record<StaffRole, number>>;
  /** Facilities to build, in order, before the strategy's other wants, as soon as free cash covers the cost. */
  build: FacilityId[];
}

/**
 * Each strategy's house: just the staff its wants use, with the head's time covering the overflow.
 * Deals: cautious lends twice and buys bonds (2 clerks); aggressive lends, buys bonds and backs a
 * venture, and borrows with the head's time in a panic (3 clerks); bond-heavy buys twice and lends
 * (2 clerks); venture-heavy backs two ventures (2 clerks). Only cautious buys reports, so the others
 * let the correspondent go; the investor keeps the starting staff. Each builds, in its first
 * quarter, the facility that paid for its play on 1,000 seeds (docs/notes/A2-counting-house.md):
 * reception rooms for cautious (warmer houses, better matches), a courier stable for the bond
 * buyers (bond-heavy, aggressive), a strongroom for the investor. Venture-heavy builds nothing.
 */
const PLANS: Record<string, Plan> = {
  cautious: { staff: { clerk: 2, correspondent: 1 }, build: ["reception_rooms"] },
  cautious_no_family: { staff: { clerk: 2, correspondent: 1 }, build: ["reception_rooms"] },
  aggressive: { staff: { clerk: 3, correspondent: 0 }, build: ["courier_stable"] },
  bond_heavy: { staff: { clerk: 2, correspondent: 0 }, build: ["courier_stable"] },
  venture_heavy: { staff: { clerk: 2, correspondent: 0 }, build: [] },
  investor: { staff: {}, build: ["strongroom"] },
};

/** The best candidate for a role this quarter (most skilled, then first listed), as a hire decision. */
function hireBest(s: GameState, role: StaffRole, data: GameData): Decision | null {
  const list = s.counting.candidates[role];
  let best = -1;
  for (let i = 0; i < list.length; i++) if (best < 0 || list[i]!.skill > list[best]!.skill) best = i;
  if (best < 0) return null;
  const d: Decision = { kind: "hire", role, candidate: best };
  return checkHire(s, d, data) ? null : d;
}

/** Makers for strategy `name`: `early` ones go before its other wants, `late` ones after. */
export function countingMakers(name: string, state: GameState, data: GameData): SystemMakers {
  if (name === "idle") {
    // Everyone goes on the first quarter: an idle house pays no wages (only the room's upkeep).
    const early: Maker[] = state.counting.staff.filter((m) => !m.leaving).map((m) => () => ({ kind: "dismiss", staff: m.id }));
    return { early, late: [] };
  }
  const plan = PLANS[name];
  if (!plan) return { early: [], late: [] };
  const early: Maker[] = [];
  for (const [role, want] of Object.entries(plan.staff) as [StaffRole, number][]) {
    const staying = state.counting.staff.filter((m) => m.role === role && !m.leaving);
    for (let i = staying.length; i < want; i++) early.push((s) => hireBest(s, role, data));
    // More than it uses: the least skilled go.
    const extra = [...staying].sort((x, y) => x.skill - y.skill || y.id - x.id).slice(0, Math.max(0, staying.length - want));
    for (const m of extra) early.push(() => ({ kind: "dismiss", staff: m.id }));
  }
  // Building comes first: a facility pays only if it is there before the money goes out.
  for (const id of plan.build) {
    early.push((s: GameState): Decision | null => {
      const d: Decision = { kind: "build", facility: id };
      return checkBuild(s, d, data) ? null : d;
    });
  }
  return { early, late: [] };
}

