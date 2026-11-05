import type { GameState } from "./types";

/**
 * A copy of the state for a sim function to change. Everything is copied deeply except the
 * add-only histories (ledger, news, fired events, successions, year ends): those get new lists
 * holding the same entries, because an entry is never changed after it is written. Deep-copying
 * them made every turn cost more than the last (the ledger reaches about 3,000 entries by 1850).
 */
export function cloneState(state: GameState): GameState {
  const { ledger, news, fired_events, successions, year_ends, ...rest } = state;
  return {
    ...structuredClone(rest),
    ledger: [...ledger],
    news: [...news],
    fired_events: [...fired_events],
    successions: [...successions],
    year_ends: [...year_ends],
  };
}
