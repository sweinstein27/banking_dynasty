// Seeded RNG (mulberry32). All sim randomness goes through an Rng passed in as an argument.

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
}

export interface SeededRng extends Rng {
  /** Internal state, so a save can resume the same sequence. */
  readonly state: number;
}

export function createRng(seed: number): SeededRng {
  let s = seed >>> 0;
  return {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    get state() {
      return s;
    },
  };
}
