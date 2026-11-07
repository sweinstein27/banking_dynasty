// The quarter's post: letters that ask for an answer. A stack on the Desk shows how many wait; a
// click opens them one at a time, each response a card with its cost, what it does, and its odds in
// words. A response the house can't afford is shown but disabled, with the reason.
import { Dialog } from "radix-ui";
import { useState } from "react";
import { gameData } from "../data";
import { checkAnswerLetter, describeOption, unansweredLetters } from "../sim/letters";
import type { AnswerLetterDecision, Decision, GameState } from "../sim/types";
import { fl, keepUnits } from "./format";

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The stack of unanswered letters, with a count. Hidden when the post is empty. */
export function LetterStack({ state, onSubmit }: { state: GameState; onSubmit: (d: Decision) => string | null }) {
  const [open, setOpen] = useState(false);
  const waiting = unansweredLetters(state);
  if (!waiting.length && !open) return null;
  const n = waiting.length;
  return (
    <>
      {n > 0 && (
        <button className={`post ${n > 1 ? "stacked" : ""}`} onClick={() => setOpen(true)}>
          <span className="post-count">{n}</span>
          <span className="post-text">{n === 1 ? "A letter awaits your answer" : `${n} letters await your answer`}</span>
        </button>
      )}
      <LetterDialog state={state} open={open && n > 0} onClose={() => setOpen(false)} onSubmit={onSubmit} />
    </>
  );
}

/** The first unanswered letter, with its responses. Answering moves on to the next; the last closes the dialog. */
export function LetterDialog({ state, open, onClose, onSubmit }: {
  state: GameState;
  open: boolean;
  onClose: () => void;
  onSubmit: (d: Decision) => string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const waiting = unansweredLetters(state);
  const letter = waiting[0];
  const event = letter && gameData.events.find((e) => e.id === letter.event);
  const total = state.letters.length;
  const index = letter ? state.letters.indexOf(letter) + 1 : 0;

  const answer = (d: AnswerLetterDecision) => {
    const reason = onSubmit(d);
    setError(reason);
    if (!reason && waiting.length === 1) onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) { setError(null); onClose(); } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog letter-dialog" aria-describedby={undefined}>
          {letter && event && (
            <>
              <Dialog.Title>{event.title}</Dialog.Title>
              <p className="muted small">
                Letter {index} of {total}. Answering uses none of the quarter's actions. Certain costs show in the books at once; chances are settled when the quarter ends.
              </p>
              <p className="letter-text">{event.text}</p>
              <ul className="choices responses">
                {event.options!.map((o) => {
                  const d: AnswerLetterDecision = { kind: "answer_letter", event: event.id, option: o.id };
                  const refused = checkAnswerLetter(state, d, gameData);
                  const { cost, effects, odds } = describeOption(o, gameData);
                  return (
                    <li key={o.id}>
                      <button className="choice response" disabled={refused !== null} onClick={() => answer(d)}>
                        <strong>{o.label}</strong>
                        <span className={cost > 0 ? "cost" : "muted"}>{cost > 0 ? keepUnits(`Costs ${fl(cost)}`) : "No cost"}</span>
                        {effects.length > 0 && <span className="small">{capital(effects.join("; "))}</span>}
                        {odds && <span className="small odds">{capital(odds)}</span>}
                        {refused && <span className="small error">{keepUnits(refused)}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {error && <p className="error">Refused: {error}</p>}
              <div className="row dialog-buttons">
                <Dialog.Close asChild>
                  <button className="secondary">Decide later</button>
                </Dialog.Close>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
