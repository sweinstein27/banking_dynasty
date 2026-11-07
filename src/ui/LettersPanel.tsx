// Letters: this quarter's post (answered or waiting) and every letter settled before, paged.
// Answering opens the same letter dialog as the stack on the Desk.
import { useState } from "react";
import { gameData } from "../data";
import { dateOfTurn } from "../sim/chronicle";
import { unansweredLetters } from "../sim/letters";
import type { Decision, GameState } from "../sim/types";
import { seasonLabel } from "./format";
import { LetterDialog } from "./Letters";
import { PageTurner, usePages } from "./Pager";
import { Term } from "./Term";

export function LettersPanel({ state, onDecide }: { state: GameState; onDecide?: (d: Decision) => string | null }) {
  const [open, setOpen] = useState(false);
  const waiting = unansweredLetters(state).length;
  const event = (id: string) => gameData.events.find((e) => e.id === id);
  const option = (ev: string, opt: string | null) => (opt ? event(ev)?.options?.find((o) => o.id === opt)?.label ?? opt : null);
  const past = [...state.letter_outcomes].reverse();
  const pages = usePages(past, 4);

  return (
    <div className="doc letters-panel">
      <p className="small muted">
        Some events ask for an answer: see <Term id="letters">letters</Term>. The quarter cannot end until each one is answered.
      </p>
      <h3>This quarter's post</h3>
      {state.letters.length === 0 ? (
        <p className="muted">No letters this quarter.</p>
      ) : (
        <ul className="rows">
          {state.letters.map((l) => (
            <li key={l.event} className="row-card letter-row">
              <p className="row-head">
                <strong>{event(l.event)?.title ?? l.event}</strong>{" "}
                <span className={`chip ${l.answer ? "chip-borrowing" : "chip-away"}`}>{l.answer ? "Answered" : "Waiting"}</span>
              </p>
              <p className="small">{l.answer ? `Your answer: ${option(l.event, l.answer)}` : "Not yet answered."}</p>
            </li>
          ))}
        </ul>
      )}
      {onDecide && waiting > 0 && (
        <div className="row page-actions">
          <button className="primary" onClick={() => setOpen(true)}>Read and answer ({waiting})</button>
        </div>
      )}
      <h3>Letters settled</h3>
      {past.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <ul className="rows">
          {pages.items.map((o, i) => (
            <li key={`${o.turn}-${o.event}-${i}`} className="row-card">
              <p className="row-head"><strong>{event(o.event)?.title ?? o.event}</strong> <span className="small muted">{seasonLabel(dateOfTurn(o.turn, gameData.tuning))}</span></p>
              <p className="small">
                {o.by_default ? "Left unanswered: " : "Answered: "}{option(o.event, o.option)}
                {o.chance === true ? ". The chance came up." : o.chance === false ? ". The chance did not come up." : "."}
              </p>
            </li>
          ))}
        </ul>
      )}
      <PageTurner pages={pages} />
      {onDecide && <LetterDialog state={state} open={open && waiting > 0} onClose={() => setOpen(false)} onSubmit={onDecide} />}
    </div>
  );
}
