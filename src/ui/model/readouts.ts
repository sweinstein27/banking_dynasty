// The numbers on the top bar. Pure: the same functions the breakdowns use.
import { runOver } from "../../sim/actions";
import { fl } from "../../sim/format";
import { freeCash } from "../../sim/reserves";
import type { GameData } from "../../sim/tuning";
import { netWorth } from "../../sim/turn";
import type { GameState } from "../../sim/types";
import { lastTurn, moodWord, quartersInRun, upkeepTotal, worthBefore, type BreakdownId } from "./breakdowns";

export type ReadoutId = BreakdownId;

export interface Readout {
  id: ReadoutId;
  label: string;
  value: string;
  tone?: "good" | "bad" | "warn";
  trend?: "up" | "down" | "level";
  trendLabel?: string;
}

const SEASONS = ["Winter", "Spring", "Summer", "Autumn"];

export function readouts(base: GameState, preview: GameState, data: GameData): Readout[] {
  const s = preview.world.sentiment;
  const over = runOver(base, data.tuning);
  const change = lastTurn(base) > 0 ? netWorth(base) - worthBefore(base) : 0;
  const trend = change > 0 ? "up" : change < 0 ? "down" : "level";
  const { year, quarter, turn } = preview.world;
  const played = quarter === 1 ? { year: year - 1, q: 4 } : { year, q: quarter - 1 };
  return [
    { id: "cash", label: "Cash", value: fl(preview.house.cash), tone: freeCash(preview) <= 0 && preview.house.reserve > 0 ? "warn" : undefined },
    {
      id: "worth", label: "Net worth", value: fl(netWorth(preview)), tone: netWorth(preview) < 0 ? "bad" : undefined,
      trend, trendLabel: change === 0 ? "level last quarter" : `${change > 0 ? "up" : "down"} ${fl(Math.abs(change))} last quarter`,
    },
    { id: "reputation", label: "Reputation", value: String(preview.house.reputation), tone: preview.house.reputation < 30 ? "bad" : undefined },
    { id: "deposits", label: "Deposits", value: fl(preview.house.deposits) },
    { id: "upkeep", label: "Upkeep a qtr", value: fl(upkeepTotal(preview, data)) },
    {
      id: "market", label: preview.panic_warning ? `Panic in ${preview.panic_warning.turns_left} qtr` : "The market",
      value: moodWord(s), tone: s === "calm" && !preview.panic_warning ? "good" : s === "panic" || preview.panic_warning ? "bad" : "warn",
    },
    {
      id: "date",
      label: over ? "The run is over" : `Quarter ${turn} of ${quartersInRun(data)}`,
      value: over ? `After ${SEASONS[played.q - 1]} ${played.year}` : `${SEASONS[quarter - 1]} ${year}`,
    },
  ];
}
