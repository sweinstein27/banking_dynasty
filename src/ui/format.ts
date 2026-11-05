// Display helpers. Every amount shows its unit.
import type { WorldState } from "../sim/types";

export const fl = (n: number) => `${n.toLocaleString("en-US")} fl.`;
export const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
export const signedFl = (n: number) => `${n > 0 ? "+" : ""}${fl(n)}`;
export const dateLabel = (w: Pick<WorldState, "year" | "quarter">) => `${w.year} Q${w.quarter}`;

/** Parses a typed amount ("12,000" or "12000") to a number, or NaN. The sim decides if it is valid. */
export const parseAmount = (text: string) => (text.trim() === "" ? NaN : Number(text.replace(/[,\s]/g, "")));
