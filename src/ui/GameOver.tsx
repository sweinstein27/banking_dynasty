// The end of a run: the verdict, the final net worth, and the chronicle of the house, paged. It takes
// the Desk's place; the panels stay open read-only for the final books.
import { gameData } from "../data";
import { chronicle } from "../sim/chronicle";
import { netWorth } from "../sim/turn";
import type { GameState } from "../sim/types";
import { dateLabel, fl, keepUnits, previousQuarter } from "./format";
import { PageTurner, usePages } from "./Pager";

// The chronicle shares the screen with the open panel, so a spread holds three paragraphs.
const PARAGRAPHS_PER_PAGE = 3;

export function GameOver({ state, reason, seed, onNewGame, onSave }: {
  state: GameState;
  reason: "bankrupt" | "finished";
  seed: number;
  onNewGame: () => void;
  onSave: () => void;
}) {
  const last = dateLabel(previousQuarter(state.world));
  const pages = usePages(chronicle(state, gameData), PARAGRAPHS_PER_PAGE);

  return (
    <section className={`frame game-over game-over-${reason}`} aria-label="The end of the run">
      <div className="doc chronicle-doc">
      <header>
        <h2>{reason === "bankrupt" ? "The house is bankrupt" : "The run is complete"}</h2>
        <p>
          {reason === "bankrupt"
            ? `${state.house.name} could not meet its obligations in ${last}, even after selling its assets.`
            : `${state.house.name} has traded from 1815 to the end of 1850.`}
        </p>
        <p className="final-worth">Final net worth: {fl(netWorth(state))}</p>
        <p className="muted small">Seed {seed}, {state.world.turn - 1} quarters played.</p>
      </header>
      <h3>The chronicle of the house</h3>
      <div className="chronicle">
        {pages.items.map((para, i) => <p key={i}>{keepUnits(para)}</p>)}
      </div>
      <PageTurner pages={pages} label="Page" />
      <div className="row">
        <button className="primary" onClick={onNewGame}>New game</button>
        <button className="secondary" onClick={onSave}>Save this game</button>
      </div>
      <p className="muted small">The final books stay open in the panels on the left.</p>
      </div>
    </section>
  );
}
