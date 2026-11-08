// Things that need the player's eye this quarter, in the style of a grand-strategy alert list.
// Each is a button that opens the panel where it can be dealt with. Read from the sim; no rules here.
import { gameData } from "../data";
import { capacityLeft, POOLS, poolLeft, type Pool } from "../sim/capacity";
import { inCrisis } from "../sim/crisis";
import { ageIn, headEffects, headOf, heirsOf, isTrained, successor, yearlyDeathChance } from "../sim/family";
import { unansweredLetters } from "../sim/letters";
import { openLots } from "../sim/finance/auctions";
import { openContracts } from "../sim/finance/contracts";
import { openHouseRequests } from "../sim/finance/houseLoans";
import { openCoverRequests } from "../sim/finance/insurance";
import { unansweredFamilyLetters } from "./model/people";
import { freeCash } from "../sim/reserves";
import { quartersLeft } from "../sim/ventures";
import { fl, keepUnits } from "./format";
import { Icon } from "./icons";
import { PageTurner, usePages } from "./Pager";
import type { GameState } from "../sim/types";
import type { PanelId } from "./Panel";
import type { Game } from "./useGame";

const ALERTS_PER_PAGE = 4;

interface Alert {
  key: string;
  tone: "bad" | "warn" | "info";
  text: string;
  panel: PanelId;
}

export function alertsFor(game: Game): Alert[] {
  const s = game.preview;
  const { tuning } = gameData;
  const out: Alert[] = [];
  const letters = unansweredLetters(s).length;
  if (letters) out.push({ key: "letters", tone: "warn", text: `${letters} letter${letters === 1 ? " awaits" : "s await"} your answer`, panel: "letters" });
  const family = unansweredFamilyLetters(s);
  if (family) out.push({ key: "family", tone: "warn", text: `${family} family letter${family === 1 ? " awaits" : "s await"} your answer`, panel: "family" });
  const contracts = openContracts(s).filter((c) => c.player_bid === null).length;
  if (contracts) out.push({ key: "contracts", tone: "info", text: `${contracts} state loan${contracts === 1 ? " is" : "s are"} open for bids`, panel: "finance" });
  const credit = openHouseRequests(s).length;
  if (credit) out.push({ key: "credit", tone: "info", text: `${credit === 1 ? "A house asks" : `${credit} houses ask`} for credit`, panel: "finance" });
  const lots = openLots(s).filter((l) => l.player_bid === null).length + openCoverRequests(s).length;
  if (lots) out.push({ key: "lots", tone: "info", text: `${lots} lot${lots === 1 ? "" : "s"} at auction or request${lots === 1 ? "" : "s"} for cover`, panel: "finance" });
  for (const b of s.europe.branches) {
    const c = s.europe.cities.find((x) => x.id === b.city);
    if (!c || (c.known.status === "peace" && c.known.mood !== "panic")) continue;
    const name = gameData.europe.cities.find((x) => x.id === b.city)?.name ?? b.city;
    out.push({ key: `branch${b.city}`, tone: "bad", text: `Your branch in ${name}: the city is ${c.known.status === "peace" ? "in panic" : c.known.status === "war" ? "at war" : "in unrest"}`, panel: "europe" });
  }
  if (s.panic_warning) {
    const n = s.panic_warning.turns_left;
    out.push({ key: "panic", tone: "bad", text: `Panic ${n === 1 ? "next quarter" : `in ${n} quarters`}: raise the reserve`, panel: "gazette" });
  }
  if (inCrisis(s)) out.push({ key: "crisis", tone: "bad", text: "Crisis measures are open at the Desk", panel: "ledger" });
  for (const d of s.debts.filter((x) => x.status === "active" && quartersLeft(s, x) <= 1)) {
    out.push({ key: `debt${d.id}`, tone: "bad", text: keepUnits(`${fl(d.principal)} owed to ${d.lender} falls due this quarter`), panel: "ledger" });
  }
  if (freeCash(s) <= 0 && s.house.reserve > 0) out.push({ key: "free", tone: "warn", text: "No free cash above the reserve", panel: "ledger" });
  const head = headOf(s);
  if (head) {
    const death = Math.min(1, yearlyDeathChance(ageIn(head, s.world.year), tuning) * headEffects(s, gameData).death_chance);
    const next = heirsOf(s).find((p) => p.id === s.house.designated_heir) ?? successor(s, gameData);
    if (!next) out.push({ key: "noheir", tone: "bad", text: "No heir: a distant cousin would take over", panel: "family" });
    else if (death >= 0.1 && !isTrained(next, s.world.year, gameData)) {
      out.push({ key: "untrained", tone: "warn", text: `${head.name.split(" ")[0]} is ${ageIn(head, s.world.year)}; ${next.name.split(" ")[0]} is not yet trained`, panel: "family" });
    }
  }
  const left = capacityLeft(s, tuning);
  if (left > 0) out.push({ key: "actions", tone: "info", text: `Capacity left this quarter: ${capacityWords(s)}`, panel: "counting" });
  return out;
}

const POOL_WORDS: Record<Pool, [string, string]> = {
  deals: ["deal", "deals"],
  reports: ["report", "reports"],
  opinions: ["opinion", "opinions"],
  head: ["call on the head's time", "calls on the head's time"],
};

/** "3 deals, 2 reports, 1 call on the head's time": what each pool has left, skipping empty ones. */
function capacityWords(s: GameState): string {
  return POOLS.map((p) => [p, poolLeft(s, p, gameData.tuning)] as const)
    .filter(([, n]) => n > 0)
    .map(([p, n]) => `${n} ${POOL_WORDS[p][n === 1 ? 0 : 1]}`)
    .join(", ");
}

export function Alerts({ game, onOpen }: { game: Game; onOpen: (p: PanelId) => void }) {
  const alerts = alertsFor(game);
  const pages = usePages(alerts, ALERTS_PER_PAGE);
  return (
    <section className="frame alerts" aria-label="Alerts">
      <header className="frame-head small-head">
        <Icon name="warning" />
        <h2>For your attention</h2>
      </header>
      {alerts.length === 0 ? (
        <p className="muted alerts-empty">Nothing presses this quarter.</p>
      ) : (
        <ul className="alert-list">
          {pages.items.map((a) => (
            <li key={a.key}>
              <button className={`alert tone-${a.tone}`} onClick={() => onOpen(a.panel)}>{a.text}</button>
            </li>
          ))}
        </ul>
      )}
      <PageTurner pages={pages} />
    </section>
  );
}
