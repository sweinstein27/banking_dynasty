import { useState } from "react";
import { gameData } from "../data";
import { actionsLeft } from "../sim/actions";
import { inCrisis } from "../sim/crisis";
import type { Decision, GameState } from "../sim/types";
import { CRISIS_KINDS, DECISION_LABELS, DecisionDialog, type DecisionKind } from "./DecisionDialogs";
import { fl, pct } from "./format";
import type { Game, GameApi } from "./useGame";

const KINDS: DecisionKind[] = ["lend", "report", "buy_bond", "invest_venture", "set_reserve", "invest_family"];

export function DecisionsPanel({ api, game, disabled }: { api: GameApi; game: Game; disabled: boolean }) {
  const { tuning } = gameData;
  const left = actionsLeft(game.preview, tuning);
  const [open, setOpen] = useState<DecisionKind | null>(null);

  return (
    <section className="panel">
      <h2>Decisions</h2>
      <p className="strong">Actions left this quarter: {left} of {tuning.actions_per_turn}</p>
      <div className="decision-buttons">
        {KINDS.map((k) => (
          <button key={k} className="secondary" disabled={disabled || left === 0} onClick={() => setOpen(k)}>
            {DECISION_LABELS[k]}
          </button>
        ))}
      </div>
      {left === 0 && !disabled && <p className="muted">No actions left. End the turn to resolve the quarter.</p>}

      {inCrisis(game.preview) && (
        <div className="crisis">
          <h3>Crisis measures</h3>
          <p className="muted">Open while the market is uneasy, panicking, or under a panic warning. Each uses an action.</p>
          <div className="decision-buttons">
            {CRISIS_KINDS.map((k) => (
              <button key={k} className="secondary" disabled={disabled || left === 0} onClick={() => setOpen(k)}>
                {DECISION_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
      )}

      <h3>Queued this quarter</h3>
      {game.queued.length === 0 ? (
        <p className="muted">Nothing queued. Queued actions take effect when you end the turn.</p>
      ) : (
        <>
          <ol className="queued-list">
            {game.queued.map((d, i) => <li key={i}>{describe(d, game.base)}</li>)}
          </ol>
          <button className="secondary" onClick={api.clearQueue} disabled={disabled}>Clear queued actions</button>
        </>
      )}

      <DecisionDialog kind={open} state={game.preview} onClose={() => setOpen(null)} onSubmit={api.queue} />
    </section>
  );
}

export function describe(d: Decision, state: GameState): string {
  const borrower = (id: number) => state.borrowers.find((b) => b.id === id)?.name ?? `borrower #${id}`;
  switch (d.kind) {
    case "lend":
      return `Lend ${fl(d.amount)} to ${borrower(d.borrower)} at ${pct(d.rate)}`;
    case "report":
      return `Buy a report on ${borrower(d.borrower)}`;
    case "buy_bond":
      return `Buy ${fl(d.face_value)} face of ${gameData.states.find((s) => s.id === d.state)?.name ?? d.state} bonds`;
    case "invest_venture":
      return `Back a venture (${gameData.ventures.find((v) => v.id === d.venture)?.name ?? d.venture}) with ${fl(d.amount)}`;
    case "set_reserve":
      return `Set the reserve to ${fl(d.amount)}`;
    case "invest_family": {
      const cost = fl(gameData.tuning.family.invest[d.form].cost);
      if (d.form === "charity") return `Give ${cost} to charity`;
      if (d.form === "patronage") return `Spend ${cost} on patronage`;
      return `Educate ${state.people.find((p) => p.id === d.heir)?.name ?? "an heir"} in ${d.stat} (${cost})`;
    }
    case "borrow":
      return `Borrow ${fl(d.amount)} from ${gameData.tuning.crisis.rival.name}`;
    case "pay_slowly":
      return "Pay depositors slowly this quarter";
    case "suspend":
      return "Suspend withdrawals this quarter";
    case "call_loan":
      return `Call in loan #${d.loan} (${state.loans.find((l) => l.id === d.loan)?.borrower_name ?? "unknown"})`;
  }
}
