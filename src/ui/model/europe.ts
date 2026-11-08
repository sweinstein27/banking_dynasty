// What the map of Europe shows: each city as known in Frankfurt (never its true mood), how late its
// news is, the Frankfurt quote for its currency, the house's branch there and bills on it, with the
// sums behind every number and the sim's verdict on every decision. Built from C1's own functions
// (src/sim/europe/*); tests/ui-wave3-screens.test.ts checks them against the sim.
import { workingCount } from "../../sim/capacity";
import { billDiscount, billFace, billRoom, branchCandidates, branchHead, branchIn, branchQuarter, checkAppointHead, checkBuyBill, checkCloseBranch, checkFundBranch, checkOpenBranch, closeChance, closeLoss } from "../../sim/europe/branches";
import type { Branch, CityData, CityStatus, CityView } from "../../sim/europe/types";
import { cityState, currencyData, isFixed, newsDelay, onOrAfter, quote, roadDays } from "../../sim/europe/world";
import { fl } from "../../sim/format";
import { hasFacility } from "../../sim/systems/counting";
import { telegraphDelay } from "../../sim/systems/progress";
import type { GameData } from "../../sim/tuning";
import type { GameState, Person, Sentiment } from "../../sim/types";
import type { Line, Section } from "./breakdowns";
import { capacityNote } from "./capacity";

const pctOf = (r: number, dp = 1) => `${(r * 100).toFixed(dp)}%`;
const turnDate = (turn: number, data: GameData) => {
  const i = data.tuning.start.year * 4 + (data.tuning.start.quarter - 1) + (turn - 1);
  return `${Math.floor(i / 4)} Q${(i % 4) + 1}`;
};

// ---------------------------------------------------------------- the map's geometry

/** The map's frame: longitude and latitude at its edges, and the scale. Equirectangular, squeezed east-west at 48 degrees north. */
export const MAP = { lonMin: -6, lonMax: 20, latMin: 39.5, latMax: 57.5, k: 50, squeeze: Math.cos((48 * Math.PI) / 180) };
export const MAP_W = Math.round((MAP.lonMax - MAP.lonMin) * MAP.squeeze * MAP.k);
export const MAP_H = Math.round((MAP.latMax - MAP.latMin) * MAP.k);

export function project(lon: number, lat: number): { x: number; y: number } {
  return { x: Math.round((lon - MAP.lonMin) * MAP.squeeze * MAP.k * 10) / 10, y: Math.round((MAP.latMax - lat) * MAP.k * 10) / 10 };
}

/** A hand-drawn, much simplified coastline (longitude, latitude): the mainland and Great Britain. For orientation only. */
const MAINLAND: [number, number][] = [
  [-6, 43.4], [-1.8, 43.4], [-1.3, 44.5], [-1.2, 46.0], [-2.2, 47.2], [-4.5, 47.8], [-4.8, 48.4], [-3.0, 48.8], [-1.6, 48.7], [-1.4, 49.7],
  [0.2, 49.5], [1.6, 50.2], [1.6, 50.9], [3.2, 51.3], [4.0, 51.9], [4.6, 52.5], [4.8, 53.0], [5.5, 53.4], [7.0, 53.6], [8.5, 53.6],
  [8.9, 54.0], [8.6, 54.9], [8.2, 55.5], [8.1, 56.6], [8.6, 57.1], [9.9, 57.5], [10.6, 57.7], [10.5, 57.2], [10.3, 56.5], [10.9, 56.4],
  [10.2, 55.6], [9.8, 55.0], [10.0, 54.6], [10.9, 54.3], [11.0, 54.0], [12.1, 54.2], [13.4, 54.6], [14.2, 53.9], [16.0, 54.3], [18.0, 54.8],
  [18.6, 54.4], [20, 54.5], [20, 40.5], [19.4, 40.6], [19.4, 41.8], [18.5, 42.4], [17.0, 43.2], [15.9, 43.6], [15.2, 44.3], [14.5, 45.2],
  [13.7, 45.6], [12.3, 45.3], [12.4, 44.2], [13.6, 43.5], [14.2, 42.4], [16.0, 41.4], [17.9, 40.6], [18.5, 40.1], [18.3, 39.8], [17.0, 40.4],
  [16.6, 39.4], [17.1, 39.0], [16.6, 38.4], [15.6, 38.0], [15.8, 38.6], [16.2, 38.9], [15.6, 40.0], [14.9, 40.3], [14.0, 40.8], [12.9, 41.4],
  [11.8, 42.1], [10.5, 42.9], [10.2, 43.9], [8.8, 44.4], [7.5, 43.8], [6.2, 43.1], [5.0, 43.4], [4.0, 43.5], [3.1, 43.1], [3.2, 42.3],
  [3.3, 41.8], [2.2, 41.4], [0.9, 41.0], [0.0, 39.9], [-0.3, 39.4], [0.2, 38.7], [0.2, 38.5], [-6, 38.5],
];
const BRITAIN: [number, number][] = [
  [-5.7, 50.0], [-3.5, 50.3], [-1.0, 50.7], [1.4, 51.2], [1.7, 52.6], [0.3, 53.1], [-0.2, 54.1], [-1.2, 54.6], [-1.6, 55.6], [-2.0, 56.0],
  [-2.6, 56.3], [-1.8, 57.6], [-4.0, 57.7], [-5.6, 57.6], [-5.6, 56.5], [-5.5, 55.5], [-4.9, 55.0], [-3.2, 54.9], [-3.4, 54.4], [-3.0, 53.8],
  [-3.0, 53.3], [-4.5, 53.3], [-4.2, 52.8], [-4.0, 52.2], [-5.2, 51.8], [-4.2, 51.5], [-3.0, 51.5], [-4.2, 51.2],
];
const pathOf = (pts: [number, number][]) => pts.map(([lon, lat], i) => `${i ? "L" : "M"}${project(lon, lat).x} ${project(lon, lat).y}`).join(" ") + " Z";
export const LAND_PATHS = [pathOf(MAINLAND), pathOf(BRITAIN)];

// ---------------------------------------------------------------- cities

export const MOOD_WORDS: Record<Sentiment, string> = { calm: "calm", uneasy: "uneasy", panic: "in panic" };
export const STATUS_WORDS: Record<CityStatus, string> = { peace: "at peace", unrest: "in unrest", war: "at war" };

export interface CityPin {
  city: CityData;
  x: number;
  y: number;
  home: boolean;
  /** As known in Frankfurt. */
  known: CityView | null;
  /** "as of 1816 Q2", or "news of this quarter". */
  asOf: string;
  /** Quarters old, as known. */
  age: number;
  delayDays: number;
  branch: Branch | undefined;
  billsHeld: number;
  /** Dispatches still on the road from it. */
  onRoad: number;
  /** The date a branch may first open there, if not yet. */
  notYet: string | null;
}

export function cityPins(state: GameState, data: GameData): CityPin[] {
  const turn = state.world.turn;
  return data.europe.cities.map((city) => {
    const home = city.id === data.europe.home;
    const cs = cityState(state, city.id);
    const known = home || !cs ? null : cs.known;
    const age = known ? Math.max(0, turn - 1 - known.as_of) : 0;
    const { x, y } = project(city.lon, city.lat);
    return {
      city, x, y, home, known,
      // A dispatch written at turn t's End Turn tells of the city in quarter t + 1.
      asOf: !known ? "" : age === 0 ? "news up to date" : `news as of ${turnDate(known.as_of + 1, data)}`,
      age,
      delayDays: home ? 0 : newsDelay(state, city.id, data),
      branch: branchIn(state, city.id),
      billsHeld: state.europe.bills.filter((b) => b.city === city.id).reduce((s, b) => s + b.cost, 0),
      onRoad: state.europe.mail.filter((m) => m.city === city.id).length,
      notYet: home || onOrAfter(state.world, city.opens) ? null : `${city.opens.year}${city.opens.quarter > 1 ? ` Q${city.opens.quarter}` : ""}`,
    };
  });
}

/** Roads drawn on the map, with their days by the ordinary post. */
export function roads(data: GameData): { from: { x: number; y: number }; to: { x: number; y: number }; days: number; key: string }[] {
  return data.europe.links.flatMap((l) => {
    const a = data.europe.cities.find((c) => c.id === l.from);
    const b = data.europe.cities.find((c) => c.id === l.to);
    if (!a || !b) return [];
    return [{ from: project(a.lon, a.lat), to: project(b.lon, b.lat), days: l.days, key: `${l.from}-${l.to}` }];
  });
}

/** The sums behind how many days news from a city takes, ending at the sim's own newsDelay. */
export function delaySections(state: GameState, cityId: string, data: GameData): Section[] {
  const e = data.europe;
  const road = roadDays(data, cityId, e.home);
  const lines: Line[] = [{ label: "By the ordinary post, the shortest road", value: `${road} days` }];
  if (hasFacility(state, "courier_stable")) lines.push({ label: "The house's courier stable", value: `x ${e.delay.courier_stable}` });
  if (state.europe.branches.some((b) => b.city === cityId)) lines.push({ label: "The house's branch there writes", value: `x ${e.delay.branch}` });
  const corr = workingCount(state, "correspondent");
  const cut = Math.min(e.delay.max_correspondent_cut, corr * e.delay.per_correspondent);
  if (cut > 0) lines.push({ label: `${corr} correspondent${corr === 1 ? "" : "s"} (at most ${pctOf(e.delay.max_correspondent_cut, 0)} off)`, value: `- ${pctOf(cut, 0)}` });
  const delay = newsDelay(state, cityId, data);
  const wired = telegraphDelay(state, data, cityId, 1) === 0;
  if (wired) lines.push({ label: "The electric telegraph", value: "same day" });
  return [
    { heading: "Days for news to reach Frankfurt", lines, total: { label: "News is late by", value: `${delay} days` } },
    {
      heading: "When it arrives",
      lines: [
        { label: "A city's dispatch is written on a random day of the quarter", value: `of ${e.quarter_days}` },
        { label: "If the day plus the delay passes the quarter's end", value: "known a quarter later" },
      ],
    },
  ];
}

/** The sums behind the Frankfurt quote for a city's currency: par, the day's deviation, and any shock as known. */
export function quoteSections(state: GameState, cityId: string, data: GameData): Section[] {
  const city = data.europe.cities.find((c) => c.id === cityId)!;
  const cur = currencyData(data, city.currency)!;
  const cs = state.europe.currencies[cur.id];
  const known = cityState(state, cityId)?.known;
  const fixed = isFixed(cur, state.world);
  const lines: Line[] = [
    { label: `Par: the ${cur.name}'s metal`, value: `${cur.par} fl.` },
    { label: "The day's course of exchange", value: `${(cs?.dev ?? 0) >= 0 ? "+" : ""}${pctOf(cs?.dev ?? 0, 2)}` },
  ];
  if (fixed) lines.push({ label: "A fixed parity holds the rate", value: `within ${pctOf(cur.fixed_from!.band, 1)}` });
  else if (known && known.shock !== 1) lines.push({ label: "A shock, as far as Frankfurt has heard", value: `x ${known.shock.toFixed(3)}` });
  return [{ heading: `Gulden for one ${cur.name}`, lines, total: { label: "Frankfurt quote", value: `${quote(state, data, cityId).toFixed(3)} fl.` } }];
}

// ---------------------------------------------------------------- branches

export interface BranchView {
  branch: Branch;
  head: Person | undefined;
  /** In gulden at the Frankfurt quote. */
  capitalFl: number;
  depositsFl: number;
  lastProfitFl: number;
  /** Next quarter as Frankfurt sees it (the city's known mood and status), in gulden. */
  estimate: Section;
  /** The chance trouble closes it next quarter, as known, and what it would lose. */
  closeChance: number;
  closeLoss: number;
  candidates: { person: Person; blocked: string | null }[];
  closeBlocked: string | null;
  closeReturns: number;
}

export function branchView(state: GameState, cityId: string, data: GameData): BranchView | null {
  const b = branchIn(state, cityId);
  if (!b) return null;
  const city = data.europe.cities.find((c) => c.id === cityId)!;
  const known = cityState(state, cityId)!.known;
  const q = quote(state, data, cityId);
  const head = branchHead(state, b);
  const est = branchQuarter(b, city, known, head, state.house.reputation, q, data);
  const g = (n: number) => Math.round(n * q);
  const lines: Line[] = [
    { label: "Interest on loans and bills, less interest to depositors", value: fl(g(est.income)), amount: g(est.income) },
    { label: "Bad debts expected", value: fl(-g(est.defaults)), amount: -g(est.defaults) },
    { label: "Upkeep", value: fl(-g(est.upkeep)), amount: -g(est.upkeep) },
  ];
  const profit = lines.reduce((s, l) => s + l.amount!, 0);
  const others = state.people.filter((p) => p.id !== b.head && p.death_year === null && p.role === "line" && !p.is_head);
  return {
    branch: b,
    head,
    capitalFl: g(b.capital),
    depositsFl: g(b.deposits),
    lastProfitFl: g(b.last_profit),
    estimate: {
      heading: `Next quarter, if ${city.name} stays ${MOOD_WORDS[known.mood]} and ${STATUS_WORDS[known.status]}`,
      lines: [...lines, ...(head ? [] : [{ label: "No head: bills earn less and defaults rise", value: "" }])],
      total: { label: "Profit, about", value: fl(profit), amount: profit },
    },
    closeChance: closeChance(known, head, data),
    closeLoss: closeLoss(known, data),
    candidates: others.map((person) => ({ person, blocked: checkAppointHead(state, { kind: "appoint_branch_head", city: cityId, head: person.id }, data) })),
    closeBlocked: checkCloseBranch(state, { kind: "close_branch", city: cityId }, data),
    closeReturns: Math.round(b.book * (1 - data.europe.branch.transfer_spread)),
  };
}

/** Who could open a branch in a city, each with the sim's verdict at the smallest capital. */
export function openCandidates(state: GameState, cityId: string, capital: number, data: GameData): { person: Person; blocked: string | null }[] {
  const people = state.people.filter((p) => p.death_year === null && p.role === "line" && !p.is_head);
  const ok = new Set(branchCandidates(state, data).map((p) => p.id));
  return people.map((person) => ({
    person,
    blocked: checkOpenBranch(state, { kind: "open_branch", city: cityId, head: person.id, capital }, data) ?? (ok.has(person.id) ? null : "Cannot head a branch"),
  }));
}

/** What opening a branch costs, as a section: setup and the capital sent. */
export function openCostSection(cityId: string, capital: number, data: GameData): Section {
  const city = data.europe.cities.find((c) => c.id === cityId)!;
  const amount = Number.isFinite(capital) ? capital : 0;
  return {
    heading: `A branch in ${city.name}`,
    lines: [
      { label: "Premises, licences and clerks", value: fl(city.setup), amount: city.setup },
      { label: "Capital sent", value: fl(amount), amount },
    ],
    total: { label: "From cash now", value: fl(city.setup + amount), amount: city.setup + amount },
  };
}

export const openBlocked = (state: GameState, cityId: string, head: number, capital: number, data: GameData) =>
  checkOpenBranch(state, { kind: "open_branch", city: cityId, head, capital }, data);
export const fundBlocked = (state: GameState, cityId: string, amount: number, data: GameData) =>
  checkFundBranch(state, { kind: "fund_branch", city: cityId, amount }, data);

// ---------------------------------------------------------------- bills

export interface BillQuote {
  face: number;
  currency: string;
  discount: number;
  room: number;
  blocked: string | null;
  sections: Section[];
}

/** A 3-month bill on a city bought for `amount` gulden: its face, the discount, the room left, and the sim's verdict. */
export function billQuote(state: GameState, cityId: string, amount: number, data: GameData): BillQuote {
  const city = data.europe.cities.find((c) => c.id === cityId)!;
  const cur = currencyData(data, city.currency)!;
  const discount = billDiscount(city, data);
  const room = billRoom(state, data, cityId);
  const ok = Number.isFinite(amount) && amount > 0;
  const face = ok ? billFace(state, data, cityId, amount) : 0;
  const held = state.europe.bills.filter((b) => b.city === cityId).reduce((s, b) => s + b.cost, 0);
  return {
    face,
    currency: cur.name,
    discount,
    room,
    blocked: checkBuyBill(state, { kind: "buy_bill", city: cityId, amount: ok ? amount : 0 }, data),
    sections: [
      {
        heading: "The discount on a 3-month bill",
        lines: [
          { label: `A quarter of ${city.name}'s rate (${pctOf(city.rate)} a year)`, value: pctOf(city.rate / 4, 2) },
          { label: "The exchange's spread", value: pctOf(data.europe.bills.spread, 2) },
        ],
        total: { label: "Discount", value: pctOf(discount, 2) },
      },
      {
        heading: "How much more the house may hold",
        lines: [
          { label: "The limit on any one city", value: fl(data.europe.bills.limit), amount: data.europe.bills.limit },
          { label: "Plus the branch's book there", value: fl(branchIn(state, cityId)?.book ?? 0), amount: branchIn(state, cityId)?.book ?? 0 },
          { label: "Less bills already held", value: fl(-held), amount: -held },
        ],
        total: { label: "Room", value: fl(room), amount: room },
      },
      {
        heading: "The risk, as Frankfurt knows the city",
        lines: (["calm", "uneasy", "panic"] as Sentiment[]).map((m) => ({ label: `Payer fails if the city is ${MOOD_WORDS[m]}`, value: pctOf(data.europe.bills.defaults[m]) })).concat([
          { label: "Recovered from a failed bill", value: pctOf(data.europe.bills.recovery, 0) },
        ]),
      },
    ],
  };
}

export const billTime = (state: GameState, data: GameData) => capacityNote(state, "buy_bill", data);

/** Bills held, by city, adding up with branches to the sim's europeBook. */
export function europeSection(state: GameState, data: GameData): Section {
  const name = (id: string) => data.europe.cities.find((c) => c.id === id)?.name ?? id;
  const lines: Line[] = [
    ...state.europe.branches.map((b) => ({ label: `Branch in ${name(b.city)}`, value: fl(b.book), amount: b.book })),
    ...state.europe.bills.map((b) => ({ label: `Bill #${b.id} on ${name(b.city)}`, value: fl(b.cost), amount: b.cost })),
  ];
  const total = lines.reduce((s, l) => s + l.amount!, 0);
  return { heading: "Abroad, in the books", lines, total: { label: "In the books", value: fl(total), amount: total } };
}
