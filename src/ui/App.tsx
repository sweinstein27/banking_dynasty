import { useState } from "react";
import { gameData } from "../data";
import { runOver } from "../sim/actions";
import { Desk } from "./Desk";
import { FamilyPanel } from "./FamilyPanel";
import { downloadText, pickTextFile } from "./files";
import { seasonLabel, previousQuarter } from "./format";
import { Gazette } from "./Gazette";
import { GameOver, RunOverCard } from "./GameOver";
import { LedgerBook } from "./LedgerBook";
import { NewGame } from "./NewGame";
import { useGame } from "./useGame";

/** Market mood as a barometer reading. */
const BAROMETER = { calm: "Fair", uneasy: "Changeable", panic: "Stormy" } as const;

export function App() {
  const api = useGame();
  const [onStartScreen, setOnStartScreen] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showBooks, setShowBooks] = useState(false);
  const { game } = api;

  const load = async () => {
    const text = await pickTextFile();
    if (text === null) return;
    const reason = api.load(text);
    setLoadError(reason);
    if (!reason) {
      setOnStartScreen(false);
      setShowBooks(false);
    }
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
          setShowBooks(false);
        }}
        onLoad={load}
        onResume={game ? () => setOnStartScreen(false) : null}
        error={loadError}
      />
    );
  }

  const { base, preview } = game;
  const over = runOver(base, gameData.tuning);
  const mood = base.world.sentiment;

  return (
    <div className="screen">
      <header className="masthead">
        <div className="house">
          <h1>{base.house.name}</h1>
          <span className="small">{base.house.city}, seed {game.seed}</span>
        </div>
        <div className="date">
          <span className="season">{over ? `After ${seasonLabel(previousQuarter(base.world))}` : seasonLabel(base.world)}</span>
          {!over && <span className="small">Quarter {base.world.turn} of 144</span>}
        </div>
        <div className={`barometer mood-${mood}`} aria-label={`Market: ${BAROMETER[mood]}`}>
          <div className="dial" aria-hidden="true">
            <span className="needle" />
          </div>
          <div className="barometer-text">
            <span className="small">The market</span>
            <span className="reading">{BAROMETER[mood]}</span>
            {base.panic_warning && !over && <span className="warning-chip">Panic in {base.panic_warning.turns_left} qtr</span>}
          </div>
        </div>
        <div className="masthead-buttons">
          <button className="secondary" onClick={save}>Save</button>
          <button className="secondary" onClick={() => setOnStartScreen(true)}>New or load</button>
          <button className="seal" onClick={api.endTurn} disabled={over !== null}>
            End the quarter{game.queued.length ? ` (${game.queued.length})` : ""}
          </button>
        </div>
      </header>

      {over && !showBooks ? (
        <main className="ending">
          <GameOver state={base} reason={over} seed={game.seed} onNewGame={() => setOnStartScreen(true)} onSave={save} onShowBooks={() => setShowBooks(true)} />
        </main>
      ) : (
        <main className="desk-grid">
          <Gazette key={base.world.turn} state={base} />
          <LedgerBook base={base} preview={preview} />
          {over ? <RunOverCard onChronicle={() => setShowBooks(false)} /> : <Desk api={api} game={game} />}
          <FamilyPanel state={preview} />
        </main>
      )}
    </div>
  );
}
