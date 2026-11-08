// Loads data/*.json for scripts, tests and (later) the UI. Kept outside src/sim so the sim stays I/O free.
import borrowers from "../data/borrowers.json";
import counting from "../data/counting.json";
import credit from "../data/credit.json";
import markets from "../data/markets.json";
import financeJson from "../data/finance.json";
import peopleJson from "../data/people.json";
import europeJson from "../data/europe.json";
import progressJson from "../data/progress.json";
import rivalsJson from "../data/rivals.json";
import legacyJson from "../data/legacy.json";
import politicsJson from "../data/politics.json";
import warJson from "../data/war.json";

import events from "../data/events.json";
import family from "../data/family.json";
import houses from "../data/houses.json";
import traits from "../data/traits.json";
import states from "../data/states.json";
import tuning from "../data/tuning.json";
import ventures from "../data/ventures.json";
import type { CountingData } from "./sim/systems/counting";
import type { CreditData } from "./sim/systems/credit";
import type { FinanceData } from "./sim/systems/finance";
import type { PeopleData } from "./sim/systems/people";
import type { EuropeData } from "./sim/systems/europe";
import type { ProgressData } from "./sim/systems/progress";
import type { RivalsData } from "./sim/systems/rivals";
import type { LegacyData } from "./sim/systems/legacy";
import type { PoliticsData } from "./sim/systems/politics";
import type { WarData } from "./sim/systems/war";
import type { MarketsData } from "./sim/systems/markets";
import type { BorrowerType, FamilyData, GameData, GameEvent, HousesData, TraitType, Tuning, VentureType } from "./sim/tuning";

export const gameData: GameData = {
  tuning: tuning as Tuning,
  borrowers: borrowers as BorrowerType[],
  states,
  ventures: ventures as VentureType[],
  events: events as GameEvent[],
  family: family as FamilyData,
  traits: traits as TraitType[],
  houses: houses as HousesData,
  credit: credit as CreditData,
  counting: counting as CountingData,
  markets: markets as MarketsData,
  finance: financeJson as FinanceData,
  people: peopleJson as PeopleData,
  europe: europeJson as EuropeData,
  progress: progressJson as ProgressData,
  rivals: rivalsJson as RivalsData,
  legacy: legacyJson as LegacyData,
  politics: politicsJson as PoliticsData,
  war: warJson as WarData,
};
