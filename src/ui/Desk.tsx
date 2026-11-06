// The desk: this quarter's decisions as cards, the actions left as coins, and queued actions as
// letters waiting to go out when the quarter ends.
import { Tabs } from "radix-ui";
import { useState } from "react";
import { gameData } from "../data";
import { actionsLeft } from "../sim/actions";
import { inCrisis } from "../sim/crisis";
import type { Decision, GameState } from "../sim/types";
import { CRISIS_KINDS, DECISION_LABELS, DecisionDialog, type DecisionKind } from "./DecisionDialogs";
import { fl, pct } from "./format";
import type { Game, GameApi } from "./useGame";

const BUSINESS: DecisionKind[] = ["lend", "report", "buy_bond", "invest_venture", "set_reserve", "invest_family"];

/** One line under each card's name, so the player knows what it does without opening it. */
const HINTS: Record<DecisionKind, string> = {
  lend: "To a merchant who asks",
  report: "Check a borrower's books",
  buy_bond: "Lend to a state",
  invest_venture: "Mills, ships, railways",
  set_reserve: "Cash kept back for runs",
  invest_family: "Tutors, charity, patronage",
  borrow: "From Bankhaus Kessler",
  pay_slowly: "Pay depositors in part",
  suspend: "Close the doors a quarter",
  call_loan: "Recall a loan early",
};

export function Desk({ api, game }: { api: GameApi; game: Game }) {
  const { tuning } = gameData;
  const left = actionsLeft(game.preview, tuning);
  const crisis = inCrisis(game.preview);
  const [open, setOpen] = useState<DecisionKind | null>(null);
  const [tab, setTab] = useState("business");
  const shown = crisis ? tab : "business";

  const cards = (kinds: DecisionKind[], cls = "") =>
    kinds.map((k) => (
      <button key={k} className={`card ${cls}`} disabled={left === 0} onClick={() => setOpen(k)}>
        <span className="card-name">{DECISION_LABELS[k]}</span>
        <span className="card-hint">{HINTS[k]}</span>
      </button>
    ));

  return (
    <section className="panel desk" aria-label="The Desk">
      <header className="desk-head">
        <h2>The Desk</h2>
        <div className="coins" aria-label={`${left} of ${tuning.actions_per_turn} actions left this quarter`}>
          {Array.from({ length: tuning.actions_per_turn }, (_, i) => (
            <span key={i} className={i < left ? "coin" : "coin spent"} />
          ))}
          <span className="coins-label">{left} of {tuning.actions_per_turn} actions left</span>
        </div>
      </header>

      <Tabs.Root value={shown} onValueChange={setTab} className="desk-tabs">
        <Tabs.List className="ribbons" aria-label="Kinds of decision">
          <Tabs.Trigger value="business" className="ribbon">Business</Tabs.Trigger>
          <Tabs.Trigger value="crisis" className={`ribbon ${crisis ? "alarm" : ""}`} disabled={!crisis}>
            {crisis ? "Crisis measures" : "Crisis measures (calm)"}
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="business" className="cards">{cards(BUSINESS)}</Tabs.Content>
        <Tabs.Content value="crisis" className="cards">{cards(CRISIS_KINDS, "crisis-card")}</Tabs.Content>
      </Tabs.Root>

      <div className="letters">
        {game.queued.length === 0 ? (
          <p className="muted">{left === 0 ? "No actions left. End the quarter." : "Nothing queued. Queued actions go out when the quarter ends."}</p>
        ) : (
          <>
            <ol className="letter-list">
              {game.queued.map((d, i) => <li key={i} className="letter">{describe(d, game.base)}</li>)}
            </ol>
            <button className="turn" onClick={api.clearQueue}>Take back all</button>
          </>
        )}
      </div>

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
