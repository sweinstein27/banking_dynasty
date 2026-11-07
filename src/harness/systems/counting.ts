// What each harness strategy does with the counting house (A2): hire the staff its wants need, so
// no strategy is short of capacity, and build what protects its kind of play once it can afford it.
// Idle dismisses everyone, so it stays a pure "do nothing" baseline.
import { freeCash } from "../../sim/reserves";
import { checkBuild, checkHire, type FacilityId, type StaffRole } from "../../sim/systems/counting";
import type { GameData } from "../../sim/tuning";
import type { Decision, GameState } from "../../sim/types";
import type { Maker, SystemMakers } from "../common";

interface Plan {
  /** Staff wanted, by role. */
  staff: Partial<Record<StaffRole, number>>;
  /** Facilities to build, in order, once free cash is above `build_above` (the facility's cost is paid out of the excess). */
  build: FacilityId[];
  build_above: number;
}

/**
 * Each strategy's house. Deals per quarter (one per clerk) cover what each strategy asks for most
 * turns, with the head's time covering the rest; cautious hires a second correspondent for cheaper
 * reports. The cautious house builds a strongroom and a courier stable; bond-heavy a strongroom.
 */
const PLANS: Record<string, Plan> = {
  cautious: { staff: { clerk: 3, correspondent: 2 }, build: ["courier_stable", "strongroom"], build_above: 30000 },
  cautious_no_family: { staff: { clerk: 3, correspondent: 2 }, build: ["courier_stable", "strongroom"], build_above: 30000 },
  aggressive: { staff: { clerk: 3, correspondent: 1 }, build: [], build_above: 0 },
  bond_heavy: { staff: { clerk: 3, correspondent: 1 }, build: ["strongroom"], build_above: 30000 },
  venture_heavy: { staff: { clerk: 2, correspondent: 1 }, build: [], build_above: 0 },
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
    const have = state.counting.staff.filter((m) => m.role === role && !m.leaving).length;
    for (let i = have; i < want; i++) early.push((s) => hireBest(s, role, data));
  }
  // Building comes after the strategy's own wants, out of cash left above the threshold.
  const late: Maker[] = plan.build.map((id) => (s: GameState): Decision | null => {
    const d: Decision = { kind: "build", facility: id };
    const cost = data.counting.facilities[id].build;
    return freeCash(s) >= plan.build_above + cost && !checkBuild(s, d, data) ? d : null;
  });
  return { early, late };
}

