// Europe: a hand-drawn map of the house's world, its cities as Frankfurt knows them (the news is
// always late), the courier roads, and the house's branches and bills. A click on a city (on the map
// or in the list under it) opens its sheet: what is known of it, how late, the exchange, the branch
// and bills on it, each number with its sums and each decision with its price and the sim's verdict.
import { Tabs } from "radix-ui";
import { useState } from "react";
import { gameData } from "../data";
import { dateOfTurn } from "../sim/chronicle";
import { freeCash } from "../sim/reserves";
import type { Decision, GameState } from "../sim/types";
import { fl, keepUnits, parseAmount } from "./format";
import { capacityNote } from "./model/capacity";
import {
  billQuote, billTime, branchView, cityPins, delaySections, europeSection, fundBlocked, LAND_PATHS, MAP_H, MAP_W, MOOD_WORDS,
  openBlocked, openCandidates, openCostSection, openRisk, quoteSections, roads, STATUS_WORDS, type CityPin,
} from "./model/europe";
import { ActButton, Refused, SumCard, useRun } from "./ScreenKit";
import { Term } from "./Term";

type Decide = (d: Decision) => string | null;
const quarterOf = (turn: number) => {
  const d = dateOfTurn(turn, gameData.tuning);
  return `${d.year} Q${d.quarter}`;
};

export function EuropePanel({ state, onDecide }: { state: GameState; onDecide?: Decide }) {
  const pins = cityPins(state, gameData);
  const firstBranch = pins.find((p) => p.branch)?.city.id;
  const [picked, setPicked] = useState<string>(firstBranch ?? "london");
  const pin = pins.find((p) => p.city.id === picked) ?? pins[1]!;
  const book = europeSection(state, gameData);
  return (
    <div className="doc europe">
      <p className="small muted europe-summary">
        Cities as last heard in Frankfurt: the <Term id="news_delay">news is late</Term>. Branches and bills abroad in the books:{" "}
        <SumCard title="Abroad" summary="Branches at the Frankfurt quote, and bills at what they cost." sections={[book]}>{keepUnits(fl(book.total!.amount!))}</SumCard>;
        free cash {keepUnits(fl(freeCash(state)))}
      </p>
      <div className="europe-layout">
        <div className="map-column">
          <EuropeMap pins={pins} picked={pin.city.id} onPick={setPicked} />
          <div className="city-buttons" role="group" aria-label="Cities">
            {pins.filter((p) => !p.home).map((p) => (
              <button key={p.city.id} className={p.city.id === pin.city.id ? "secondary on" : "secondary"} aria-pressed={p.city.id === pin.city.id} onClick={() => setPicked(p.city.id)}>
                <span className={`mood-dot mood-${p.known?.mood ?? "calm"}`} aria-hidden="true" />
                {p.city.name}{p.branch ? " (branch)" : ""}
              </button>
            ))}
          </div>
          <p className="small muted map-key">
            <span className="mood-dot mood-calm" aria-hidden="true" /> calm <span className="mood-dot mood-uneasy" aria-hidden="true" /> uneasy <span className="mood-dot mood-panic" aria-hidden="true" /> in panic.
            A ring marks unrest, a double ring war, a flag a branch. Lines are the post roads, in days. The map is drawn by hand, for orientation only.
          </p>
        </div>
        {pin.home ? <HomeSheet /> : <CitySheet key={pin.city.id} pin={pin} state={state} onDecide={onDecide} />}
      </div>
    </div>
  );
}

// ---------- The map ----------

function EuropeMap({ pins, picked, onPick }: { pins: CityPin[]; picked: string; onPick: (id: string) => void }) {
  const ways = roads(gameData);
  return (
    <svg className="europe-map" viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label="Map of Europe with the house's cities">
      <rect className="sea" x="0" y="0" width={MAP_W} height={MAP_H} />
      {LAND_PATHS.map((d, i) => <path key={i} className="land" d={d} />)}
      {ways.map((w) => (
        <g key={w.key} className="road">
          <line x1={w.from.x} y1={w.from.y} x2={w.to.x} y2={w.to.y} />
          <text x={(w.from.x + w.to.x) / 2} y={(w.from.y + w.to.y) / 2} dy="5">{w.days}</text>
        </g>
      ))}
      {pins.map((p) => {
        const status = p.known?.status ?? "peace";
        const on = p.city.id === picked;
        const label = p.home ? "home" : p.notYet ? `branches from ${p.notYet}` : `${p.delayDays} days late`;
        return (
          <g
            key={p.city.id}
            className={`city ${on ? "on" : ""} ${p.home ? "home" : ""}`}
            transform={`translate(${p.x} ${p.y})`}
            role="button"
            tabIndex={0}
            aria-label={`${p.city.name}${p.known ? `: ${MOOD_WORDS[p.known.mood]}, ${STATUS_WORDS[status]}` : ", home"}`}
            aria-pressed={on}
            onClick={() => onPick(p.city.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(p.city.id); } }}
          >
            <rect className="hit" x="-84" y="-38" width="168" height="112" />
            {on && <circle className="pick-ring" r="31" />}
            {status !== "peace" && <circle className={`status-ring ${status}`} r="25" />}
            {status === "war" && <circle className="status-ring war" r="20" />}
            <circle className={`pin mood-${p.home ? "home" : p.known?.mood ?? "calm"}`} r="15" />
            {p.branch && <path className="flag" d="M10 -14 V -42 H 32 L 26 -35 L 32 -28 H 10" />}
            <text className="city-name" y="44">{p.city.name}</text>
            <text className="city-note" y="66">{label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function HomeSheet() {
  return (
    <section className="city-sheet">
      <h3>Frankfurt</h3>
      <p>The house's home. Its news is the Gazette's; choose a city abroad to see what is known of it.</p>
    </section>
  );
}

// ---------- A city's sheet ----------

function CitySheet({ pin, state, onDecide }: { pin: CityPin; state: GameState; onDecide?: Decide }) {
  const k = pin.known!;
  const c = pin.city;
  return (
    <section className="city-sheet" aria-label={c.name}>
      <header className="row-head">
        <h3>{c.name}</h3>
        <span className="chips">
          <span className={`chip mood-chip-${k.mood}`}>{MOOD_WORDS[k.mood]}</span>
          <span className={`chip ${k.status === "peace" ? "" : "chip-away"}`}>{STATUS_WORDS[k.status]}</span>
        </span>
      </header>
      <p className="small muted">
        As Frankfurt knows it: {pin.asOf}.{pin.onRoad > 0 ? ` ${pin.onRoad} dispatch${pin.onRoad === 1 ? " is" : "es are"} still on the road.` : ""}
      </p>
      <dl className="bd-lines">
        <dt>News takes</dt>
        <dd><SumCard title="News delay" summary={`How long news from ${c.name} takes to reach Frankfurt.`} term="news_delay" sections={delaySections(state, c.id, gameData)}>{pin.delayDays} days</SumCard></dd>
        <dt>Frankfurt quote</dt>
        <dd><SumCard title="The Frankfurt quote" summary={`Gulden for the currency of ${c.name}.`} term="exchange_quote" sections={quoteSections(state, c.id, gameData)}>{quoteText(state, c.id)}</SumCard></dd>
        <dt>Interest there</dt>
        <dd>{(c.rate * 100).toFixed(1)}% a year</dd>
      </dl>
      <Tabs.Root defaultValue="branch" className="doc-tabs sheet-tabs">
        <Tabs.List className="ribbons" aria-label={`Business in ${c.name}`}>
          <Tabs.Trigger value="branch" className="ribbon">{pin.branch ? "The branch" : "Open a branch"}</Tabs.Trigger>
          <Tabs.Trigger value="bills" className="ribbon">Bills{pin.billsHeld > 0 ? " held" : ""}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="branch" className="doc-page">
          {pin.branch ? <BranchBlock pin={pin} state={state} onDecide={onDecide} /> : <OpenBlock pin={pin} state={state} onDecide={onDecide} />}
        </Tabs.Content>
        <Tabs.Content value="bills" className="doc-page"><BillBlock pin={pin} state={state} onDecide={onDecide} /></Tabs.Content>
      </Tabs.Root>
    </section>
  );
}

function quoteText(state: GameState, city: string): string {
  const q = quoteSections(state, city, gameData)[0]!.total!.value;
  return q;
}

function OpenBlock({ pin, state, onDecide }: { pin: CityPin; state: GameState; onDecide?: Decide }) {
  const c = pin.city;
  const min = gameData.europe.branch.min_capital;
  const [text, setText] = useState(String(min));
  const capital = parseAmount(text);
  const people = openCandidates(state, c.id, Number.isFinite(capital) ? capital : min, gameData);
  const able = people.filter((p) => p.who === null);
  const unable = people.filter((p) => p.who !== null);
  const [head, setHead] = useState<number | null>(able[0]?.person.id ?? null);
  const { error, run } = useRun(onDecide);
  const risk = openRisk(state, c.id, head, gameData);
  const blocked = head === null ? "No member of the family can head a branch" : openBlocked(state, c.id, head, Number.isFinite(capital) ? capital : 0, gameData);
  return (
    <div className="city-block">
      <p className="small">
        A <Term id="branch">branch</Term> needs reputation {c.min_reputation} (yours {state.house.reputation}){pin.notYet ? `, and cannot open before ${pin.notYet}` : ""}. Upkeep {keepUnits(fl(c.upkeep))} a quarter
      </p>
      <p className="small strong">Who would run it</p>
      {able.length === 0 ? (
        <p className="small muted">No grown member of the family is free to go.</p>
      ) : (
        <div className="role-picks">
          {able.map((p) => (
            <button key={p.person.id} className="choice" data-state={head === p.person.id ? "on" : "off"} aria-pressed={head === p.person.id} disabled={!onDecide} onClick={() => setHead(p.person.id)}>
              <strong>{p.person.name}</strong>
              <span className="small">{p.person.traits.length > 0 ? p.person.traits.map((t) => gameData.traits.find((x) => x.id === t)?.name ?? t).join(", ") : "No traits yet"}</span>
            </button>
          ))}
        </div>
      )}
      {unable.length > 0 && <p className="small muted">Cannot go: {unable.map((p) => p.who).join("; ")}.</p>}
      {risk.chance > 0 && (
        <p className="small tone-bad">
          {c.name} is {STATUS_WORDS[pin.known!.status] === "at peace" ? MOOD_WORDS[pin.known!.mood] : STATUS_WORDS[pin.known!.status]}: a branch here would have a {(risk.chance * 100).toFixed(1)}% chance a quarter of being forced shut, losing {Math.round(risk.loss * 100)}%.
        </p>
      )}
      <div className="field field-inline">
        <label>
          <span>Capital to send, gulden</span>
          <input inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="row">
          {[min, min * 2, min * 4].map((x) => <button key={x} type="button" className="secondary" onClick={() => setText(String(x))}>{keepUnits(fl(x))}</button>)}
        </div>
      </div>
      <p className="small">
        Costs{" "}
        <SumCard title="Opening a branch" summary="What leaves the strongroom now." term="branch" sections={[openCostSection(c.id, capital, gameData)]}>
          {keepUnits(fl(openCostSection(c.id, capital, gameData).total!.amount!))}
        </SumCard>{" "}
        from cash now, setup and capital together.
      </p>
      <div className="act-row">
        <ActButton label="Open the branch" primary blocked={onDecide ? blocked : "The run is over"} onClick={() => head !== null && run({ kind: "open_branch", city: c.id, head, capital })} />
        <span className="small muted">{capacityNote(state, "open_branch", gameData)}</span>
      </div>
      <Refused error={error} />
    </div>
  );
}

function BranchBlock({ pin, state, onDecide }: { pin: CityPin; state: GameState; onDecide?: Decide }) {
  const c = pin.city;
  const v = branchView(state, c.id, gameData)!;
  const [text, setText] = useState("2000");
  const amount = parseAmount(text);
  const { error, run } = useRun(onDecide);
  const [appointing, setAppointing] = useState(false);
  const fund = (sign: 1 | -1) => fundBlocked(state, c.id, Number.isFinite(amount) ? sign * amount : 0, gameData);
  return (
    <div className="city-block">
      <p className="small">
        {v.head ? <>Run by <strong>{v.head.name}</strong>.</> : <strong className="tone-bad">No one runs it: it earns less and loses more.</strong>}
        {" "}Opened {quarterOf(pin.branch!.opened_turn)}.
      </p>
      <dl className="bd-lines">
        <dt>Capital</dt><dd>{keepUnits(fl(v.capitalFl))}</dd>
        <dt>Deposits taken there</dt><dd>{keepUnits(fl(v.depositsFl))}</dd>
        <dt>In the books at home</dt><dd>{keepUnits(fl(v.branch.book))}</dd>
        <dt>Last quarter's profit</dt><dd className={v.lastProfitFl < 0 ? "tone-bad" : ""}>{keepUnits(fl(v.lastProfitFl))}</dd>
        <dt>Next quarter, about</dt>
        <dd><SumCard title={`The ${c.name} branch`} summary="Next quarter's business, as far as Frankfurt can judge from the news." sections={[v.estimate]}>{keepUnits(v.estimate.total!.value)}</SumCard></dd>
        <dt>Chance trouble closes it</dt>
        <dd className={v.closeChance > 0 ? "tone-bad" : ""}>{v.closeChance > 0 ? `${(v.closeChance * 100).toFixed(1)}%, losing ${Math.round(v.closeLoss * 100)}%` : "none while calm and at peace"}</dd>
      </dl>
      <div className="field field-inline">
        <label>
          <span>Capital to send or recall, gulden</span>
          <input inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      </div>
      <div className="act-row">
        <ActButton label="Send" blocked={onDecide ? fund(1) : "The run is over"} onClick={() => run({ kind: "fund_branch", city: c.id, amount })} />
        <ActButton label="Recall" blocked={onDecide ? fund(-1) : "The run is over"} onClick={() => run({ kind: "fund_branch", city: c.id, amount: -amount })} />
        <ActButton label={appointing ? "Keep the head" : "Appoint a head"} blocked={onDecide ? null : "The run is over"} onClick={() => setAppointing(!appointing)} />
        <ActButton label={`Close it: ${fl(v.closeReturns)} comes home`} blocked={onDecide ? v.closeBlocked : "The run is over"} onClick={() => run({ kind: "close_branch", city: c.id })} />
      </div>
      <p className="small muted">{capacityNote(state, "fund_branch", gameData)}. Money sent or recalled loses {(gameData.europe.branch.transfer_spread * 100).toFixed(1)}% to the exchange.</p>
      {appointing && (
        <div className="role-picks">
          {v.candidates.length === 0 && <p className="small muted">No other grown member of the family is free.</p>}
          {v.candidates.map((p) => (
            <button key={p.person.id} className="choice" disabled={p.blocked !== null} onClick={() => { if (run({ kind: "appoint_branch_head", city: c.id, head: p.person.id })) setAppointing(false); }}>
              <strong>{p.person.name}</strong>
              {p.blocked && <span className="act-why">{keepUnits(p.blocked)}</span>}
            </button>
          ))}
        </div>
      )}
      <Refused error={error} />
    </div>
  );
}

function BillBlock({ pin, state, onDecide }: { pin: CityPin; state: GameState; onDecide?: Decide }) {
  const c = pin.city;
  const [text, setText] = useState("1000");
  const amount = parseAmount(text);
  const q = billQuote(state, c.id, amount, gameData);
  const { error, run } = useRun(onDecide);
  const held = state.europe.bills.filter((b) => b.city === c.id);
  return (
    <div className="city-block">
      <div className="field field-inline">
        <label>
          <span>Gulden to pay</span>
          <input inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="row">
          {[500, 1000, q.room].filter((x, i, a) => x > 0 && a.indexOf(x) === i).map((x) => <button key={x} type="button" className="secondary" onClick={() => setText(String(x))}>{x === q.room ? `All room (${fl(x)})` : keepUnits(fl(x))}</button>)}
        </div>
      </div>
      <p className="small">
        Buys a 3-month <Term id="bill_on_city">bill</Term> for {q.face.toLocaleString("en")} {q.currency}, at a{" "}
        <SumCard title="Bills on a city" summary="The discount, how much more the house may hold, and the risk." term="bill_on_city" sections={q.sections}>
          {(q.discount * 100).toFixed(2)}% discount
        </SumCard>
        . Paid home at End Turn at the quote then. Room left: {keepUnits(fl(q.room))}
      </p>
      <div className="act-row">
        <ActButton label="Buy the bill" primary blocked={onDecide ? q.blocked : "The run is over"} onClick={() => run({ kind: "buy_bill", city: c.id, amount })} />
        <span className="small muted">{billTime(state, gameData)}</span>
      </div>
      {held.length > 0 && <p className="small">Held: {held.map((b) => keepUnits(`#${b.id}, ${fl(b.cost)}`)).join("; ")}</p>}
      <Refused error={error} />
    </div>
  );
}
