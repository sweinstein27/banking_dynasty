import { useState } from "react";
import { gameData } from "../data";
import { actionsLeft } from "../sim/actions";
import type { Decision, GameState } from "../sim/types";
import { DECISION_LABELS, DecisionDialog, type DecisionKind } from "./DecisionDialogs";
import { fl, pct } from "./format";
import type { Game, GameApi } from "./useGame";

const KINDS: DecisionKind[] = ["lend", "report", "buy_bond", "invest_venture", "set_reserve"];

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
  }
}
