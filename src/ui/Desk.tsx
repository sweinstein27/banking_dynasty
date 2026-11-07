// The desk: this quarter's decisions as cards, the actions left as coins, and queued actions as
// letters waiting to go out when the quarter ends.
import { Tabs } from "radix-ui";
import { useState } from "react";
import { gameData } from "../data";
import { capacityLeft, capacityTotal } from "../sim/capacity";
import { inCrisis } from "../sim/crisis";
import { investCost } from "../sim/family";
import { describeSystemDecision } from "../sim/decisions";
import type { CoreDecision, Decision, GameState } from "../sim/types";
import { CRISIS_KINDS, DECISION_LABELS, DecisionDialog, type DecisionKind } from "./DecisionDialogs";
import { fl, pct } from "./format";
import { LetterStack } from "./Letters";
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
  designate_heir: "Choose who takes over",
  answer_letter: "Reply to a letter",
  court_house: "Win another house's favour",
  arrange_marriage: "A match for an heir",
  borrow: "From another house",
  pay_slowly: "Pay depositors in part",
  suspend: "Close the doors a quarter",
  call_loan: "Recall a loan early",
};

export function Desk({ api, game }: { api: GameApi; game: Game }) {
  const { tuning } = gameData;
  const left = capacityLeft(game.preview, tuning);
  const total = capacityTotal(game.preview, tuning);
  const crisis = inCrisis(game.preview);
  const [open, setOpen] = useState<DecisionKind | null>(null);
  const [tab, setTab] = useState("business");
  const shown = crisis ? tab : "business";
  // Replies to letters go out together on one line, so the list stays short.
  const replies = game.queued.filter((d) => d.kind === "answer_letter");
  const actions = game.queued.filter((d) => d.kind !== "answer_letter");

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
        <LetterStack state={game.preview} onSubmit={api.queue} />
        <div className="coins" aria-label={`${left} of ${total} actions left this quarter`}>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={i < left ? "coin" : "coin spent"} />
          ))}
          <span className="coins-label">{left} of {total} actions left</span>
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
              {actions.map((d, i) => <li key={i} className="letter">{describe(d, game.base)}</li>)}
              {replies.length > 0 && (
                <li className="letter">{replies.length === 1 ? describe(replies[0]!, game.base) : `Replies to ${replies.length} letters`}</li>
              )}
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
  const system = describeSystemDecision(d, state, gameData);
  if (system !== null) return system;
  return describeCore(d as CoreDecision, state);
}

function describeCore(d: CoreDecision, state: GameState): string {
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
      const cost = fl(investCost(d.form, state, gameData));
      if (d.form === "charity") return `Give ${cost} to charity`;
      if (d.form === "patronage") return `Spend ${cost} on patronage`;
      return `Educate ${state.people.find((p) => p.id === d.heir)?.name ?? "an heir"} in ${d.stat} (${cost})`;
    }
    case "designate_heir":
      return `Name ${state.people.find((p) => p.id === d.heir)?.name ?? "an heir"} as heir to the house`;
    case "answer_letter": {
      const ev = gameData.events.find((e) => e.id === d.event);
      return `Reply to "${ev?.title ?? d.event}": ${ev?.options?.find((o) => o.id === d.option)?.label ?? d.option}`;
    }
    case "borrow":
      return `Borrow ${fl(d.amount)} from ${state.houses.find((h) => h.id === d.house)?.name ?? d.house}`;
    case "arrange_marriage": {
      const who = state.people.find((p) => p.id === d.member)?.name ?? "a member of the house";
      if (d.with === "merchant") return `Marry ${who} to a merchant family`;
      const h = state.houses.find((x) => x.id === d.with)?.name ?? d.with;
      return d.form === "out" ? `Marry ${who} into ${h}` : `Marry ${who} to a son or daughter of ${h}`;
    }
    case "court_house":
      return `Court ${state.houses.find((h) => h.id === d.house)?.name ?? d.house} (${fl(gameData.tuning.houses.court.cost)})`;
    case "pay_slowly":
      return "Pay depositors slowly this quarter";
    case "suspend":
      return "Suspend withdrawals this quarter";
    case "call_loan":
      return `Call in loan #${d.loan} (${state.loans.find((l) => l.id === d.loan)?.borrower_name ?? "unknown"})`;
  }
}
