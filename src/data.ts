// Loads data/*.json for scripts, tests and (later) the UI. Kept outside src/sim so the sim stays I/O free.
import borrowers from "../data/borrowers.json";
import counting from "../data/counting.json";
import credit from "../data/credit.json";
import markets from "../data/markets.json";
import events from "../data/events.json";
import family from "../data/family.json";
import houses from "../data/houses.json";
import traits from "../data/traits.json";
import states from "../data/states.json";
import tuning from "../data/tuning.json";
import ventures from "../data/ventures.json";
import type { CountingData } from "./sim/systems/counting";
import type { CreditData } from "./sim/systems/credit";
import type { MarketsData } from "./sim/systems/markets";
import type { BorrowerType, FamilyData, GameData, GameEvent, HousesData, TraitType, Tuning } from "./sim/tuning";

export const gameData: GameData = {
  tuning: tuning as Tuning,
  borrowers: borrowers as BorrowerType[],
  states,
  ventures,
  events: events as GameEvent[],
  family: family as FamilyData,
  traits: traits as TraitType[],
  houses: houses as HousesData,
  credit: credit as CreditData,
  counting: counting as CountingData,
  markets: markets as MarketsData,
};
