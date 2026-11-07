// The Counting House: a placeholder until the counting-house milestone (A2) brings staff and
// facilities. For now it shows the quarter's actions, the reserve, and sets the reserve.
import { useState } from "react";
import { gameData } from "../data";
import { capacityLeft } from "../sim/capacity";
import { freeCash } from "../sim/reserves";
import type { Decision, GameState } from "../sim/types";
import { DecisionDialog } from "./DecisionDialogs";
import { fl } from "./format";
import { Term } from "./Term";

export function CountingPanel({ state, onDecide }: { state: GameState; onDecide?: (d: Decision) => string | null }) {
  const [open, setOpen] = useState(false);
  const { tuning } = gameData;
  const left = capacityLeft(state, tuning);
  return (
    <div className="doc counting">
      <h3>This quarter</h3>
      <div className="coins big" aria-label={`${left} of ${tuning.actions_per_turn} actions left this quarter`}>
        {Array.from({ length: tuning.actions_per_turn }, (_, i) => <span key={i} className={i < left ? "coin" : "coin spent"} />)}
        <span className="coins-label">{left} of {tuning.actions_per_turn} <Term id="actions">actions</Term> left</span>
      </div>
      <h3>The strongroom</h3>
      <dl className="accounts">
        <dt><Term id="cash">Cash</Term></dt><dd>{fl(state.house.cash)}</dd>
        <dt><Term id="reserve">Reserve</Term></dt><dd>{fl(state.house.reserve)}</dd>
        <dt><Term id="free_cash">Free cash</Term></dt><dd>{fl(freeCash(state))}</dd>
      </dl>
      {onDecide && (
        <div className="row page-actions">
          <button className="primary" disabled={left === 0} onClick={() => setOpen(true)}>Set reserves</button>
        </div>
      )}
      <div className="placeholder">
        <h3>Staff and rooms</h3>
        <p>
          Clerks, correspondents, tellers and a partner; a counting room, a strongroom, an archive and reception rooms. They will set how much the
          house can do each quarter, in place of the three actions, and their wages join the <Term id="upkeep">upkeep</Term>. They come with the
          counting house milestone.
        </p>
      </div>
      {onDecide && <DecisionDialog kind={open ? "set_reserve" : null} state={state} onClose={() => setOpen(false)} onSubmit={onDecide} />}
    </div>
  );
}
