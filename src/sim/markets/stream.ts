// The markets' own random stream. Markets and ventures roll every quarter; drawing those rolls from
// the run's RNG would shift every other system's rolls. Instead the stream is seeded once from the
// run's RNG at the start (createMarkets) and its state is kept in state.markets.rng_state, so runs
// stay reproducible from the seed and saves resume it exactly.
import { createRng, type Rng } from "../rng";
import type { GameState } from "../types";

/** Runs `fn` with the markets' stream and stores where it got to. Mutates `state`. */
export function withMarketsRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = createRng(state.markets.rng_state);
  const out = fn(rng);
  state.markets.rng_state = rng.state;
  return out;
}
