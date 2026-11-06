// The houses of Frankfurt: a second view, reached from the masthead. The bourse's standing (every
// house and yours, by wealth) and one card per house: its head and heir, wealth, reputation, its
// opinion of your house and what that opinion means for borrowing. A card's sheet explains more,
// and Court spends one of the quarter's actions to win the house's favour.
import { Dialog } from "radix-ui";
import { useState } from "react";
import { gameData } from "../data";
import { actionsLeft } from "../sim/actions";
import { dateOfTurn } from "../sim/chronicle";
import { lendingTerms } from "../sim/crisis";
import { ageIn } from "../sim/family";
import { checkCourtHouse, houseRanking, opinionWord } from "../sim/houses";
import { netWorth } from "../sim/turn";
import type { GameState, OtherHouse } from "../sim/types";
import { fl, keepUnits, pct, seasonLabel } from "./format";

const about = (n: number) => `about ${fl(Math.round(n / 1000) * 1000)}`;
const TEMPERAMENT = {
  cautious: "A cautious house: it grows slowly and weathers a panic well.",
  bold: "A bold house: it grows faster, and a panic hits it hard. Bold houses are the likeliest to fail.",
};

/** Opinion from -100 to 100 as a bar with its middle marked, plus the word and the number. */
function OpinionBar({ value }: { value: number }) {
  const left = value < 0 ? 50 + value / 2 : 50;
  const width = Math.abs(value) / 2;
  return (
    <span className="opinion" aria-label={`Opinion of your house: ${opinionWord(value)}, ${value}`}>
      <span className="opinion-bar" aria-hidden="true">
        <span className={value < 0 ? "opinion-fill cold" : "opinion-fill"} style={{ left: `${left}%`, width: `${width}%` }} />
        <span className="opinion-mid" />
      </span>
      <span className="opinion-word">{opinionWord(value)} ({value > 0 ? `+${value}` : value})</span>
    </span>
  );
}

function lendingLine(state: GameState, h: OtherHouse): string {
  const t = lendingTerms(state, h, gameData.tuning);
  return t.refused ? `Would not lend: ${t.refused}` : `In a crisis would lend at ${pct(t.rate)}, up to ${fl(t.room)}`;
}

export function HousesView({ state, onCourt }: { state: GameState; onCourt?: (house: string) => string | null }) {
  const [open, setOpen] = useState<OtherHouse | null>(null);
  const ranking = houseRanking(state, netWorth(state));
  const failed = state.houses.filter((h) => h.failed_turn !== null);
  const left = actionsLeft(state, gameData.tuning);
  const court = gameData.tuning.houses.court;

  return (
    <main className="houses-view">
      <section className="panel standing" aria-label="The standing of the houses">
        <h2>The Bourse</h2>
        <p className="small muted">The houses of Frankfurt by wealth; yours by net worth.</p>
        <ol className="ranking">
          {ranking.map((r) => (
            <li key={r.name} className={r.player ? "you" : ""}>
              <span>{r.name}{r.player ? " (yours)" : ""}</span>
              <span className="num">{keepUnits(r.player ? fl(r.worth) : about(r.worth))}</span>
            </li>
          ))}
        </ol>
        {failed.length > 0 && (
          <p className="small muted">Failed: {failed.map((h) => `${h.name} (${seasonLabel(dateOfTurn(h.failed_turn!, gameData.tuning))})`).join("; ")}</p>
        )}
        <p className="small">
          Courting a house costs {keepUnits(fl(court.cost))} and one action ({left} left this quarter), and raises its opinion by {court.opinion}.
          Opinion drifts back toward each house's own leaning.
        </p>
      </section>

      {state.houses.map((h) => (
        <section key={h.id} className={`panel house-card ${h.failed_turn !== null ? "failed" : ""}`} aria-label={h.name}>
          <h2>{h.name}</h2>
          {h.failed_turn !== null ? (
            <p className="stamp">Closed its doors, {seasonLabel(dateOfTurn(h.failed_turn, gameData.tuning))}</p>
          ) : (
            <>
              <p className="small muted">{h.temperament === "bold" ? "Bold" : "Cautious"} house, headed by {h.head.name}, {ageIn(h.head, state.world.year)}</p>
              <dl className="house-facts">
                <dt>Wealth</dt>
                <dd>{keepUnits(about(h.wealth))}</dd>
                <dt>Reputation</dt>
                <dd>{h.reputation} of 100</dd>
              </dl>
              <OpinionBar value={h.opinion} />
              <p className="small">{keepUnits(lendingLine(state, h))}</p>
            </>
          )}
          <div className="row card-buttons">
            <button className="secondary" onClick={() => setOpen(h)}>About the house</button>
            {h.failed_turn === null && onCourt && <CourtButton state={state} house={h} onCourt={onCourt} />}
          </div>
        </section>
      ))}

      <HouseSheet house={open} state={state} onClose={() => setOpen(null)} />
    </main>
  );
}

function CourtButton({ state, house, onCourt }: { state: GameState; house: OtherHouse; onCourt: (house: string) => string | null }) {
  const [error, setError] = useState<string | null>(null);
  const refused = checkCourtHouse(state, { kind: "court_house", house: house.id }, gameData);
  return (
    <>
      <button className="primary" disabled={refused !== null} onClick={() => setError(onCourt(house.id))}>
        Court ({keepUnits(fl(gameData.tuning.houses.court.cost))})
      </button>
      {(error ?? refused) && <p className="small error">{keepUnits((error ?? refused)!)}</p>}
    </>
  );
}

function HouseSheet({ house, state, onClose }: { house: OtherHouse | null; state: GameState; onClose: () => void }) {
  const l = gameData.tuning.crisis.lending;
  const year = state.world.year;
  return (
    <Dialog.Root open={house !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog person-sheet" aria-describedby={undefined}>
          {house && (
            <>
              <Dialog.Title>{house.name}</Dialog.Title>
              <p>{TEMPERAMENT[house.temperament]}</p>
              {house.failed_turn === null ? (
                <>
                  <p>
                    Headed by {house.head.name}, aged {ageIn(house.head, year)}. Heir: {house.heir.name}
                    {house.heir.birth_year < year ? `, aged ${ageIn(house.heir, year)}` : ""}.
                  </p>
                  <p>
                    Wealth {keepUnits(about(house.wealth))}, {house.wealth >= house.start_wealth ? "up" : "down"}{" "}
                    {pct(Math.abs(house.wealth / house.start_wealth - 1))} since 1815. Reputation {house.reputation} of 100.
                  </p>
                  <OpinionBar value={house.opinion} />
                  <ul className="choices trait-list">
                    <li className="choice">
                      <strong>Borrowing in a crisis</strong>
                      <span>
                        Lends only at an opinion of {l.min_opinion} or better, at {pct(l.base_rate)} a year at opinion 0, falling to{" "}
                        {pct(l.base_rate - l.rate_per_opinion)} at +100; at most {pct(l.wealth_share)} of its wealth.
                      </span>
                      <span className="small">{keepUnits(lendingLine(state, house))}</span>
                    </li>
                    <li className="choice">
                      <strong>What moves its opinion</strong>
                      <span>Courting it, repaying its loans on time, and how you answer letters that concern it raise or lower it. Suspending withdrawals lowers every house's opinion.</span>
                      <span className="small">Left alone, opinion drifts back toward {house.baseline > 0 ? `+${house.baseline}` : house.baseline}, this house's leaning; a new head moves it halfway there.</span>
                    </li>
                  </ul>
                </>
              ) : (
                <p className="stamp">Closed its doors, {seasonLabel(dateOfTurn(house.failed_turn, gameData.tuning))}. Some of its depositors came to houses with a good name.</p>
              )}
              <div className="row dialog-buttons">
                <Dialog.Close asChild>
                  <button className="secondary">Close</button>
                </Dialog.Close>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
