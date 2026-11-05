// Loads data/*.json for scripts, tests and (later) the UI. Kept outside src/sim so the sim stays I/O free.
import borrowerNames from "../data/borrowers.json";
import events from "../data/events.json";
import states from "../data/states.json";
import tuning from "../data/tuning.json";
import ventures from "../data/ventures.json";
import type { GameData, GameEvent, Tuning } from "./sim/tuning";

export const gameData: GameData = {
  tuning: tuning as Tuning,
  borrower_names: borrowerNames,
  states,
  ventures,
  events: events as GameEvent[],
};
