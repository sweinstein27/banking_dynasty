import { addEntry } from "./ledger";
import type { GameData } from "./tuning";
import type { GameState } from "./types";

export function newGame(data: GameData): GameState {
  const s = data.tuning.start;
  const state: GameState = {
    world: {
      turn: 1,
      year: s.year,
      quarter: s.quarter,
      base_rate: s.base_rate,
      sentiment: s.sentiment,
    },
    house: {
      id: 1,
      name: s.house_name,
      city: s.city,
      cash: s.cash,
      deposits: s.deposits,
      reputation: s.reputation,
      reserve: s.reserve,
      status: "solvent",
    },
    loans: [],
    bonds: [],
    defaulted_states: [],
    ventures: [],
    ledger: [],
    next_ledger_id: 1,
    news: [],
    fired_events: [],
    risk_shift: {},
    trade_risk: 1,
    actions_this_turn: 0,
  };
  addEntry(state, "cash", "opening", s.cash, "Opening cash");
  addEntry(state, "deposits", "opening", s.deposits, "Opening deposits owed");
  return state;
}
