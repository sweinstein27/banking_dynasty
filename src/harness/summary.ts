// Summary statistics over many harness runs, one line per strategy.
import type { GameData } from "../sim/tuning";
import type { RunRow } from "./run";

/**
 * A "strong 1850 finish" (the spec's success test, which sets no number): final net worth of at
 * least three times the starting 50,000 fl. A measure of the harness, not a game rule.
 */
export const STRONG_FINISH = 150_000;

/** Net worth at the start of every game: opening cash less opening deposits. */
export const startNetWorth = (data: GameData) => data.tuning.start.cash - data.tuning.start.deposits;

/**
 * The p-th percentile (0 to 1) of `values` by linear interpolation between the closest ranks, the
 * method numpy and pandas use by default. Null for no values.
 */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface StrategySummary {
  strategy: string;
  runs: number;
  bankrupt_rate: number;
  mean: number;
  p10: number;
  median: number;
  p90: number;
  /** Share of runs ending above the starting net worth. */
  above_start: number;
  /** Share of runs ending at STRONG_FINISH or more (a bankrupt run never counts). */
  strong: number;
}

/** One summary per strategy, in the order strategies first appear in `rows`. */
export function summarize(rows: RunRow[], data: GameData, strong = STRONG_FINISH): StrategySummary[] {
  const names = [...new Set(rows.map((r) => r.strategy))];
  const start = startNetWorth(data);
  return names.map((strategy) => {
    const rs = rows.filter((r) => r.strategy === strategy);
    const worths = rs.map((r) => r.final_net_worth);
    const share = (f: (r: RunRow) => boolean) => rs.filter(f).length / rs.length;
    return {
      strategy,
      runs: rs.length,
      bankrupt_rate: share((r) => r.outcome === "bankrupt"),
      mean: worths.reduce((a, b) => a + b, 0) / rs.length,
      p10: percentile(worths, 0.1)!,
      median: percentile(worths, 0.5)!,
      p90: percentile(worths, 0.9)!,
      above_start: share((r) => r.final_net_worth > start),
      strong: share((r) => r.outcome === "finished" && r.final_net_worth >= strong),
    };
  });
}
