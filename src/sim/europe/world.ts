// The cities of Europe, their currencies and the courier roads between them: moods, troubles,
// exchange rates, and the dispatches that carry news of them to Frankfurt.
import { workingCount } from "../capacity";
import { hasFacility } from "../systems/counting";
import type { Rng } from "../rng";
import type { GameData } from "../tuning";
import type { GameState, Sentiment } from "../types";
import type { CityData, CityState, CityStatus, CityView, CurrencyData, EuropeData, EuropeState, HistoryData, Mail, QuarterDate } from "./types";

// Lookups -------------------------------------------------------------------------------------

export function cityData(data: GameData, id: string): CityData | undefined {
  return data.europe.cities.find((c) => c.id === id);
}

export function cityState(state: GameState, id: string): CityState | undefined {
  return state.europe.cities.find((c) => c.id === id);
}

export function currencyData(data: GameData, id: string): CurrencyData | undefined {
  return data.europe.currencies.find((c) => c.id === id);
}

/** Foreign cities, in data order. */
export const abroad = (data: GameData) => data.europe.cities.filter((c) => c.id !== data.europe.home);

const index = (d: QuarterDate) => d.year * 4 + d.quarter;
export const onOrAfter = (d: QuarterDate, from: QuarterDate) => index(d) >= index(from);

/** True when the currency holds a fixed parity on `date`. */
export function isFixed(cur: CurrencyData, date: QuarterDate): boolean {
  return cur.fixed_from !== undefined && onOrAfter(date, cur.fixed_from);
}

// Rates ---------------------------------------------------------------------------------------

function rateOf(state: GameState, data: GameData, cityId: string, shock: (c: CityState) => number): number {
  const city = cityData(data, cityId);
  if (!city) throw new Error(`Unknown city "${cityId}"`);
  const cur = currencyData(data, city.currency)!;
  const cs = state.europe.currencies[cur.id];
  const cst = cityState(state, cityId);
  const dev = cs?.dev ?? 0;
  const fixed = isFixed(cur, state.world);
  return cur.par * (1 + dev) * (fixed || !cst ? 1 : shock(cst));
}

/** Gulden per unit of the city's currency on the Frankfurt exchange: par, the day's deviation, and any shock as far as news of it has reached Frankfurt. */
export function quote(state: GameState, data: GameData, cityId: string): number {
  return rateOf(state, data, cityId, (c) => c.known.shock);
}

/** What the city's currency is really worth (any shock as it stands abroad). */
export function trueRate(state: GameState, data: GameData, cityId: string): number {
  const city = cityData(data, cityId)!;
  return rateOf(state, data, cityId, () => state.europe.currencies[city.currency]?.shock ?? 1);
}

/** The next deviation from par: some of the last remains, plus noise, held within the band. One roll. */
export function nextDev(dev: number, cur: CurrencyData, fixed: boolean, u: number, e: EuropeData): number {
  const band = fixed ? cur.fixed_from!.band : cur.band;
  const next = e.rates.revert * dev + cur.noise * (2 * u - 1);
  return Math.round(Math.max(-band, Math.min(band, next)) * 1e6) / 1e6;
}

// Courier roads --------------------------------------------------------------------------------

/** Days by the ordinary post along the shortest road from `from` to `to` (Infinity if no road). */
export function roadDays(data: GameData, from: string, to: string): number {
  const dist = new Map<string, number>([[from, 0]]);
  const done = new Set<string>();
  for (;;) {
    let here: string | null = null;
    for (const [id, d] of dist) if (!done.has(id) && (here === null || d < dist.get(here)!)) here = id;
    if (here === null) return Infinity;
    if (here === to) return dist.get(here)!;
    done.add(here);
    for (const l of data.europe.links) {
      const next = l.from === here ? l.to : l.to === here ? l.from : null;
      if (next === null || done.has(next)) continue;
      const d = dist.get(here)! + l.days;
      if (d < (dist.get(next) ?? Infinity)) dist.set(next, d);
    }
  }
}

/**
 * Days for news from city `from` to reach Frankfurt: the shortest road by the ordinary post,
 * halved with a courier stable, cut further from a city where the house has a branch, and by each
 * correspondent (up to a cap). C4 (the telegraph) shortens news by wrapping this.
 */
export function newsDelay(state: GameState, from: string, data: GameData): number {
  const e = data.europe;
  if (from === e.home) return 0;
  let days = roadDays(data, from, e.home);
  if (hasFacility(state, "courier_stable")) days *= e.delay.courier_stable;
  if (state.europe.branches.some((b) => b.city === from)) days *= e.delay.branch;
  days *= 1 - Math.min(e.delay.max_correspondent_cut, workingCount(state, "correspondent") * e.delay.per_correspondent);
  return Math.round(days * 10) / 10;
}

/** The first turn a dispatch written at `turn`'s End Turn, on day `day` of the quarter, is known in Frankfurt. */
export function arrivalTurn(turn: number, day: number, delay: number, e: EuropeData): number {
  return turn + 1 + Math.floor((day + delay) / e.quarter_days);
}

// The cities' quarter ------------------------------------------------------------------------

const WORSE: Record<Sentiment, Sentiment | null> = { calm: "uneasy", uneasy: "panic", panic: null };
const worse = (a: Sentiment, b: Sentiment) => (a === "panic" || b === "panic" ? "panic" : a === "uneasy" || b === "uneasy" ? "uneasy" : "calm");

/** The next mood from one roll: worsening chances are scaled by the city's volatility. */
export function nextMood(mood: Sentiment, volatility: number, u: number, e: EuropeData): Sentiment {
  let acc = 0;
  for (const [to, p] of Object.entries(e.moods.transitions[mood]) as [Sentiment, number][]) {
    acc += to === WORSE[mood] ? p * volatility : p;
    if (u < acc) return to;
  }
  return mood;
}

/** The next status from one roll: peace may break into unrest; unrest and war last their quarters, then may end. */
export function nextStatus(c: Pick<CityState, "status" | "status_left">, unrestChance: number, u: number, e: EuropeData): Pick<CityState, "status" | "status_left"> {
  if (c.status === "peace") return u < unrestChance ? { status: "unrest", status_left: 1 } : { status: "peace", status_left: 0 };
  const left = Math.max(0, c.status_left - 1);
  if (left > 0) return { status: c.status, status_left: left };
  const ends = c.status === "war" ? e.moods.war_ends : e.moods.unrest_ends;
  return u < ends ? { status: "peace", status_left: 0 } : { status: c.status, status_left: 0 };
}

export const viewOf = (c: CityState, shock: number, turn: number): CityView => ({ mood: c.mood, status: c.status, shock, as_of: turn });

/** The europe system at the start: every city calm and at peace, rates at par, known as they are. */
export function createWorld(data: GameData, rngState: number): EuropeState {
  const e = data.europe;
  return {
    rng_state: rngState,
    cities: e.cities.map((c) => ({ id: c.id, mood: "calm", status: "peace", status_left: 0, known: { mood: "calm", status: "peace", shock: 1, as_of: 0 } })),
    currencies: Object.fromEntries(e.currencies.filter((c) => c.id !== "gulden").map((c) => [c.id, { dev: 0, shock: 1 }])),
    branches: [],
    bills: [],
    next_bill_id: 1,
    mail: [],
    fired: [],
  };
}

/** Losses a happening deals to branches on the spot (a fire), for the branches module. */
export type DisasterHook = (cityId: string, loss: number, title: string) => void;

const fill = (s: string, city: string) => s.replaceAll("{city}", city);

/**
 * Rolls every foreign city for the next quarter and sends its dispatch: first each currency's
 * deviation (one roll each, in data order), then per city in data order four rolls: mood, status,
 * the size of a panic shock, and the day of the quarter its dispatch is written. Dated happenings
 * for the next quarter apply after the city's own rolls. Shocks fade first, then new ones land.
 * Mutates `state`.
 */
export function rollCities(state: GameState, rng: Rng, data: GameData, next: QuarterDate, disaster: DisasterHook): void {
  const e = data.europe;
  const eu = state.europe;
  const turn = state.world.turn;
  for (const cur of e.currencies) {
    const cs = eu.currencies[cur.id];
    if (!cs) continue;
    cs.dev = nextDev(cs.dev, cur, isFixed(cur, next), rng.next(), e);
    cs.shock = Math.round((1 - (1 - cs.shock) * e.rates.fade) * 1e6) / 1e6;
  }
  for (const city of abroad(data)) {
    const c = cityState(state, city.id)!;
    const cs = eu.currencies[city.currency]!;
    const was = { mood: c.mood, status: c.status };
    const [uMood, uStatus, uShock, uDay] = [rng.next(), rng.next(), rng.next(), rng.next()];
    c.mood = nextMood(c.mood, city.volatility, uMood, e);
    Object.assign(c, nextStatus(c, city.unrest_chance, uStatus, e));
    const news: { title: string; text: string }[] = [];

    const happenings: HistoryData[] = e.history.filter((h) => h.city === city.id && h.year === next.year && h.quarter === next.quarter && !eu.fired.includes(h.id));
    let extraShock = 0;
    for (const h of happenings) {
      eu.fired.push(h.id);
      news.push({ title: h.title, text: h.text });
      extraShock += h.shock ?? 0;
      switch (h.kind) {
        case "panic":
        case "uneasy":
        case "calm":
          c.mood = h.kind;
          break;
        case "unrest":
        case "war":
          c.status = h.kind;
          c.status_left = h.quarters ?? 1;
          break;
        case "peace":
          c.status = "peace";
          c.status_left = 0;
          break;
        case "disaster":
          c.mood = worse(c.mood, "uneasy");
          if (h.loss) disaster(city.id, h.loss, h.title);
          break;
        case "suspension":
          extraShock += e.rates.suspension;
          break;
      }
    }
    // Trouble unsettles the market: unrest at least uneasy, war at least uneasy.
    if (c.status !== "peace") c.mood = worse(c.mood, "uneasy");

    let factor = 1;
    if (c.mood === "panic" && was.mood !== "panic") factor *= 1 - (e.rates.panic.low + uShock * (e.rates.panic.high - e.rates.panic.low));
    if (c.status !== was.status && c.status !== "peace") factor *= 1 - (c.status === "war" ? e.rates.war : e.rates.unrest);
    factor *= 1 - extraShock;
    cs.shock = Math.round(cs.shock * factor * 1e6) / 1e6;

    if (!happenings.length) {
      if (c.status !== was.status) news.push(textFor(e, c.status, city.name));
      else if (c.mood !== was.mood) news.push(textFor(e, c.mood, city.name));
    }
    const day = Math.floor(uDay * e.quarter_days);
    const mail: Mail = { city: city.id, sent: turn, arrives: arrivalTurn(turn, day, newsDelay(state, city.id, data), e), view: viewOf(c, cs.shock, turn), news };
    eu.mail.push(mail);
  }
}

function textFor(e: EuropeData, kind: Sentiment | CityStatus, city: string): { title: string; text: string } {
  const t = e.texts[kind];
  return { title: fill(t.title, city), text: fill(t.text, city) };
}

/**
 * Delivers the dispatches known by the start of the next quarter: each updates the house's view of
 * its city (unless a later one already has) and its news goes in the quarter's news. Mutates `state`.
 */
export function deliverMail(state: GameState): void {
  const eu = state.europe;
  const turn = state.world.turn;
  const due = eu.mail.filter((m) => m.arrives <= turn + 1).sort((a, b) => a.sent - b.sent);
  eu.mail = eu.mail.filter((m) => m.arrives > turn + 1);
  for (const m of due) {
    const c = cityState(state, m.city);
    if (!c) continue;
    if (m.sent >= c.known.as_of) c.known = { ...m.view };
    for (const n of m.news) {
      const late = turn - m.sent;
      state.news.push({ turn, kind: "europe", title: n.title, text: late > 0 ? `${n.text} (The news is ${late} quarter${late === 1 ? "" : "s"} old.)` : n.text });
    }
  }
}
