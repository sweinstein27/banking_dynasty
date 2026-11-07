// Things that need the player's eye this quarter, in the style of a grand-strategy alert list.
// Each is a button that opens the panel where it can be dealt with. Read from the sim; no rules here.
import { gameData } from "../data";
import { capacityLeft } from "../sim/capacity";
import { inCrisis } from "../sim/crisis";
import { ageIn, headEffects, headOf, heirsOf, isTrained, successor, yearlyDeathChance } from "../sim/family";
import { unansweredLetters } from "../sim/letters";
import { freeCash } from "../sim/reserves";
import { quartersLeft } from "../sim/ventures";
import { fl, keepUnits } from "./format";
import { Icon } from "./icons";
import { PageTurner, usePages } from "./Pager";
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
  if (left > 0) out.push({ key: "actions", tone: "info", text: `${left} action${left === 1 ? "" : "s"} left this quarter`, panel: "counting" });
  return out;
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
