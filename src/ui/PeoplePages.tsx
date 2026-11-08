// The Family panel's people pages: loyalty chips, family letters with every answer's cost and
// effect, education paths for each heir, and feuds with the houses founded by members who left.
import { useState } from "react";
import { gameData } from "../data";
import type { Decision, GameState, Person } from "../sim/types";
import { fl, keepUnits } from "./format";
import { familyLetterViews, familyLog, feudViews, loyaltyView, splitHouses, studyTime, studyViews } from "./model/people";
import { PageTurner, usePages } from "./Pager";
import { ActButton, Refused, SumCard, useRun } from "./ScreenKit";
import { Term } from "./Term";

type Decide = (d: Decision) => string | null;

/** A person's loyalty in a word; a click opens the number and what moves it. Nothing for those without one. */
export function LoyaltyChip({ p, state }: { p: Person; state: GameState }) {
  const v = loyaltyView(state, p, gameData);
  if (!v) return null;
  return (
    <SumCard title="Loyalty" summary={`How much ${p.name} holds to the house.`} term="loyalty" sections={v.sections} className={`loyalty-chip tone-${v.tone ?? "plain"}`}>
      {v.word} ({v.value})
    </SumCard>
  );
}

// ---------- Letters ----------

export function FamilyLetters({ state, onDecide }: { state: GameState; onDecide?: Decide }) {
  const letters = familyLetterViews(state, gameData);
  const log = familyLog(state);
  const { error, run } = useRun(onDecide);
  return (
    <>
      <p className="small muted">
        <Term id="family_letter">Family letters</Term> this quarter. Answer by End Turn: one left unanswered takes the answer marked "if unanswered". Answers take no one's time, except a match.
      </p>
      {letters.length === 0 ? (
        <p className="muted">No one in the family has written this quarter.</p>
      ) : (
        <ul className="rows family-letters">
          {letters.map((l) => (
            <li key={l.letter.id} className="row-card family-letter">
              <p className="row-head">
                <strong>{l.title}</strong>
                <span className="small muted">from {l.from}, {l.arrived}</span>
              </p>
              <p className="letter-text">{keepUnits(l.text)}</p>
              {l.answered ? (
                <p className="good">Answered: {l.answered}. To change it, take the order back at the Desk.</p>
              ) : (
                <ul className="choices">
                  {l.options.map((o) => (
                    <li key={o.id}>
                      <button
                        className="choice"
                        disabled={!onDecide || o.blocked !== null}
                        onClick={() => run({ kind: "answer_family_letter", letter: l.letter.id, option: o.id })}
                      >
                        <strong>{o.label}{o.cost > 0 ? `: ${keepUnits(fl(o.cost))}` : ""}</strong>
                        <span className="small">{keepUnits(o.effect)}</span>
                        {o.isDefault && <span className="small muted">If unanswered</span>}
                        {o.blocked && <span className="act-why">{keepUnits(o.blocked)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <Refused error={error} />
      {log.length > 0 && (
        <>
          <h3>In the family this quarter</h3>
          <ul className="plain small">
            {log.map((e, i) => <li key={i}>{e.title ? <strong>{e.title}: </strong> : null}{keepUnits(e.text)}</li>)}
          </ul>
        </>
      )}
    </>
  );
}

// ---------- Studies ----------

export function Studies({ state, onDecide }: { state: GameState; onDecide?: Decide }) {
  const heirs = studyViews(state, gameData);
  const pages = usePages(heirs, 1);
  const { error, run } = useRun(onDecide);
  return (
    <>
      <p className="small muted">
        Send an heir away to <Term id="study">study</Term>. It is paid now, takes the head's time, and the heir comes back changed. {studyTime(state, gameData)}.
      </p>
      {heirs.length === 0 ? (
        <p className="muted">No heirs to send.</p>
      ) : (
        <ul className="rows">
          {pages.items.map((h) => (
            <li key={h.heir.id} className="row-card study-heir">
              <p className="row-head">
                <strong>{h.heir.name}, aged {h.age}</strong>
                {h.away && <span className="chip chip-away">Away: {h.away.path}, back {h.away.returns}</span>}
              </p>
              {h.done.length > 0 && <p className="small muted">Has had: {h.done.join(", ")}.</p>}
              <div className="act-row study-paths">
                {h.paths.map((p) => (
                  <div key={p.path.id} className="study-path">
                    <ActButton
                      label={`${p.path.name}, ${p.path.cost > 0 ? fl(p.path.cost) : "free"}`}
                      blocked={onDecide ? p.blocked : "The run is over"}
                      onClick={() => run({ kind: "send_to_study", heir: h.heir.id, path: p.path.id })}
                    />
                    <span className="small">Ages {p.path.min_age} to {p.path.max_age}, {p.path.quarters} quarters. {p.gains}.</span>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Refused error={error} />
      <PageTurner pages={pages} />
    </>
  );
}

// ---------- Feuds ----------

export function Feuds({ state }: { state: GameState }) {
  const feuds = feudViews(state, gameData);
  const splits = splitHouses(state);
  return (
    <>
      <p className="small muted">
        A refused <Term id="claim">claim</Term> starts a <Term id="feud">feud</Term> that costs the house reputation each quarter. Terms to end it come by letter.
      </p>
      <h3>Feuds</h3>
      {feuds.length === 0 ? (
        <p className="muted">The family is at peace with itself.</p>
      ) : (
        <ul className="rows">
          {feuds.map((f) => (
            <li key={f.feud.person} className="row-card">
              <p className="row-head"><strong>{f.claimant} against {f.head}</strong><span className="chip chip-away">Since {f.since}</span></p>
              <p className="small">Reputation -{f.perQuarter} a quarter. It dies out with {f.head}, or in {f.quartersLeft} quarter{f.quartersLeft === 1 ? "" : "s"}.</p>
            </li>
          ))}
        </ul>
      )}
      <h3>Houses founded by those who left</h3>
      {splits.length === 0 ? (
        <p className="muted">No one has left the house.</p>
      ) : (
        <ul className="plain">
          {splits.map((s) => (
            <li key={s.house}>
              <strong>{s.house}</strong>, founded by {s.person}. Their <Term id="opinion">opinion</Term> of the house: {s.opinion}{s.failed ? ". It has failed." : "."}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
