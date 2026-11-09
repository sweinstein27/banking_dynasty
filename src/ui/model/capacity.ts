// What a decision would take of the house's time, in words, for every action button in wave 2's
// screens. Built from capacity.ts's own pools so it never disagrees with the sim.
import { POOL_NAMES, poolFor, poolLeft, poolSize, type Pool } from "../../sim/capacity";
import type { GameData } from "../../sim/tuning";
import type { Decision, GameState } from "../../sim/types";

/** Pools that fall back to the head's time when empty (as in capacity.ts). */
const FALLS_BACK: Pool[] = ["deals", "reports"];

/** "Uses 1 of 3 deals (clerks) left this quarter", "Uses none of the house's time", or what it falls back to. */
export function capacityNote(state: GameState, kind: Decision["kind"], data: GameData): string {
  const pool = poolFor(kind);
  if (pool === null) return "Takes none of the house's time";
  const left = poolLeft(state, pool, data.tuning);
  const size = poolSize(state, pool, data.tuning);
  if (left > 0) return `Uses 1 of ${left} ${POOL_NAMES[pool]} left this quarter (of ${size})`;
  if (FALLS_BACK.includes(pool)) {
    const head = poolLeft(state, "head", data.tuning);
    if (head > 0) return `No ${POOL_NAMES[pool]} left: uses 1 of ${head} of the head's time instead`;
  }
  return `None of ${POOL_NAMES[pool]} left this quarter`;
}
