import type { Rng } from "../src/sim/rng";

/** An Rng that returns the given values in order, then repeats the last one. */
export function fixedRng(...values: number[]): Rng {
  let i = 0;
  return { next: () => values[Math.min(i++, values.length - 1)]! };
}

/** Never triggers a default (every roll is the highest possible value). */
export const noDefaults: Rng = { next: () => 0.999999 };
