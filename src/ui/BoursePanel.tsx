// The Bourse: who wants money and what is for sale. Merchants asking for loans, each with the
// house's file on their books and the analyst's word; the loans the house holds, which another
// house would buy at a discount; and the states selling bonds. Ventures and shares are in Markets.
import { Tabs } from "radix-ui";
import { useState } from "react";
import { gameData } from "../data";
import { capacityLeft } from "../sim/capacity";
import { bondOffers } from "../sim/offers";
import { bondValue } from "../sim/bonds";
import { KIND_WORDS } from "../sim/systems/credit";
import { freeCash } from "../sim/reserves";
import type { Decision, GameState } from "../sim/types";
import { DECISION_LABELS, DecisionDialog, type DecisionKind } from "./DecisionDialogs";
import { fl, keepUnits, parseAmount, pct } from "./format";
import { loansHeld, merchantRows, salePriceSection, type FileDoc, type MerchantRow } from "./model/credit";
import { PageTurner, usePages } from "./Pager";
import { ActButton, ActionDialog, Refused, SumCard, Sums, useRun } from "./ScreenKit";
import { Term } from "./Term";

const PER_PAGE = 4;

type Decide = (d: Decision) => string | null;

export function BoursePanel({ state, onDecide }: { state: GameState; onDecide?: Decide }) {
  const [open, setOpen] = useState<DecisionKind | null>(null);
  const can = onDecide !== undefined && capacityLeft(state, gameData.tuning) > 0;
  return (
    <div className="doc bourse">
      <Tabs.Root defaultValue="borrowers" className="doc-tabs">
        <Tabs.List className="ribbons" aria-label="The bourse">
          <Tabs.Trigger value="borrowers" className="ribbon">Merchants</Tabs.Trigger>
          <Tabs.Trigger value="loans" className="ribbon">Loans held</Tabs.Trigger>
          <Tabs.Trigger value="states" className="ribbon">States</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="borrowers" className="doc-page">
          <Merchants state={state} onDecide={onDecide} />
        </Tabs.Content>
        <Tabs.Content value="loans" className="doc-page">
          <LoansHeld state={state} onDecide={onDecide} />
        </Tabs.Content>
        <Tabs.Content value="states" className="doc-page">
          <States state={state} />
          <div className="row page-actions">
            <button className="primary" disabled={!can} onClick={() => setOpen("buy_bond")}>{DECISION_LABELS.buy_bond}</button>
          </div>
        </Tabs.Content>
      </Tabs.Root>
      {onDecide && <DecisionDialog kind={open} state={state} onClose={() => setOpen(null)} onSubmit={onDecide} />}
    </div>
  );
}

/** What the house knows of a merchant, as chips: its file and the analyst's word. */
function Chips({ r }: { r: MerchantRow }) {
  return (
    <span className="chips">
      {r.doc ? <span className={`chip ${r.doc.stale ? "chip-away" : "chip-borrowing"}`}>{r.doc.title === "Full inquiry" ? "Inquiry" : "Report"}, {r.doc.age.replace("bought ", "")}</span> : <span className="chip">No file</span>}
      {r.opinion && <span className={`chip chip-${r.opinion.verdict}`}>Analyst: {r.opinion.verdict}</span>}
    </span>
  );
}

function Merchants({ state, onDecide }: { state: GameState; onDecide?: Decide }) {
  const rows = merchantRows(state, gameData);
  const pages = usePages(rows, PER_PAGE);
  const [openId, setOpenId] = useState<number | null>(null);
  const chosen = rows.find((r) => r.offer.borrower_id === openId) ?? null;
  return (
    <>
      <p className="small muted">
        Merchants asking for a <Term id="loans">loan</Term> this quarter. You never see their true soundness: read their <Term id="books">books</Term>, or ask an <Term id="analyst_opinion">analyst</Term>.
      </p>
      {rows.length === 0 ? <p className="muted">No one is asking for a loan this quarter.</p> : (
        <ul className="rows">
          {pages.items.map((r) => (
            <li key={r.offer.borrower_id} className="row-card merchant">
              <div className="merchant-text">
                <p className="row-head"><strong>{r.offer.name}, {r.offer.trade}</strong> <Chips r={r} /></p>
                <p className="small">{keepUnits(`${r.request}: up to ${fl(r.offer.amount)} at up to ${pct(r.offer.max_rate)} a year.`)}</p>
                <p className="small talk">{r.offer.talk_text}</p>
              </div>
              <button className="secondary" onClick={() => setOpenId(r.offer.borrower_id)}>Open the file</button>
            </li>
          ))}
        </ul>
      )}
      <PageTurner pages={pages} />
      <ActionDialog open={chosen !== null} title={chosen ? `${chosen.offer.name}, ${chosen.offer.trade}` : ""} onClose={() => setOpenId(null)} className="merchant-dialog">
        {chosen && <MerchantFile r={chosen} state={state} onDecide={onDecide} />}
      </ActionDialog>
    </>
  );
}

/** A report or inquiry as a document on paper, with its age. */
function FileDocument({ doc }: { doc: FileDoc }) {
  return (
    <article className="file-doc">
      <header>
        <h3><Term id={doc.title === "Full inquiry" ? "inquiry" : "report"}>{doc.title}</Term></h3>
        <span className={doc.stale ? "file-age stale" : "file-age"}>{doc.age}{doc.stale ? ", worth renewing" : ""}</span>
      </header>
      <dl className="bd-lines">
        {doc.lines.map((l) => (
          <div key={l.label} className="contents">
            <dt>{l.term ? <Term id={l.term}>{l.label}</Term> : l.label}</dt>
            <dd>{keepUnits(l.value)}</dd>
          </div>
        ))}
      </dl>
      {doc.remark && <p className="remark">{doc.remark}</p>}
    </article>
  );
}

function MerchantFile({ r, state, onDecide }: { r: MerchantRow; state: GameState; onDecide?: Decide }) {
  const o = r.offer;
  const { error, run } = useRun(onDecide);
  const [lending, setLending] = useState(false);
  const act = (kind: "report" | "inquire" | "consult_analyst") => () => run({ kind, borrower: o.borrower_id } as Decision);
  const action = (k: MerchantRow["actions"][number]["kind"]) => r.actions.find((a) => a.kind === k)!;
  return (
    <div className="merchant-file">
      <section className="merchant-facts">
        <h3>The request</h3>
        <dl className="house-facts">
          <dt>Kind</dt><dd><Term id={o.kind === "commercial" ? "loans" : o.kind}>{KIND_WORDS[o.kind]}</Term></dd>
          <dt>Term</dt><dd>{o.term_quarters} quarters</dd>
          <dt>Amount</dt><dd>{keepUnits(`up to ${fl(o.amount)}`)}</dd>
          <dt>Rate</dt><dd>up to {pct(o.max_rate)} a year</dd>
          <dt>In trade</dt><dd>{o.years_in_trade} years</dd>
          <dt>With the house</dt><dd>{o.repaid === 0 && o.defaulted === 0 ? "no history" : `repaid ${o.repaid}, defaulted ${o.defaulted}`}</dd>
        </dl>
        <h3><Term id="talk">Bourse talk</Term></h3>
        <p className="talk">{o.talk_text}</p>
        <h3><Term id="analyst_opinion">The analyst</Term></h3>
        {r.opinion ? <p className="opinion-note"><strong>{r.opinion.analyst}:</strong> {r.opinion.words}</p> : <p className="muted">No opinion asked for this quarter.</p>}
      </section>
      <section className="merchant-books">
        {r.doc ? <FileDocument doc={r.doc} /> : <p className="muted file-none">The house has no report on these books. A report shows them as kept; an inquiry finds the truth beneath.</p>}
      </section>
      {onDecide && (
        lending ? (
          <LendFields r={r} state={state} onDecide={onDecide} onDone={() => setLending(false)} />
        ) : (
          <div className="act-row">
            <ActButton primary label="Lend" blocked={action("lend").blocked} onClick={() => setLending(true)} />
            <ActButton label={action("report").label} blocked={action("report").blocked} onClick={act("report")} />
            <ActButton label={action("inquire").label} blocked={action("inquire").blocked} onClick={act("inquire")} />
            <ActButton label={action("consult_analyst").label} blocked={action("consult_analyst").blocked} onClick={act("consult_analyst")} />
          </div>
        )
      )}
      {!lending && <Refused error={error} />}
    </div>
  );
}

function LendFields({ r, state, onDecide, onDone }: { r: MerchantRow; state: GameState; onDecide: Decide; onDone: () => void }) {
  const o = r.offer;
  const { error, run } = useRun(onDecide);
  const most = Math.min(o.amount, Math.floor(freeCash(state) / 100) * 100);
  const [amount, setAmount] = useState(String(Math.max(0, most)));
  const [rate, setRate] = useState(String(+(o.max_rate * 100).toFixed(2)));
  const quick = [0.25, 0.5, 1].map((f) => Math.floor((most * f) / 100) * 100);
  return (
    <div className="lend-fields">
      <label className="field-inline">
        <span>Amount (fl.)</span>
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      {quick.map((n, i) => <button key={i} type="button" className="secondary" onClick={() => setAmount(String(n))}>{keepUnits(fl(n))}</button>)}
      <label className="field-inline">
        <span>Rate (% a year)</span>
        <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
      </label>
      <button className="secondary" onClick={onDone}>Back</button>
      <button className="primary" onClick={() => run({ kind: "lend", borrower: o.borrower_id, amount: parseAmount(amount), rate: Number(rate) / 100 }) && onDone()}>Lend</button>
      <Refused error={error} />
    </div>
  );
}

function LoansHeld({ state, onDecide }: { state: GameState; onDecide?: Decide }) {
  const loans = loansHeld(state, gameData);
  const pages = usePages(loans, PER_PAGE + 1);
  const [selling, setSelling] = useState<number | null>(null);
  const chosen = loans.find((l) => l.loan_id === selling) ?? null;
  const { error, run, clear } = useRun(onDecide);
  return (
    <>
      <p className="small muted">
        Loans the house holds. Another house will buy one today for less than it is owed (<Term id="sell_loan">selling a loan</Term>). Click a price to see the discount.
      </p>
      {loans.length === 0 ? <p className="muted">The house holds no loans.</p> : (
        <ul className="rows">
          {pages.items.map((l) => (
            <li key={l.loan_id} className="row-card merchant">
              <div className="merchant-text">
                <p className="row-head"><strong>{l.name}</strong> <span className="chip chip-borrowing">{KIND_WORDS[l.kind]}</span></p>
                <p className="small">{keepUnits(`${fl(l.principal)} at ${pct(l.rate)} a year, ${l.quarters_left} quarter${l.quarters_left === 1 ? "" : "s"} left.`)}</p>
                <p className="small">
                  Sale price{" "}
                  <SumCard title={`Selling the loan to ${l.name}`} summary={`Another house pays ${fl(l.price)} today, ${pct(l.share)} below what is owed.`} term="sell_loan" sections={[salePriceSection(state, l, gameData)]}>
                    {keepUnits(`${fl(l.price)}, ${fl(l.discount)} off (${pct(l.share)})`)}
                  </SumCard>
                </p>
              </div>
              {onDecide && <button className="secondary" disabled={l.blocked !== null} onClick={() => { clear(); setSelling(l.loan_id); }}>Sell</button>}
            </li>
          ))}
        </ul>
      )}
      <PageTurner pages={pages} />
      <ActionDialog open={chosen !== null} title={chosen ? `Sell the loan to ${chosen.name}` : ""} onClose={() => setSelling(null)} className="narrow-dialog">
        {chosen && (
          <>
            <Sums sections={[salePriceSection(state, chosen, gameData)]} />
            <p className="small">The buyer takes the loan as it stands: its interest and its risk. Uses a clerk's time.</p>
            <Refused error={error} />
            <div className="row dialog-buttons">
              <button className="secondary" onClick={() => setSelling(null)}>Cancel</button>
              <button className="primary" onClick={() => run({ kind: "sell_loan", loan: chosen.loan_id }) && setSelling(null)}>{keepUnits(`Sell for ${fl(chosen.price)}`)}</button>
            </div>
          </>
        )}
      </ActionDialog>
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

