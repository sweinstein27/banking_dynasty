// Arranging a marriage: one card per house still trading, with the two kinds of match and whether
// the house agrees (and why not), plus a merchant family, who always agree. Opened from a person's
// sheet. The sim checks every match; a refusal is shown with its reason.
import { Dialog } from "radix-ui";
import { useState } from "react";
import { gameData } from "../data";
import { opinionWord } from "../sim/houses";
import { allies, checkMarriage, matchMoney } from "../sim/marriages";
import type { ArrangeMarriageDecision, Decision, GameState, Person } from "../sim/types";
import { fl, keepUnits } from "./format";

const money = (n: number) => keepUnits(n > 0 ? `They pay a dowry of ${fl(n)}` : `You pay ${fl(-n)}`);

export function MarriageDialog({ member, state, onClose, onSubmit }: {
  member: Person | null;
  state: GameState;
  onClose: () => void;
  onSubmit: (d: Decision) => string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const m = gameData.tuning.family.marriage;
  const tied = allies(state);

  const option = (d: ArrangeMarriageDecision, label: string) => {
    const refused = checkMarriage(state, d, gameData);
    return (
      <button
        className="choice response"
        disabled={refused !== null}
        onClick={() => {
          const reason = onSubmit(d);
          setError(reason);
          if (!reason) onClose();
        }}
      >
        <strong>{label}</strong>
        <span className="small">{money(matchMoney(state, d, gameData))}</span>
        {refused && <span className="small error">{keepUnits(refused)}</span>}
      </button>
    );
  };

  return (
    <Dialog.Root open={member !== null} onOpenChange={(o) => { if (!o) { setError(null); onClose(); } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog marriage-dialog" aria-describedby={undefined}>
          {member && (
            <>
              <Dialog.Title>A match for {member.name}</Dialog.Title>
              <p className="small muted">
                Uses one action. A son or daughter of a house who marries in brings a dowry and makes the houses allies (it needs the house's
                opinion of +{m.in.min_opinion} and a name no more than {m.in.reputation_gap} below theirs). Marrying out costs a dowry and the heir
                leaves your line, but ties the houses closer. Children need a married couple.
              </p>
              <ul className="match-grid">
                {state.houses.filter((h) => h.failed_turn === null).map((h) => (
                  <li key={h.id} className="match">
                    <p className="match-head">
                      <strong>{h.name}</strong> <span className="small">{opinionWord(h.opinion)} ({h.opinion}), reputation {h.reputation}{tied.has(h.id) ? ", allied" : ""}</span>
                    </p>
                    {option({ kind: "arrange_marriage", member: member.id, with: h.id, form: "in" }, `${member.gender === "m" ? "A daughter" : "A son"} of the house joins yours`)}
                    {!member.is_head && option({ kind: "arrange_marriage", member: member.id, with: h.id, form: "out" }, `${member.name.split(" ")[0]} marries into ${h.name}`)}
                  </li>
                ))}
                <li className="match">
                  <p className="match-head"><strong>A merchant family</strong> <span className="small">Outside the bourse; always willing; no alliance</span></p>
                  {option({ kind: "arrange_marriage", member: member.id, with: "merchant", form: "in" }, `A ${member.gender === "m" ? "wife" : "husband"} from a merchant family`)}
                </li>
              </ul>
              {error && <p className="error">Refused: {error}</p>}
              <div className="row dialog-buttons">
                <Dialog.Close asChild>
                  <button className="secondary">Not now</button>
                </Dialog.Close>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
