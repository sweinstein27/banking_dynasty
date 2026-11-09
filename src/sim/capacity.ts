// How much the house can do in a quarter (milestone A2). There is no fixed number of actions: the
// staff and the head's time give capacity in pools, and every decision kind draws on one pool or
// none. Clerks write up deals, correspondents reports, analysts opinions; the head's own time (more
// with a partner) goes on courting, marriages, the family and borrowing, and covers deals and
// reports when the clerks and correspondents are all busy. Every decision checks and uses capacity
// only through checkCapacity and useCapacity.
import { runOver } from "./actions";
import type { Tuning } from "./tuning";
import type { Decision, GameState } from "./types";
import type { StaffRole } from "./systems/counting";

export type Pool = "deals" | "reports" | "opinions" | "head";
export const POOLS: Pool[] = ["deals", "reports", "opinions", "head"];

export const POOL_NAMES: Record<Pool, string> = {
  deals: "deals (clerks)",
  reports: "reports (correspondents)",
  opinions: "opinions (analysts)",
  head: "the head's time",
};

/** Decision kinds that use no capacity: they cost money or nothing, but no one's time. */
const FREE: ReadonlySet<string> = new Set(["set_reserve", "designate_heir", "answer_letter", "pay_slowly", "suspend", "hire", "dismiss", "build", "answer_family_letter", "match_wage", "choose_ambition"]);

const BY_KIND: Readonly<Record<string, Pool>> = {
  lend: "deals",
  buy_bond: "deals",
  invest_venture: "deals",
  call_loan: "deals",
  report: "reports",
  inquire: "reports",
  consult_analyst: "opinions",
  court_house: "head",
  arrange_marriage: "head",
  invest_family: "head",
  borrow: "head",
  send_to_study: "head",
  scheme: "head",
  counter_plot: "head",
  petition_title: "head",
  // C2, politics: the head's own time.
  stand_for_office: "head",
  cultivate_influence: "head",
  seek_court: "head",
  senate_assurance: "head",
};

/** The pool a decision kind draws on, or null if it uses no capacity. Kinds not listed (new systems' deals) are deals. */
export function poolFor(kind: Decision["kind"]): Pool | null {
  if (FREE.has(kind)) return null;
  return BY_KIND[kind] ?? "deals";
}

/** Pools that fall back to the head's time when empty. Opinions need an analyst. */
const FALLS_BACK: ReadonlySet<Pool> = new Set<Pool>(["deals", "reports"]);

/** Staff of `role` at work this quarter (hired before this quarter; those leaving at its end still work). */
export function workingCount(state: GameState, role: StaffRole): number {
  return state.counting.staff.filter((x) => x.role === role && x.start_turn <= state.world.turn).length;
}

/** A pool's size this quarter. */
export function poolSize(state: GameState, pool: Pool, tuning: Tuning): number {
  const c = tuning.capacity;
  switch (pool) {
    case "deals":
      return workingCount(state, "clerk") * c.per_clerk;
    case "reports":
      return workingCount(state, "correspondent") * c.per_correspondent;
    case "opinions":
      return workingCount(state, "analyst") * c.per_analyst;
    case "head": {
      const head = state.people.some((p) => p.is_head && p.death_year === null) ? c.head : 0;
      return head + (workingCount(state, "partner") > 0 ? c.partner : 0);
    }
  }
}

/** What is left in a pool this quarter. */
export function poolLeft(state: GameState, pool: Pool, tuning: Tuning): number {
  return Math.max(0, poolSize(state, pool, tuning) - state.counting.used[pool]);
}

/** Capacity left this quarter across every pool, for the UI's coins. */
export function capacityLeft(state: GameState, tuning: Tuning): number {
  return POOLS.reduce((sum, p) => sum + poolLeft(state, p, tuning), 0);
}

/** Capacity this quarter across every pool. */
export function capacityTotal(state: GameState, tuning: Tuning): number {
  return POOLS.reduce((sum, p) => sum + poolSize(state, p, tuning), 0);
}

/** The pool a decision of this kind would draw on now: its own, else the head's time if it may fall back, else null (none left). */
function drawFrom(state: GameState, pool: Pool, tuning: Tuning): Pool | null {
  if (poolLeft(state, pool, tuning) > 0) return pool;
  if (FALLS_BACK.has(pool) && poolLeft(state, "head", tuning) > 0) return "head";
  return null;
}

const NONE_LEFT: Record<Pool, string> = {
  deals: "No clerk is free this quarter, nor any of the head's time: hire a clerk or wait",
  reports: "No correspondent is free this quarter, nor any of the head's time: hire a correspondent or wait",
  opinions: "No analyst is free this quarter: hire an analyst or wait",
  head: "The head has no time left this quarter: a partner would share the work",
};

/** Why a decision of this kind can't be taken now (the run is over, or no capacity is left), or null. */
export function checkCapacity(state: GameState, kind: Decision["kind"], tuning: Tuning): string | null {
  const over = runOver(state, tuning);
  if (over === "bankrupt") return "The house is bankrupt";
  if (over === "finished") return "The run is over";
  const pool = poolFor(kind);
  if (pool === null || drawFrom(state, pool, tuning)) return null;
  return NONE_LEFT[pool];
}

/** Records that a decision of this kind used capacity. Mutates `state` (a draft copy). */
export function useCapacity(state: GameState, kind: Decision["kind"], tuning: Tuning): void {
  const pool = poolFor(kind);
  if (pool === null) return;
  const from = drawFrom(state, pool, tuning) ?? pool;
  state.counting.used[from] += 1;
  state.actions_this_turn += 1;
}
