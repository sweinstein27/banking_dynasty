import { netWorth } from "../sim/turn";
import type { GameState } from "../sim/types";
import { dateLabel, fl, previousQuarter } from "./format";

export function GameOver({ state, reason, seed, onNewGame, onSave }: {
  state: GameState;
  reason: "bankrupt" | "finished";
  seed: number;
  onNewGame: () => void;
  onSave: () => void;
}) {
  const last = dateLabel(previousQuarter(state.world));
  const worth = netWorth(state);

  return (
    <section className={`game-over game-over-${reason}`}>
      <h2>{reason === "bankrupt" ? "The house is bankrupt" : "The run is complete"}</h2>
      <p>
        {reason === "bankrupt"
          ? `${state.house.name} could not meet its obligations in ${last}, even after selling its assets.`
          : `${state.house.name} has traded from 1815 to the end of 1850.`}
      </p>
      <p className="final-worth">Final net worth: {fl(worth)}</p>
      <p className="muted">Seed {seed}, {state.world.turn - 1} quarters played. The panels below show the final books.</p>
      <div className="row">
        <button className="primary" onClick={onNewGame}>New game</button>
        <button className="secondary" onClick={onSave}>Save this game</button>
      </div>
    </section>
  );
}
