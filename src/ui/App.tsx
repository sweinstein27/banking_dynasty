import { useState } from "react";
import { gameData } from "../data";
import { runOver } from "../sim/actions";
import { DecisionsPanel } from "./DecisionsPanel";
import { FamilyPanel } from "./FamilyPanel";
import { dateLabel } from "./format";
import { LedgerPanel } from "./LedgerPanel";
import { NewGame } from "./NewGame";
import { NewsPanel } from "./NewsPanel";
import { useGame } from "./useGame";

export function App() {
  const api = useGame();
  const [loadError, setLoadError] = useState<string | null>(null);
  const { game } = api;

  if (!game) return <NewGame onStart={api.newGame} onLoad={() => {}} error={loadError} />;

  const { base, preview } = game;
  const over = runOver(base, gameData.tuning);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <strong>{base.house.name}</strong>, {base.house.city}. {dateLabel(base.world)} (turn {base.world.turn}). Market: <span className={`mood-${base.world.sentiment}`}>{base.world.sentiment}</span>. Base rate {(base.world.base_rate * 100).toFixed(1)}%. Seed {game.seed}.
        </div>
        <button className="primary end-turn" onClick={api.endTurn} disabled={over !== null}>
          End Turn{game.queued.length ? ` (${game.queued.length} queued)` : ""}
        </button>
      </header>
      <div className="grid">
        <NewsPanel state={base} />
        <LedgerPanel base={base} preview={preview} />
        <FamilyPanel state={preview} />
        <DecisionsPanel api={api} game={game} disabled={over !== null} />
      </div>
    </div>
  );
}
