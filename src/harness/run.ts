// One harness run: a strategy plays a seed from 1815 to the end (or bankruptcy), and the run is
// boiled down to one row of numbers, plus a row for each year end.
import { runOver } from "../sim/actions";
import { newGame } from "../sim/init";
import { createRng } from "../sim/rng";
import type { GameData } from "../sim/tuning";
import { endTurn, netWorth } from "../sim/turn";
import type { Decision } from "../sim/types";
import type { Strategy } from "./common";

/** One run, as a row of runs.csv. Amounts are whole gulden. */
export interface RunRow {
  strategy: string;
  seed: number;
  outcome: "finished" | "bankrupt";
  /** The last turn played (144 for a full run). */
  last_turn: number;
  final_net_worth: number;
  peak_net_worth: number;
  low_net_worth: number;
  final_reputation: number;
  defaults: number;
  default_loss: number;
  panic_quarters: number;
  forced_sales: number;
  state_defaults: number;
  ventures_paid: number;
  ventures_failed: number;
  successions: number;
  untrained_successions: number;
  family_spend: number;
  borrowings: number;
  suspensions: number;
}

/** Net change to one ledger account from one category over a run, as a row of flows.csv. */
export interface FlowRow {
  strategy: string;
  seed: number;
  account: string;
  category: string;
  amount: number;
}

/** One year end of one run, as a row of years.csv. */
export interface YearRow {
  strategy: string;
  seed: number;
  year: number;
  net_worth: number;
  reputation: number;
}

/** Plays `strategy` on `seed` to the end of the run and summarises it. */
export function runOnce(name: string, strategy: Strategy, seed: number, data: GameData): { run: RunRow; years: YearRow[]; flows: FlowRow[] } {
  const rng = createRng(seed);
  let s = newGame(data, rng);
  let peak = netWorth(s);
  let low = peak;
  let panicQuarters = 0;
  const decisions: Decision[] = [];
  while (!runOver(s, data.tuning)) {
    if (s.world.sentiment === "panic") panicQuarters++;
    const ds = strategy(s, data);
    decisions.push(...ds);
    s = endTurn(s, ds, rng, data);
    const nw = netWorth(s);
    peak = Math.max(peak, nw);
    low = Math.min(low, nw);
  }
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const entries = (account: string, category: string) => s.ledger.filter((e) => e.account === account && e.category === category);
  const defaults = entries("loans", "default");
  const run: RunRow = {
    strategy: name,
    seed,
    outcome: s.house.status === "bankrupt" ? "bankrupt" : "finished",
    last_turn: s.world.turn - 1,
    final_net_worth: netWorth(s),
    peak_net_worth: peak,
    low_net_worth: low,
    final_reputation: s.house.reputation,
    defaults: defaults.length,
    default_loss: -sum(defaults.map((e) => e.amount)),
    panic_quarters: panicQuarters,
    forced_sales: entries("cash", "forced_sale").length,
    state_defaults: s.defaulted_states.length,
    ventures_paid: s.ventures.filter((v) => v.status === "paid_out").length,
    ventures_failed: s.ventures.filter((v) => v.status === "failed").length,
    successions: s.successions.length,
    untrained_successions: s.successions.filter((x) => !x.trained).length,
    family_spend: -sum(entries("cash", "family").map((e) => e.amount)),
    borrowings: decisions.filter((d) => d.kind === "borrow").length,
    suspensions: decisions.filter((d) => d.kind === "suspend").length,
  };
  const years = s.year_ends.map((y) => ({ strategy: name, seed, year: y.year, net_worth: y.net_worth, reputation: y.reputation }));
  const totals = new Map<string, number>();
  for (const e of s.ledger) {
    if (e.category === "opening") continue;
    const key = `${e.account},${e.category}`;
    totals.set(key, (totals.get(key) ?? 0) + e.amount);
  }
  const flows = [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([key, amount]) => {
    const [account, category] = key.split(",") as [string, string];
    return { strategy: name, seed, account, category, amount };
  });
  return { run, years, flows };
}
