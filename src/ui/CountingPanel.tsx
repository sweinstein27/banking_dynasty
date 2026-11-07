// The Counting House: capacity left in each pool, wages and upkeep, the reserve. Hiring and building
// get their own screen (The House) in wave 2.
import { useState } from "react";
import { gameData } from "../data";
import { capacityLeft, POOL_NAMES, POOLS, poolLeft, poolSize } from "../sim/capacity";
import { upkeepBill, wageBill } from "../sim/systems/counting";
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
      <dl className="accounts" aria-label="Capacity left this quarter">
        {POOLS.map((p) => (
          <div key={p} className="pool-row">
            <dt>{POOL_NAMES[p]}</dt>
            <dd>{poolLeft(state, p, tuning)} of {poolSize(state, p, tuning)} left</dd>
          </div>
        ))}
      </dl>
      <p className="small"><Term id="actions">Capacity</Term> comes from staff and the head's time. Wages this quarter {fl(wageBill(state, gameData))}, room upkeep {fl(upkeepBill(state, gameData))}.</p>
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
          Hiring, dismissing and building get their own screen, The House, in the next wave. Their wages and upkeep already count in the{" "}
          <Term id="upkeep">upkeep</Term>.
        </p>
      </div>
      {onDecide && <DecisionDialog kind={open ? "set_reserve" : null} state={state} onClose={() => setOpen(false)} onSubmit={onDecide} />}
    </div>
  );
}
