import { useState } from "react";
import { gameData } from "../data";
import { runOver } from "../sim/actions";
import { DecisionsPanel } from "./DecisionsPanel";
import { FamilyPanel } from "./FamilyPanel";
import { downloadText, pickTextFile } from "./files";
import { dateLabel, previousQuarter } from "./format";
import { GameOver } from "./GameOver";
import { LedgerPanel } from "./LedgerPanel";
import { NewGame } from "./NewGame";
import { NewsPanel } from "./NewsPanel";
import { useGame } from "./useGame";

export function App() {
  const api = useGame();
  const [onStartScreen, setOnStartScreen] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { game } = api;

  const load = async () => {
    const text = await pickTextFile();
    if (text === null) return;
    const reason = api.load(text);
    setLoadError(reason);
    if (!reason) setOnStartScreen(false);
  };

  const save = () => {
    const text = api.saveText();
    if (!game || !text) return;
    downloadText(`banking-dynasty-seed${game.seed}-${game.base.world.year}Q${game.base.world.quarter}.json`, text);
  };

  if (!game || onStartScreen) {
    return (
      <NewGame
        onStart={(seed) => {
          api.newGame(seed);
          setLoadError(null);
          setOnStartScreen(false);
        }}
        onLoad={load}
        onResume={game ? () => setOnStartScreen(false) : null}
        error={loadError}
      />
    );
  }

  const { base, preview } = game;
  const over = runOver(base, gameData.tuning);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <strong>{base.house.name}</strong>, {base.house.city}. {over ? `Run over after ${dateLabel(previousQuarter(base.world))}` : `${dateLabel(base.world)} (turn ${base.world.turn})`}. Market: <span className={`mood-${base.world.sentiment}`}>{base.world.sentiment}</span>. Base rate {(base.world.base_rate * 100).toFixed(1)}%. Seed {game.seed}.
          {base.panic_warning && !over && <span className="warning-chip"> Panic in {base.panic_warning.turns_left} qtr</span>}
        </div>
        <div className="row topbar-buttons">
          <button className="secondary" onClick={save}>Save game</button>
          <button className="secondary" onClick={() => setOnStartScreen(true)}>New or load</button>
          <button className="primary end-turn" onClick={api.endTurn} disabled={over !== null}>
            End Turn{game.queued.length ? ` (${game.queued.length} queued)` : ""}
          </button>
        </div>
      </header>
      {over && <GameOver state={base} reason={over} seed={game.seed} onNewGame={() => setOnStartScreen(true)} onSave={save} />}
      <div className="grid">
        <NewsPanel state={base} />
        <LedgerPanel base={base} preview={preview} />
        <FamilyPanel state={preview} />
        {!over && <DecisionsPanel api={api} game={game} disabled={false} />}
      </div>
    </div>
  );
}
