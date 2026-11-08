// Markets: the bourse's companies, goods at Frankfurt, the year's harvest, and the house's
// ventures as long projects. Every trade opens a small dialog that shows its cost with commission
// and the sim's reason if it would be refused.
import { Tabs } from "radix-ui";
import { useState } from "react";
import { gameData } from "../data";
import { capacityLeft } from "../sim/capacity";
import { ventureOffers } from "../sim/offers";
import { freeCash } from "../sim/reserves";
import type { Decision, GameState } from "../sim/types";
import { DECISION_LABELS, DecisionDialog } from "./DecisionDialogs";
import { fl, keepUnits, parseAmount, pct } from "./format";
import { Icon } from "./icons";
import { companyRows, goodsRows, goodsTrade, harvestView, price, roomFor, shareTrade, ventureRows, warehouse, type CompanyRow, type GoodsRow, type Trend, type VentureRow } from "./model/markets";
import { PageTurner, usePages } from "./Pager";
import { ActButton, ActionDialog, Refused, useRun } from "./ScreenKit";
import { Term } from "./Term";

type Decide = (d: Decision) => string | null;

export function MarketsPanel({ state, onDecide }: { state: GameState; onDecide?: Decide }) {
  return (
    <div className="doc markets">
      <Tabs.Root defaultValue="companies" className="doc-tabs">
        <Tabs.List className="ribbons" aria-label="The markets">
          <Tabs.Trigger value="companies" className="ribbon">Companies</Tabs.Trigger>
          <Tabs.Trigger value="goods" className="ribbon">Goods</Tabs.Trigger>
          <Tabs.Trigger value="harvest" className="ribbon">Harvest</Tabs.Trigger>
          <Tabs.Trigger value="ventures" className="ribbon">Ventures</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="companies" className="doc-page"><Companies state={state} onDecide={onDecide} /></Tabs.Content>
        <Tabs.Content value="goods" className="doc-page"><Goods state={state} onDecide={onDecide} /></Tabs.Content>
        <Tabs.Content value="harvest" className="doc-page"><Harvest state={state} /></Tabs.Content>
        <Tabs.Content value="ventures" className="doc-page"><Ventures state={state} onDecide={onDecide} /></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

// ---------- Trades ----------

interface TradeSpec {
  side: "buy" | "sell";
  /** "shares of the Bank of Frankfurt", "Malter of grain". */
  what: string;
  unit: string;
  /** The most that makes sense: shares in other hands, room in the warehouse, units held. */
  most: number;
  quote: (n: number) => { amount: number; blocked: string | null };
  decision: (n: number) => Decision;
}

function TradeDialog({ spec, onClose, onDecide }: { spec: TradeSpec | null; onClose: () => void; onDecide?: Decide }) {
  return (
    <ActionDialog open={spec !== null} title={spec ? `${spec.side === "buy" ? "Buy" : "Sell"} ${spec.what}` : ""} onClose={onClose} className="narrow-dialog">
      {spec && <TradeForm key={`${spec.side}${spec.what}`} spec={spec} onClose={onClose} onDecide={onDecide} />}
    </ActionDialog>
  );
}

function TradeForm({ spec, onClose, onDecide }: { spec: TradeSpec; onClose: () => void; onDecide?: Decide }) {
  const { error, run } = useRun(onDecide);
  const [text, setText] = useState(String(Math.min(spec.most, 10)));
  const n = parseAmount(text);
  const q = spec.quote(n);
  const quick = [...new Set([10, 50, 100, spec.most].filter((x) => x > 0 && x <= spec.most))];
  return (
    <>
      <div className="field">
        <label>
          <span>{spec.unit[0]!.toUpperCase() + spec.unit.slice(1)}</span>
          <input inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="row">
          {quick.map((x) => <button key={x} type="button" className="secondary" onClick={() => setText(String(x))}>{x === spec.most ? `All (${x})` : x}</button>)}
        </div>
      </div>
      <p>
        {spec.side === "buy" ? "Costs" : "Raises"} {keepUnits(fl(q.amount))} with the broker's <Term id="commission">commission</Term>. Uses a clerk's time.
      </p>
      {q.blocked && <p className="small error">{keepUnits(q.blocked)}</p>}
      <Refused error={error} />
      <div className="row dialog-buttons">
        <button className="secondary" onClick={onClose}>Cancel</button>
        <button className="primary" disabled={q.blocked !== null} onClick={() => run(spec.decision(n)) && onClose()}>{spec.side === "buy" ? "Buy" : "Sell"}</button>
      </div>
    </>
  );
}

const TREND_WORD: Record<Trend, string> = { up: "rising", down: "falling", level: "steady" };
function TrendMark({ t }: { t: Trend }) {
  return <span className={`trend-word trend-${t}`}><Icon name={t} className={`trend trend-${t}`} />{TREND_WORD[t]}</span>;
}

// ---------- Companies ----------

function Companies({ state, onDecide }: { state: GameState; onDecide?: Decide }) {
  const rows = companyRows(state, gameData);
  const pages = usePages(rows, 10);
  const [trade, setTrade] = useState<TradeSpec | null>(null);
  const { error, run } = useRun(onDecide);
  const busy = onDecide === undefined || capacityLeft(state, gameData.tuning) === 0;
  const spec = (c: CompanyRow, side: "buy" | "sell"): TradeSpec => ({
    side,
    what: `shares of ${c.name}`,
    unit: "shares",
    most: side === "buy" ? c.available : c.held,
    quote: (n) => shareTrade(state, c.id, n, side, gameData),
    decision: (n) => ({ kind: side === "buy" ? "buy_shares" : "sell_shares", company: c.id, shares: n }),
  });
  return (
    <>
      <p className="small muted">
        Companies on the Frankfurt bourse: <Term id="shares">shares</Term>, their <Term id="dividend">dividend</Term> and the house's <Term id="earnings_estimate">estimate of their earnings</Term>. Buy a report to narrow it. Free cash: {keepUnits(fl(freeCash(state)))}
      </p>
      {!rows.some((c) => c.status === "listed") && <p className="muted">No company is listed on the bourse yet. The first lists in {Math.min(...rows.map((c) => c.listYear ?? 9999))}.</p>}
      <table className="market-table">
        <thead>
          <tr><th>Company</th><th className="num">Price</th><th className="num">Dividend</th><th className="num">Earnings a year</th><th className="num">The house holds</th><th /></tr>
        </thead>
        <tbody>
          {pages.items.map((c) => (
            <tr key={c.id} className={c.status !== "listed" ? "dim" : undefined}>
              <td>
                <strong>{c.name}</strong> <span className="chip">{c.sector}</span>
                {c.floated && <span className="chip chip-borrowing">your venture</span>}
                {c.status === "failed" && <span className="chip chip-away">failed</span>}
              </td>
              {c.status === "upcoming" ? (
                <td colSpan={5} className="muted">Lists on the bourse in {c.listYear}.</td>
              ) : (
                <>
                  <td className="num">{keepUnits(price(c.price))}</td>
                  <td className="num">{keepUnits(price(c.dividend))}<br /><small>{pct(c.yield)} yield</small></td>
                  <td className="num">{keepUnits(`${fl(c.estimate.low)} to ${fl(c.estimate.high)}`)}<br /><small>from {c.estimate.source}</small></td>
                  <td className="num">{c.held > 0 ? <>{c.held} shares<br /><small>{keepUnits(fl(c.value))}</small></> : "none"}</td>
                  <td className="trade-cell">
                    {onDecide && c.status === "listed" && (
                      <>
                        <button className="secondary" disabled={busy || c.available <= 0} onClick={() => setTrade(spec(c, "buy"))}>Buy</button>
                        <button className="secondary" disabled={busy || c.held === 0} onClick={() => setTrade(spec(c, "sell"))}>Sell</button>
                        {c.report && (
                          <>
                          <button className="secondary" disabled={c.report.blocked !== null} onClick={() => run({ kind: "company_report", company: c.id, tier: c.report!.tier })}>
                            {keepUnits(`${c.report.tier === 1 ? "Report" : "Inquiry"}, ${fl(c.report.cost)}`)}
                          </button>
                          {c.report.blocked && <span className="act-why cell-why">{keepUnits(c.report.blocked)}</span>}
                          </>
                        )}
                      </>
                    )}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <Refused error={error} />
      <PageTurner pages={pages} />
      <TradeDialog spec={trade} onClose={() => setTrade(null)} onDecide={onDecide} />
    </>
  );
}

// ---------- Goods ----------

function Goods({ state, onDecide }: { state: GameState; onDecide?: Decide }) {
  const rows = goodsRows(state, gameData);
  const w = warehouse(state, gameData);
  const [trade, setTrade] = useState<TradeSpec | null>(null);
  const busy = onDecide === undefined || capacityLeft(state, gameData.tuning) === 0;
  const spec = (g: GoodsRow, side: "buy" | "sell"): TradeSpec => ({
    side,
    what: `${g.name.toLowerCase()}`,
    unit: `${g.unit}s`,
    most: side === "buy" ? roomFor(state, g.id, gameData) : g.held,
    quote: (n) => goodsTrade(state, g.id, n, side, gameData),
    decision: (n) => ({ kind: side === "buy" ? "buy_commodity" : "sell_commodity", commodity: g.id, units: n }),
  });
  const storage = rows.reduce((n, g) => n + g.storageBill, 0);
  return (
    <>
      <div className="warehouse-gauge">
        <span><Term id="warehouse">Warehouse</Term>:</span>
        {w.space === 0 ? (
          <span className="small">The house has none, so it can hold no goods. Build one in the House.</span>
        ) : (
          <>
            <span className="gauge" aria-label={`${w.used} of ${w.space} units used`}><span style={{ width: `${Math.min(100, (100 * w.used) / w.space)}%` }} /></span>
            <span className="small">{w.used} of {w.space} units used, {w.free} free</span>
          </>
        )}
        <span className="small"><Term id="storage">Storage</Term> this quarter: {keepUnits(fl(storage))}</span>
        <span className="small">Free cash: {keepUnits(fl(freeCash(state)))}</span>
      </div>
      <table className="market-table">
        <thead>
          <tr><th><Term id="goods">Goods</Term></th><th className="num">Price</th><th>Trend</th><th className="num">Against a fair year</th><th className="num">Held</th><th className="num">Storage a quarter</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.id}>
              <td><strong>{g.name}</strong><br /><small>{g.space} unit{g.space === 1 ? "" : "s"} of space a {g.unit}</small></td>
              <td className="num">{keepUnits(price(g.price))}<br /><small>a {g.unit}</small></td>
              <td><TrendMark t={g.trend} /></td>
              <td className="num">{pct(g.vsBase - 1).replace(/^(?!-)/, "+")}</td>
              <td className="num">{g.held > 0 ? <>{g.held} {g.unit}s<br /><small>{keepUnits(fl(g.value))}</small></> : "none"}</td>
              <td className="num">{keepUnits(price(g.storage))} a {g.unit}{g.spoilage > 0 && <><br /><small>{pct(g.spoilage)} spoils</small></>}</td>
              <td className="trade-cell">
                {onDecide && (
                  <>
                    <button className="secondary" disabled={busy || roomFor(state, g.id, gameData) === 0} onClick={() => setTrade(spec(g, "buy"))}>Buy</button>
                    <button className="secondary" disabled={busy || g.held === 0} onClick={() => setTrade(spec(g, "sell"))}>Sell</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <TradeDialog spec={trade} onClose={() => setTrade(null)} onDecide={onDecide} />
    </>
  );
}

// ---------- Harvest ----------

function Harvest({ state }: { state: GameState }) {
  const h = harvestView(state, gameData);
  return (
    <>
      <p className="small muted">
        This year's <Term id="harvest">harvest</Term>, gathered each summer. It moves the price of grain and wine and the risk of lending to some trades.
      </p>
      <ul className="harvest-regions">
        {h.regions.map((r) => (
          <li key={r.id} className={`row-card harvest-${r.index < 1 ? "bad" : r.index > 1 ? "good" : "fair"}`}>
            <p className="row-head"><strong>{r.name[0]!.toUpperCase() + r.name.slice(1)}</strong></p>
            <p className="harvest-outcome">{r.outcome[0]!.toUpperCase() + r.outcome.slice(1)}</p>
            <p className="small">{pct(r.index)} of a fair year</p>
          </li>
        ))}
      </ul>
      <p>All regions together: <strong>{pct(h.index)}</strong> of a fair year.</p>
      <div className="sheet-columns">
        <section>
          <h3>Prices it moves</h3>
          <ul className="plain">
            {h.goods.map((g) => <li key={g.name}>{g.name}, grown in {g.regions}: <TrendMark t={g.trend} /></li>)}
          </ul>
        </section>
        <section>
          <h3><Term id="trade_risk">Borrowers it touches</Term></h3>
          <ul className="plain">
            {h.trades.map((t) => (
              <li key={t.trade}>
                {t.trade[0]!.toUpperCase() + t.trade.slice(1)}{t.trade.endsWith("er") ? "s" : " houses"}:{" "}
                <span className={t.factor > 1.01 ? "tone-bad" : t.factor < 0.99 ? "tone-good" : ""}>
                  {Math.abs(t.factor - 1) > 0.01 ? `${t.factor.toFixed(2)} times as likely to default` : "no change in risk"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

// ---------- Ventures ----------

function Ventures({ state, onDecide }: { state: GameState; onDecide?: Decide }) {
  const rows = ventureRows(state, gameData);
  const pages = usePages(rows, 3);
  const offers = ventureOffers(state, gameData);
  const offerPages = usePages(offers, 4);
  const [backing, setBacking] = useState(false);
  const { error, run } = useRun(onDecide);
  const can = onDecide !== undefined && capacityLeft(state, gameData.tuning) > 0;
  return (
    <div className="venture-columns">
      <section className="venture-held">
        <h3>The house's <Term id="ventures">ventures</Term></h3>
        {rows.length === 0 ? <p className="muted">The house has backed no venture.</p> : (
          <ul className="rows">
            {pages.items.map((v) => <VentureCard key={v.id} v={v} onSell={onDecide ? () => run({ kind: "sell_venture", venture: v.id }) : undefined} />)}
          </ul>
        )}
        <Refused error={error} />
        <PageTurner pages={pages} />
      </section>
      <section className="venture-offers">
        <h3>Open to backing</h3>
        <ul className="rows">
          {offerPages.items.map((o) => {
            const t = gameData.ventures.find((x) => x.id === o.id)!;
            return (
              <li key={o.id} className={`row-card ${o.blocked ? "blocked" : ""}`}>
                <p className="row-head"><strong>{o.name}</strong> <span className={`chip ${o.blocked ? "chip-away" : "chip-asking"}`}>{o.blocked ?? t.tier}</span></p>
                <p className="small">{t.calls} <Term id="calls">calls</Term>, {t.call_every === 1 ? "one a quarter" : `one every ${t.call_every} quarters`}; built in {o.term_quarters} quarters.</p>
                <p className="small">{t.tier === "short" ? `Returns ${pct(o.expected_return)} on success.` : `Earns about ${pct(o.expected_return)} a year once running.`} Fails {pct(o.failure_chance)} of the time in today's market.</p>
              </li>
            );
          })}
        </ul>
        <PageTurner pages={offerPages} />
        {onDecide && <div className="row page-actions"><button className="primary" disabled={!can} onClick={() => setBacking(true)}>{DECISION_LABELS.invest_venture}</button></div>}
      </section>
      {onDecide && <DecisionDialog kind={backing ? "invest_venture" : null} state={state} onClose={() => setBacking(false)} onSubmit={onDecide} />}
    </div>
  );
}

function VentureCard({ v, onSell }: { v: VentureRow; onSell?: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const tag = v.status === "listed" ? "Listed" : v.phase === "running" ? "Running" : "Building";
  return (
    <li className="row-card venture-card">
      <p className="row-head"><strong>{v.name} #{v.id}</strong> <span className={`chip ${v.status === "listed" ? "chip-asking" : "chip-borrowing"}`}>{tag}</span></p>
      <div className="calls" aria-label={`${v.callsPaid} of ${v.calls} calls paid`}>
        {Array.from({ length: v.calls }, (_, i) => (
          <span key={i} className={`call ${i < v.callsPaid ? "paid" : ""} ${i >= v.callsPlanned ? "overrun" : ""}`} />
        ))}
        <span className="small">{v.callsPaid} of {v.calls} <Term id="calls">calls</Term> paid{v.overrunCalls > 0 && <>, <span className="tone-bad">{v.overrunCalls} added by <Term id="overrun">overruns</Term></span></>}</span>
      </div>
      <p className="small">
        {keepUnits(`Committed ${fl(v.committed)}, paid in ${fl(v.called)}${v.toCome > 0 ? `; ${fl(v.toCome)} to come, next call ${fl(v.next)}` : ""}`)}
      </p>
      <p className="small">
        {v.phase === "building" ? `Building: ${v.buildLeft} quarter${v.buildLeft === 1 ? "" : "s"} left.` : keepUnits(`Running: earned ${fl(v.earnings)} on the stake in the last year.`)}
        {v.sections.of > 1 && <> <Term id="sections">Sections</Term> open: {v.sections.open} of {v.sections.of}.</>}
        {v.proveLeft !== null && <> {v.proveLeft > 0 ? `May list after ${v.proveLeft} more quarters if it earns well.` : "May list at the next End Turn if it earns well."} (<Term id="listing">listing</Term>)</>}
      </p>
      {v.listing && (v.listing.failed
        ? <p className="small error">{v.listing.company} has failed: its shares are worth nothing.</p>
        : <p className="small good">{keepUnits(`Listed as ${v.listing.company} at ${price(v.listing.price)} a share: the house holds ${v.listing.held} shares worth ${fl(v.listing.value)} Sell them under Companies.`)}</p>)}
      {v.sale && onSell && (
        <div className="act-row">
          {confirming ? (
            <>
              <span className="small">{keepUnits(`Sell ${fl(v.invested)} paid in for ${fl(v.sale.price)}, with no more calls?`)}</span>
              <button className="secondary" onClick={() => setConfirming(false)}>Keep it</button>
              <button className="primary" onClick={() => { onSell(); setConfirming(false); }}>Sell</button>
            </>
          ) : (
            <ActButton label={`Sell the stake privately for ${fl(v.sale.price)}`} blocked={v.sale.blocked} onClick={() => setConfirming(true)} />
          )}
        </div>
      )}
    </li>
  );
}
