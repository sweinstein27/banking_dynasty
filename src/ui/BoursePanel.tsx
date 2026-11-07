// The Bourse: who wants money and what is for sale. Merchants asking for loans (and every borrower
// the house knows), the states selling bonds, and the ventures open to backing. Each page has the
// decision that acts on it; the dialogs are the Desk's own. Companies join in a later milestone.
import { Tabs } from "radix-ui";
import { useState } from "react";
import { gameData } from "../data";
import { estimateRange } from "../sim/borrowers";
import { capacityLeft } from "../sim/capacity";
import { headStat } from "../sim/family";
import { bondOffers, lendOffers, ventureOffers } from "../sim/offers";
import { bondValue } from "../sim/bonds";
import type { Decision, GameState } from "../sim/types";
import { venturePayout, quartersLeft } from "../sim/ventures";
import { DECISION_LABELS, DecisionDialog, type DecisionKind } from "./DecisionDialogs";
import { fl, keepUnits, pct } from "./format";
import { PageTurner, usePages } from "./Pager";
import { Term } from "./Term";

const PER_PAGE = 4;

export function BoursePanel({ state, onDecide }: { state: GameState; onDecide?: (d: Decision) => string | null }) {
  const [open, setOpen] = useState<DecisionKind | null>(null);
  const can = onDecide !== undefined && capacityLeft(state, gameData.tuning) > 0;
  const act = (k: DecisionKind) => (
    <button key={k} className="primary" disabled={!can} onClick={() => setOpen(k)}>{DECISION_LABELS[k]}</button>
  );
  return (
    <div className="doc bourse">
      <Tabs.Root defaultValue="borrowers" className="doc-tabs">
        <Tabs.List className="ribbons" aria-label="The bourse">
          <Tabs.Trigger value="borrowers" className="ribbon">Merchants</Tabs.Trigger>
          <Tabs.Trigger value="states" className="ribbon">States</Tabs.Trigger>
          <Tabs.Trigger value="ventures" className="ribbon">Ventures</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="borrowers" className="doc-page">
          <Borrowers state={state} />
          <div className="row page-actions">{act("lend")}{act("report")}</div>
        </Tabs.Content>
        <Tabs.Content value="states" className="doc-page">
          <States state={state} />
          <div className="row page-actions">{act("buy_bond")}</div>
        </Tabs.Content>
        <Tabs.Content value="ventures" className="doc-page">
          <Ventures state={state} />
          <div className="row page-actions">{act("invest_venture")}</div>
        </Tabs.Content>
      </Tabs.Root>
      {onDecide && <DecisionDialog kind={open} state={state} onClose={() => setOpen(null)} onSubmit={onDecide} />}
    </div>
  );
}

function Borrowers({ state }: { state: GameState }) {
  const offers = lendOffers(state, gameData);
  const asking = new Set(offers.map((o) => o.borrower_id));
  const prudence = headStat(state, "prudence", gameData);
  const known = state.borrowers.filter((b) => !asking.has(b.id) && (b.repaid > 0 || b.defaulted > 0 || state.loans.some((l) => l.borrower_id === b.id)));
  const rows = [
    ...offers.map((o) => ({
      key: `o${o.borrower_id}`,
      head: `${o.name}, ${o.trade}`,
      tag: "Asking",
      lines: [
        `Wants up to ${fl(o.amount)} at up to ${pct(o.max_rate)} a year.`,
        `Quality ${o.estimate.low.toFixed(2)} to ${o.estimate.high.toFixed(2)}${o.reported ? ", from a report" : ""}.`,
        o.repaid === 0 && o.defaulted === 0 ? "No history with the house." : `With the house: repaid ${o.repaid}, defaulted ${o.defaulted}.`,
      ],
    })),
    ...known.map((b) => {
      const r = estimateRange(b, prudence, gameData.tuning);
      const lent = state.loans.filter((l) => l.borrower_id === b.id && l.status === "active").reduce((n, l) => n + l.principal, 0);
      const away = b.away_until !== null && b.away_until > state.world.turn;
      return {
        key: `b${b.id}`,
        head: `${b.name}, ${b.trade}`,
        tag: lent > 0 ? "Borrowing" : away ? "Away" : "Known",
        lines: [
          lent > 0 ? `Owes the house ${fl(lent)}` : away ? `Asks for nothing for ${b.away_until! - state.world.turn} more quarters.` : "Not asking this quarter.",
          `Quality ${r.low.toFixed(2)} to ${r.high.toFixed(2)}${b.reported ? ", from a report" : ""}.`,
          `With the house: repaid ${b.repaid}, defaulted ${b.defaulted}.`,
        ],
      };
    }),
  ];
  const pages = usePages(rows, PER_PAGE);
  return (
    <>
      <p className="small muted">
        Merchants who ask for a <Term id="loans">loan</Term> this quarter, then others the house knows. You see an <Term id="estimate">estimate</Term> of quality, never the truth.
      </p>
      {rows.length === 0 ? <p className="muted">No one is asking for a loan this quarter.</p> : (
        <ul className="rows">
          {pages.items.map((r) => (
            <li key={r.key} className="row-card">
              <p className="row-head"><strong>{r.head}</strong> <span className={`chip chip-${r.tag.toLowerCase()}`}>{r.tag}</span></p>
              {r.lines.map((l, i) => <p key={i} className="small">{keepUnits(l)}</p>)}
            </li>
          ))}
        </ul>
      )}
      <PageTurner pages={pages} />
    </>
  );
}

function States({ state }: { state: GameState }) {
  const offers = bondOffers(state, gameData);
  const pages = usePages(offers, PER_PAGE);
  return (
    <>
      <p className="small muted">
        States sell <Term id="bonds">bonds</Term> to a house whose <Term id="reputation">reputation</Term> clears their <Term id="bond_gate">gate</Term>. Prices follow the <Term id="market_mood">market's mood</Term>.
      </p>
      <ul className="rows">
        {pages.items.map((o) => {
          const held = state.bonds.filter((b) => b.status === "active" && b.issuer_state === o.id);
          return (
            <li key={o.id} className={`row-card ${o.blocked ? "blocked" : ""}`}>
              <p className="row-head"><strong>{o.name}</strong> {o.blocked ? <span className="chip chip-away">Closed</span> : <span className="chip chip-asking">Selling</span>}</p>
              <p className="small">Coupon {pct(o.coupon)} a year. Risk {o.risk}. Price {o.price} per fl. of face value.</p>
              {o.blocked && <p className="small error">{keepUnits(o.blocked)}</p>}
              {held.length > 0 && <p className="small good">{keepUnits(`You hold ${fl(held.reduce((n, b) => n + b.face_value, 0))} face, worth ${fl(held.reduce((n, b) => n + bondValue(b), 0))}`)}</p>}
            </li>
          );
        })}
      </ul>
      <PageTurner pages={pages} />
    </>
  );
}

function Ventures({ state }: { state: GameState }) {
  const offers = ventureOffers(state, gameData);
  const active = state.ventures.filter((v) => v.status === "active");
  const rows = [
    ...active.map((v) => ({
      key: `v${v.id}`, blocked: false, tag: "Backed",
      head: gameData.ventures.find((x) => x.id === v.type)?.name ?? v.type,
      lines: [`${fl(v.invested)} locked; pays ${fl(venturePayout(v))} in ${quartersLeft(state, v)} quarters if it succeeds.`],
    })),
    ...offers.map((o) => ({
      key: `o${o.id}`, blocked: o.blocked !== null, tag: o.blocked ? "Closed" : "Open",
      head: o.name,
      lines: [
        `Locked for ${o.term_quarters} quarters. Returns ${pct(o.expected_return)} on success.`,
        `Fails ${pct(o.failure_chance)} of the time if it ended in today's market.`,
        ...(o.blocked ? [o.blocked] : []),
      ],
    })),
  ];
  const pages = usePages(rows, PER_PAGE);
  return (
    <>
      <p className="small muted">
        <Term id="ventures">Ventures</Term> the house has backed, then those open to backing. The head's <Term id="acumen">acumen</Term> lowers the chance of failure.
      </p>
      <ul className="rows">
        {pages.items.map((r) => (
          <li key={r.key} className={`row-card ${r.blocked ? "blocked" : ""}`}>
            <p className="row-head"><strong>{r.head}</strong> <span className={`chip chip-${r.tag === "Closed" ? "away" : r.tag === "Backed" ? "borrowing" : "asking"}`}>{r.tag}</span></p>
            {r.lines.map((l, i) => <p key={i} className="small">{keepUnits(l)}</p>)}
          </li>
        ))}
      </ul>
      <PageTurner pages={pages} />
    </>
  );
}
