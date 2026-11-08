// What each harness strategy does with the rivals system. Owned by the rivals session; empty until then.
import type { GameData } from "../../sim/tuning";
import type { GameState } from "../../sim/types";
import type { Maker, SystemMakers } from "../common";

/** Makers for strategy `name`: `early` ones go before its other wants, `late` ones after. */
export function rivalsMakers(_name: string, _state: GameState, _data: GameData): SystemMakers {
  const none: Maker[] = [];
  return { early: none, late: none };
}
