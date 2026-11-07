// The top bar: the house's crest, a readout for each resource, the date and End the quarter.
// Each readout is a button; a click opens the breakdown of where the number comes from.
import type { ReactNode } from "react";
import { gameData } from "../data";
import { unansweredLetters } from "../sim/letters";
import { readouts, type ReadoutId } from "./model/readouts";
import { Icon, type IconName } from "./icons";
import { BreakdownCard } from "./Breakdown";
import type { PanelId } from "./Panel";
import type { Game } from "./useGame";

const ICONS: Record<ReadoutId, IconName> = {
  cash: "cash", worth: "worth", reputation: "reputation", deposits: "deposits", upkeep: "upkeep", market: "market", date: "date",
};

export function TopBar({ game, over, onEndTurn, onOpen }: {
  game: Game;
  over: "bankrupt" | "finished" | null;
  onEndTurn: () => void;
  onOpen: (p: PanelId) => void;
}) {
  const { base, preview } = game;
  const unanswered = unansweredLetters(preview).length;
  const items = readouts(base, preview, gameData);

  return (
    <header className="topbar">
      <div className="crest">
        <span className="crest-seal" aria-hidden="true">{base.house.name.split(" ").at(-1)![0]}</span>
        <span className="crest-text">
          <span className="crest-name">{base.house.name}</span>
          <span className="crest-sub">{base.house.city}, seed {game.seed}</span>
        </span>
      </div>
      <div className="readouts">
        {items.map((r) => (
          <BreakdownCard key={r.id} id={r.id} base={base} preview={preview} onOpen={onOpen}>
            <Readout icon={ICONS[r.id]} label={r.label} tone={r.tone}>
              {r.value}
              {r.trend && <Icon name={r.trend} className={`trend trend-${r.trend}`} label={r.trendLabel} />}
            </Readout>
          </BreakdownCard>
        ))}
      </div>
      <button className="seal" onClick={onEndTurn} disabled={over !== null || unanswered > 0}>
        {over
          ? "The run is over"
          : unanswered > 0
            ? `Answer ${unanswered} letter${unanswered === 1 ? "" : "s"} first`
            : `End the quarter${game.queued.length ? ` (${game.queued.length})` : ""}`}
      </button>
    </header>
  );
}

/** The face of a readout: icon, small label and value. Rendered inside the breakdown's trigger button. */
function Readout({ icon, label, tone, children }: { icon: IconName; label: string; tone?: string; children: ReactNode }) {
  return (
    <>
      <Icon name={icon} className="readout-icon" />
      <span className="readout-text">
        <span className="readout-label">{label}</span>
        <span className={`readout-value ${tone ? `tone-${tone}` : ""}`}>{children}</span>
      </span>
    </>
  );
}
