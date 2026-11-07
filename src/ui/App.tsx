// The grand-strategy shell: a top bar of readouts, a side menu of panels, the open panel on the
// left and the Desk on the right. One panel is open at a time; the Gazette is home, and a new
// quarter opens on its new issue.
import { useEffect, useState } from "react";
import { gameData } from "../data";
import { runOver } from "../sim/actions";
import { Alerts } from "./Alerts";
import { BoursePanel } from "./BoursePanel";
import { CountingPanel } from "./CountingPanel";
import { LettersPanel } from "./LettersPanel";
import { Desk } from "./Desk";
import { FamilyPanel } from "./FamilyPanel";
import { downloadText, pickTextFile } from "./files";
import { Gazette } from "./Gazette";
import { GameMenu } from "./GameMenu";
import { GameOver } from "./GameOver";
import { HousesView } from "./HousesView";
import { LedgerBook } from "./LedgerBook";
import { NewGame } from "./NewGame";
import { PanelFrame, type PanelId } from "./Panel";
import { SideMenu } from "./SideMenu";
import { TopBar } from "./TopBar";
import { useGame } from "./useGame";

export function App() {
  const api = useGame();
  const [onStartScreen, setOnStartScreen] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelId>("gazette");
  const [menuOpen, setMenuOpen] = useState(false);
  const { game } = api;
  const turn = game?.base.world.turn;

  // Each new quarter (or a newly loaded game) opens on the Gazette's new issue.
  useEffect(() => setPanel("gazette"), [turn, game?.seed]);

  const load = async () => {
    const text = await pickTextFile();
    if (text === null) return;
    const reason = api.load(text);
    setLoadError(reason);
    if (!reason) {
      setOnStartScreen(false);
      setMenuOpen(false);
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
        }}
        onLoad={load}
        onResume={game ? () => setOnStartScreen(false) : null}
        error={loadError}
      />
    );
  }

  const { base, preview } = game;
  const over = runOver(base, gameData.tuning);
  const decide = over ? undefined : api.queue;

  return (
    <div className="screen">
      <TopBar game={game} over={over} onEndTurn={api.endTurn} onOpen={setPanel} />
      <div className="main">
        <SideMenu open={panel} onOpen={setPanel} state={preview} onMenu={() => setMenuOpen(true)} />
        <PanelFrame id={panel} onClose={panel === "gazette" ? undefined : () => setPanel("gazette")}>
          {panel === "gazette" && <Gazette key={base.world.turn} state={base} />}
          {panel === "ledger" && <LedgerBook base={base} preview={preview} />}
          {panel === "houses" && <HousesView state={preview} onCourt={over ? undefined : (house) => api.queue({ kind: "court_house", house })} />}
          {panel === "family" && <FamilyPanel state={preview} onDecide={decide} />}
          {panel === "bourse" && <BoursePanel state={preview} onDecide={decide} />}
          {panel === "counting" && <CountingPanel state={preview} onDecide={decide} />}
          {panel === "letters" && <LettersPanel state={preview} onDecide={decide} />}
        </PanelFrame>
        {over ? (
          <GameOver state={base} reason={over} seed={game.seed} onNewGame={() => setOnStartScreen(true)} onSave={save} />
        ) : (
          <div className="right-column">
            <Desk api={api} game={game} />
            <Alerts game={game} onOpen={setPanel} />
          </div>
        )}
      </div>
      <GameMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onSave={save}
        onLoad={load}
        onNew={() => { setMenuOpen(false); setOnStartScreen(true); }}
        error={loadError}
      />
    </div>
  );
}
