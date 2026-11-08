import { createBorrowers, drawRequests } from "./borrowers";
import { createFamily } from "./family";
import { createHouses } from "./houses";
import { createCounting } from "./systems/counting";
import { createCredit } from "./systems/credit";
import { createMarkets } from "./systems/markets";
import { createFinance } from "./systems/finance";
import { createPeople } from "./systems/people";
import { createEurope } from "./systems/europe";
import { createProgress } from "./systems/progress";
import { createRivals } from "./systems/rivals";
import { createLegacy } from "./systems/legacy";
import { createPolitics } from "./systems/politics";
import { createWar } from "./systems/war";

import { addEntry } from "./ledger";
import type { Rng } from "./rng";
import type { GameData } from "./tuning";
import type { GameState } from "./types";

/**
 * A new game at the start date. Draws the borrowers and the first quarter's loan requests from
 * `rng`, so the same seed gives the same borrowers; pass the run's RNG, then keep using it.
 */
export function newGame(data: GameData, rng: Rng): GameState {
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
      designated_heir: null,
    },
    loans: [],
    bonds: [],
    defaulted_states: [],
    ventures: [],
    borrowers: createBorrowers(data, rng),
    people: createFamily(data, rng),
    successions: [],
    year_ends: [],
    requests: [],
    ledger: [],
    next_ledger_id: 1,
    news: [],
    fired_events: [],
    credit: {} as GameState["credit"],
    counting: {} as GameState["counting"],
    markets: {} as GameState["markets"],
    finance: {} as GameState["finance"],
    agendas: {} as GameState["agendas"],
    europe: {} as GameState["europe"],
    progress: {} as GameState["progress"],
    rivals: {} as GameState["rivals"],
    legacy: {} as GameState["legacy"],
    politics: {} as GameState["politics"],
    war: {} as GameState["war"],
    marriages: [],
    houses: createHouses(data),
    letters: [],
    letter_outcomes: [],
    scheduled_events: [],
    risk_shift: {},
    trade_risk: 1,
    panic_warning: null,
    debts: [],
    withdrawal_policy: "normal",
    actions_this_turn: 0,
  };
  // Each system's starting state, after the core state (so any rolls come after the family's).
  state.credit = createCredit(data, rng);
  state.counting = createCounting(data, rng);
  state.markets = createMarkets(data, rng);
  state.finance = createFinance(data, rng);
  state.agendas = createPeople(data, rng);
  state.europe = createEurope(data, rng);
  state.progress = createProgress(data, rng);
  state.rivals = createRivals(data, rng);
  state.legacy = createLegacy(data, rng);
  state.politics = createPolitics(data, rng);
  state.war = createWar(data, rng);
  addEntry(state, "cash", "opening", s.cash, "Opening cash");
  addEntry(state, "deposits", "opening", s.deposits, "Opening deposits owed");
  state.requests = drawRequests(state, data, rng);
  return state;
}
