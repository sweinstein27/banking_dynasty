// High finance: state loans to bid for and place, credit asked by other houses, auctions of failed
// houses' goods and the assets bought there, and insurance. Every number opens its sums on click;
// every action shows its price, the time it takes and the sim's reason if it would be refused.
import { Tabs } from "radix-ui";
import { useState } from "react";
import { gameData } from "../data";
import { pct } from "../sim/finance/common";
import type { Contract, CoverRequest, HouseRequest, Lot } from "../sim/finance/types";
import { freeCash } from "../sim/reserves";
import type { Decision, GameState } from "../sim/types";
import { fl, keepUnits } from "./format";
import { capacityNote } from "./model/capacity";
import {
  assetRows, bidChoices, commissionChoices, contractRows, contractTerms, coverRows, coverSections, exposureSection, financeSection,
  houseLoanRows, lineChoices, LOT_WORDS, lotRows, policyRows, rateChoices, redemptionRows, requestRows,
} from "./model/finance";
import { PageTurner, usePages } from "./Pager";
import { ActButton, ChoiceDialog, Refused, SumCard, useRun } from "./ScreenKit";
import { Term } from "./Term";
import { dateOfTurn } from "../sim/chronicle";

type Decide = (d: Decision) => string | null;
const when = (turn: number) => {
  const d = dateOfTurn(turn, gameData.tuning);
  return `${d.year} Q${d.quarter}`;
};

export function FinancePanel({ state, onDecide }: { state: GameState; onDecide?: Decide }) {
  const book = financeSection(state);
  return (
    <div className="doc finance">
      <p className="small muted finance-summary">
        <Term id="high_finance">High finance</Term> in the books:{" "}
        <SumCard title="High finance" summary="Credit to houses, assets at their appraisal, and caution money the states hold." sections={[book]}>
          {keepUnits(fl(book.total!.amount!))}
        </SumCard>
        ; free cash {keepUnits(fl(freeCash(state)))}
      </p>
      <Tabs.Root defaultValue="loans" className="doc-tabs">
        <Tabs.List className="ribbons" aria-label="High finance">
          <Tabs.Trigger value="loans" className="ribbon">State loans</Tabs.Trigger>
          <Tabs.Trigger value="credit" className="ribbon">Houses' credit</Tabs.Trigger>
          <Tabs.Trigger value="auctions" className="ribbon">Auctions</Tabs.Trigger>
          <Tabs.Trigger value="insurance" className="ribbon">Insurance</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="loans" className="doc-page"><StateLoans state={state} onDecide={onDecide} /></Tabs.Content>
        <Tabs.Content value="credit" className="doc-page"><HouseCredit state={state} onDecide={onDecide} /></Tabs.Content>
        <Tabs.Content value="auctions" className="doc-page"><Auctions state={state} onDecide={onDecide} /></Tabs.Content>
        <Tabs.Content value="insurance" className="doc-page"><Insurance state={state} onDecide={onDecide} /></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

// ---------- State loans ----------

function StateLoans({ state, onDecide }: { state: GameState; onDecide?: Decide }) {
  const rows = contractRows(state, gameData);
  const pages = usePages(rows, 4);
  const carried = redemptionRows(state, gameData);
  const [bidding, setBidding] = useState<Contract | null>(null);
  return (
    <>
      <p className="small muted">
        States raise <Term id="state_loan">loans</Term> through a house. Bid the <Term id="commission">commission</Term> you ask; win, pay the <Term id="caution_money">caution money</Term>, and <Term id="placement">place</Term> the bonds with investors.
      </p>
      <div className="finance-columns loans-columns">
      <section>
      {rows.length === 0 ? (
        <p className="muted">No state seeks a loan this quarter. States announce their loans a quarter ahead, more often in calm years.</p>
      ) : (
        <ul className="rows">
          {pages.items.map((r) => {
            const c = r.contract;
            return (
              <li key={c.id} className={`row-card ${r.phase === "done" ? "blocked" : ""}`}>
                <p className="row-head">
                  <strong>{r.stateName}: {keepUnits(fl(c.size))} at {pct(c.coupon)} for {c.term_years} years</strong>
                  <span className={`chip ${r.phase === "open" ? "chip-asking" : r.phase === "placing" ? "chip-borrowing" : ""}`}>
                    {r.phase === "open" ? "Open for bids" : r.phase === "announced" ? "Bids next quarter" : r.phase === "placing" ? "Placing" : "Done"}
                  </span>
                </p>
                {r.phase === "open" || r.phase === "announced" ? (
                  <p className="small">
                    Reputation asked {r.gate} (yours {state.house.reputation}). Caution money: {keepUnits(fl(r.caution))}
                    {c.player_bid !== null && <strong> Your bid: {pct(c.player_bid)}; the award comes at End Turn.</strong>}
                  </p>
                ) : r.phase === "placing" ? (
                  <p className="small">
                    {keepUnits(fl(c.placed))} placed of {keepUnits(fl(c.size))} after {c.quarters_placed} of {gameData.finance.contracts.placement.quarters} quarters, at {c.issue_price} and {pct(c.commission ?? 0)} commission. Investors take about{" "}
                    <SumCard title="Placing the loan" summary="The share of what is left that investors take each quarter." term="placement" sections={r.placement!.sections}>
                      {pct(r.placement!.rate)}
                    </SumCard>{" "}
                    of the rest a quarter. Caution held: {keepUnits(fl(c.caution))}
                  </p>
                ) : (
                  <p className="small">{r.outcome}{c.player_bid !== null && c.winner !== "player" ? `. Your bid was ${pct(c.player_bid)}.` : ""}</p>
                )}
                {r.phase === "open" && onDecide && c.player_bid === null && (
                  <div className="act-row">
                    <ActButton label="Bid for it" blocked={r.blocked} onClick={() => setBidding(c)} primary />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <PageTurner pages={pages} />
      </section>
      <section>
          <h3>Bonds carried from loans</h3>
          {carried.length === 0 ? <p className="muted">None. What investors will not take at the close, the house buys; it is redeemed at par when the term ends.</p> : (
          <table className="market-table">
            <thead><tr><th>State</th><th className="num">Face</th><th className="num">Held at</th><th className="num">Redeemed at par</th></tr></thead>
            <tbody>
              {carried.map((b) => (
                <tr key={b.bond}><td>{b.name}</td><td className="num">{keepUnits(fl(b.face))}</td><td className="num">{keepUnits(fl(b.book))}</td><td className="num">{when(b.turn)}</td></tr>
              ))}
            </tbody>
          </table>
          )}
      </section>
      </div>
      <ChoiceDialog
        open={bidding !== null}
        title={bidding ? `Bid for the ${rows.find((r) => r.contract.id === bidding.id)?.stateName ?? ""} loan` : ""}
        terms={bidding ? [contractTerms(state, bidding, gameData)] : []}
        choices={bidding ? commissionChoices(state, bidding, gameData) : []}
        time={capacityNote(state, "bid_contract", gameData)}
        confirm="Place the bid"
        initial={0.02}
        onPick={(commission) => onDecide?.({ kind: "bid_contract", contract: bidding!.id, commission }) ?? "The run is over"}
        onClose={() => setBidding(null)}
      />
    </>
  );
}

// ---------- Credit to houses ----------

function HouseCredit({ state, onDecide }: { state: GameState; onDecide?: Decide }) {
  const rows = requestRows(state, gameData);
  const loans = houseLoanRows(state);
  const reqPages = usePages(rows, 3);
  const loanPages = usePages(loans, 7);
  const [lending, setLending] = useState<HouseRequest | null>(null);
  const r = lending ? rows.find((x) => x.request.id === lending.id) : undefined;
  return (
    <>
      <p className="small muted">
        Houses in trouble ask quietly for <Term id="house_credit">credit</Term> in uneasy years. A fair rate wins their goodwill; while they owe you, they are less likely to fail.
      </p>
      <div className="finance-columns">
      <section>
      <h3>Asking now</h3>
      {rows.length === 0 ? (
        <p className="muted">No house asks for credit. Requests come when the market is uneasy or in panic.</p>
      ) : (
        <ul className="rows">
          {reqPages.items.map((x) => (
            <li key={x.request.id} className="row-card">
              <p className="row-head">
                <strong>{x.name} asks {keepUnits(fl(x.request.amount))} for {x.request.term_quarters} quarters</strong>
                <span className={`chip ${x.open ? "chip-asking" : ""}`}>{x.open ? "Open now" : "Next quarter"}</span>
              </p>
              <p className="small">Pays up to {pct(x.request.max_rate)} a year. Their <Term id="opinion">opinion</Term> of you: {x.opinion}.</p>
              {x.open && onDecide && (
                <div className="act-row"><ActButton label="Lend" blocked={x.blocked} onClick={() => setLending(x.request)} primary /></div>
              )}
            </li>
          ))}
        </ul>
      )}
      <PageTurner pages={reqPages} />
      </section>
      <section>
      <h3>Credit outstanding</h3>
      {loans.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <table className="market-table">
          <thead><tr><th>House</th><th className="num">Owed</th><th className="num">Rate</th><th className="num">Interest a quarter</th><th className="num">Due</th></tr></thead>
          <tbody>
            {loanPages.items.map((l) => (
              <tr key={l.loan.id}>
                <td>{l.name}</td>
                <td className="num">{keepUnits(fl(l.loan.principal))}</td>
                <td className="num">{pct(l.loan.rate)}</td>
                <td className="num">{keepUnits(fl(l.interest))}</td>
                <td className="num">{when(l.loan.due_turn)}{l.quartersLeft > 0 ? ` (${l.quartersLeft} q.)` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <PageTurner pages={loanPages} />
      </section>
      </div>
      <ChoiceDialog
        open={lending !== null}
        title={r ? `Lend ${fl(r.request.amount)} to ${r.name}` : ""}
        terms={r ? [{
          heading: `${r.name} asks for a year's credit`,
          lines: [
            { label: "Amount, paid out now", value: fl(r.request.amount) },
            { label: "Free cash now", value: fl(freeCash(state)) },
            { label: "Term", value: `${r.request.term_quarters} quarters, interest each quarter` },
            { label: "The most it can pay", value: pct(r.request.max_rate) },
            { label: "If it fails, the estate pays back", value: `${pct(gameData.finance.house_loans.recovery.calm)} in calm years, less in a panic` },
          ],
        }] : []}
        choices={r ? rateChoices(state, r.request, gameData) : []}
        time={capacityNote(state, "lend_house", gameData)}
        confirm="Lend"
        initial={r?.request.max_rate}
        onPick={(rate) => onDecide?.({ kind: "lend_house", request: lending!.id, rate }) ?? "The run is over"}
        onClose={() => setLending(null)}
      />
    </>
  );
}

// ---------- Auctions and assets ----------

function Auctions({ state, onDecide }: { state: GameState; onDecide?: Decide }) {
  const lots = lotRows(state, gameData);
  const assets = assetRows(state, gameData);
  const lotPages = usePages(lots, 3);
  const assetPages = usePages(assets, 5);
  const { error, run } = useRun(onDecide);
  const [bidding, setBidding] = useState<Lot | null>(null);
  return (
    <>
      <p className="small muted">
        The receivers of failed houses and defaulted borrowers sell their goods at <Term id="auction">auction</Term>. Bid a share of the <Term id="appraisal">appraisal</Term>; the highest bid wins at End Turn.
      </p>
      <div className="finance-columns">
        <section>
          <h3>Lots</h3>
          {lots.length === 0 ? (
            <p className="muted">Nothing is up for auction. Lots come when a house fails or a secured loan defaults.</p>
          ) : (
            <ul className="rows">
              {lotPages.items.map((l) => (
                <li key={l.lot.id} className="row-card">
                  <p className="row-head">
                    <strong>{l.lot.name}</strong>
                    <span className="chips">
                      <span className="chip">{LOT_WORDS[l.lot.kind]}</span>
                      <span className={`chip ${l.open ? "chip-asking" : ""}`}>{l.open ? "Selling now" : "Next quarter"}</span>
                    </span>
                  </p>
                  <p className="small">
                    Appraised at {keepUnits(fl(l.lot.appraisal))}, from {l.lot.source}{l.lot.shares ? `: ${l.lot.shares} shares` : ""}. {l.earns}.
                    {l.lot.player_bid !== null && <strong> Your bid: {pct(l.lot.player_bid)} of the appraisal.</strong>}
                  </p>
                  {l.open && onDecide && l.lot.player_bid === null && (
                    <div className="act-row"><ActButton label="Bid" blocked={l.blocked} onClick={() => setBidding(l.lot)} primary /></div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <PageTurner pages={lotPages} />
        </section>
        <section>
          <h3>Assets the house owns</h3>
          {assets.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <>
              <p className="small muted">Sold privately at {pct(gameData.finance.auctions.sale_discount)} below the appraisal. {capacityNote(state, "sell_asset", gameData)}. None is insured.</p>
              <table className="market-table">
                <thead><tr><th>Asset</th><th className="num">Appraised</th><th className="num">Earns a quarter</th><th /></tr></thead>
                <tbody>
                  {assetPages.items.map((a) => (
                    <tr key={a.asset.id}>
                      <td>{a.asset.name}<br /><small>{pct(a.lossChance)} chance of loss a quarter</small></td>
                      <td className="num">{keepUnits(fl(a.asset.appraisal))}<br /><small>paid {keepUnits(fl(a.asset.paid))}</small></td>
                      <td className="num">
                        <SumCard title={a.asset.name} summary="What it earns this quarter and the chance it is lost." sections={a.sections}>
                          {keepUnits(fl(a.income))}
                        </SumCard>
                      </td>
                      <td className="trade-cell">
                        {onDecide && (
                          <>
                            <button className="secondary" disabled={a.blocked !== null} onClick={() => run({ kind: "sell_asset", asset: a.asset.id })}>{keepUnits(`Sell, ${fl(a.salePrice)}`)}</button>
                            {a.blocked && <span className="act-why cell-why">{keepUnits(a.blocked)}</span>}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <PageTurner pages={assetPages} />
            </>
          )}
        </section>
      </div>
      <Refused error={error} />
      <ChoiceDialog
        open={bidding !== null}
        title={bidding ? `Bid for ${bidding.name}` : ""}
        terms={bidding ? [{
          heading: `${LOT_WORDS[bidding.kind]} from ${bidding.source}`,
          lines: [
            { label: "Appraisal", value: fl(bidding.appraisal), term: "appraisal" },
            { label: "Paid only if the bid wins, at End Turn", value: "from cash" },
            { label: "Free cash now", value: fl(freeCash(state)) },
            { label: "Other houses bid with the market's mood", value: state.world.sentiment },
          ],
        }] : []}
        choices={bidding ? bidChoices(state, bidding, gameData) : []}
        time={capacityNote(state, "bid_lot", gameData)}
        confirm="Place the bid"
        initial={0.7}
        onPick={(bid) => onDecide?.({ kind: "bid_lot", lot: bidding!.id, bid }) ?? "The run is over"}
        onClose={() => setBidding(null)}
      />
    </>
  );
}

// ---------- Insurance ----------

function Insurance({ state, onDecide }: { state: GameState; onDecide?: Decide }) {
  const requests = coverRows(state, gameData);
  const policies = policyRows(state);
  const exp = exposureSection(state);
  const reqPages = usePages(requests, 3);
  const polPages = usePages(policies, 7);
  const [covering, setCovering] = useState<CoverRequest | null>(null);
  return (
    <>
      <p className="small muted">
        Merchants ask the house to share the risk of a voyage or a warehouse: <Term id="insurance">insurance</Term>. The premium comes in now; a loss is paid when it happens.{" "}
        <Term id="exposure">Exposure</Term>:{" "}
        <SumCard title="Exposure" summary="What the house would pay if every insured ship and warehouse were lost." sections={[exp]}>
          {keepUnits(fl(exp.total!.amount!))}
        </SumCard>
        {state.finance.storm_turn !== null && `; the last great storm, ${when(state.finance.storm_turn)}.`}
      </p>
      <div className="finance-columns">
      <section>
      <h3>Asking for cover</h3>
      {requests.length === 0 ? (
        <p className="muted">No one asks for cover this quarter.</p>
      ) : (
        <ul className="rows">
          {reqPages.items.map((r) => (
            <li key={r.request.id} className="row-card">
              <p className="row-head">
                <strong>{r.name[0]!.toUpperCase() + r.name.slice(1)}</strong>
                <span className={`chip ${r.open ? "chip-asking" : ""}`}>{r.open ? "Open now" : "Next quarter"}</span>
              </p>
              <p className="small">
                {keepUnits(`Insured for ${fl(r.request.value)} for ${r.request.quarters} quarter${r.request.quarters === 1 ? "" : "s"}, at a premium of `)}
                <SumCard title="The odds" summary="What the house's underwriter knows of this risk." sections={coverSections(state, r.request, gameData)}>
                  {pct(r.request.premium_rate)}
                </SumCard>
                .
              </p>
              {r.open && onDecide && (
                <div className="act-row"><ActButton label="Underwrite" blocked={r.blocked} onClick={() => setCovering(r.request)} primary /></div>
              )}
            </li>
          ))}
        </ul>
      )}
      <PageTurner pages={reqPages} />
      </section>
      <section>
      <h3>Policies written</h3>
      {policies.length === 0 ? (
        <p className="muted">None in force.</p>
      ) : (
        <table className="market-table">
          <thead><tr><th>Insured</th><th className="num">Line</th><th className="num">At risk</th><th className="num">Premium</th><th className="num">Quarters left</th></tr></thead>
          <tbody>
            {polPages.items.map((p) => (
              <tr key={p.policy.id}>
                <td>{p.name}</td>
                <td className="num">{pct(p.policy.line)}</td>
                <td className="num">{keepUnits(fl(p.policy.value))}</td>
                <td className="num">{keepUnits(fl(p.policy.premium))}</td>
                <td className="num">{p.quartersLeft}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <PageTurner pages={polPages} />
      </section>
      </div>
      <ChoiceDialog
        open={covering !== null}
        title={covering ? `Insure ${requests.find((r) => r.request.id === covering.id)?.name ?? ""}` : ""}
        terms={covering ? coverSections(state, covering, gameData) : []}
        choices={covering ? lineChoices(state, covering, gameData) : []}
        time={capacityNote(state, "underwrite", gameData)}
        confirm="Underwrite"
        onPick={(line) => onDecide?.({ kind: "underwrite", request: covering!.id, line }) ?? "The run is over"}
        onClose={() => setCovering(null)}
      />
    </>
  );
}
