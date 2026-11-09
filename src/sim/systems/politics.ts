// C2, politics: seats in the Frankfurt Senate and the Federal Diet, court banker to a prince, and
// influence, which the seats and courts earn and the house spends. Hard political choices come as
// letters (data/events.json, ids starting "politics-").
//
// Offices. A seat falls vacant now and then; a man of the line, 30 or older, may stand for it if the
// house has the standing and the property (the 1816 constitution barred those under 30 and unpaid
// bankrupts, and asked 5,000 fl. of a citizen). The result is a roll at End Turn. A seat is held for
// life by one person: it lapses when they die or leave the line. The Diet post (Frankfurt's envoy)
// is open only to a sitting senator, and ends when the Diet handed its powers to the Regent in 1848.
//
// Courts. A house of standing may become banker to a prince's court for a gift. The court then asks
// for loans now and then: lending raises its favour, declining lowers it, and a court whose favour
// falls below the floor dismisses the house. Court loans pay interest, may be put off at term, and
// rarely are never repaid. They are counted in net worth (ledger account `court_loans`).
//
// Letters. Politics posts its own letters (stored in data/events.json as follow-up events, so they
// never fire by date or weight) when its own conditions hold, and after the usual letter code
// settles them, applies the influence and court effects listed in data/politics.json.
//
// Effects on other systems are exported as functions (contractFavour, contractGateRelief,
// withdrawalRelief); each returns "no change" for a house without office or influence. The
// integrator wires them in.
//
// The system rolls on its own stream, seeded once from where the run's RNG stands without drawing
// from it (as finance does), so its rolls never shift another system's.
import type { DecisionResult } from "../actions";
import { checkCapacity, useCapacity } from "../capacity";
import { inCrisis } from "../crisis";
import { nextQuarter, type QuarterDate } from "../events";
import { ageIn } from "../family";
import { fl } from "../format";
import { changeOpinion, tradingHouses } from "../houses";
import { addEntry } from "../ledger";
import { freeCash } from "../reserves";
import { createRng, type Rng, type SeededRng } from "../rng";
import { cloneState } from "../state";
import { netWorth } from "../turn";
import type { GameData } from "../tuning";
import type { Decision, GameState, Person, Sentiment } from "../types";

// ---------------------------------------------------------------- data/politics.json

export type OfficeId = "senate" | "diet";

export interface OfficeData {
  id: OfficeId;
  /** "the Senate", for sentences. */
  name: string;
  /** What the holder is called. */
  title: string;
  /** First quarter a vacancy can open. */
  from: QuarterDate;
  /** The post ends when the quarter being entered reaches this date (the Diet, 1848). */
  until?: QuarterDate;
  /** Only the holder of this office may stand. */
  requires?: OfficeId;
  vacancy_chance: number;
  /** Paid when standing (entertaining, gifts to electors), win or lose. */
  cost: number;
  min_age: number;
  min_reputation: number;
  min_influence: number;
  /** The citizen's property bar. */
  min_net_worth: number;
  influence_per_quarter: number;
  win: { base: number; per_reputation: number; per_influence: number; per_opinion: number; min: number; max: number };
  win_reputation: number;
  /** Every house still trading thinks this much better of the house on a win. */
  win_opinion: number;
  /** Influence lost when the holder dies or leaves the line. */
  loss_influence: number;
}

export interface CourtData {
  id: string;
  name: string;
  prince: string;
  /** The state in data/states.json this court rules, if any (its loan contracts favour its banker). */
  state?: string;
  min_reputation: number;
  min_influence: number;
  gift: number;
  /** Range of a loan request, whole gulden. */
  amount: number[];
}

type ByMood = Record<Sentiment, number>;

export interface PoliticsLetterEffect {
  /** The response these effects follow. */
  option: string;
  influence?: number;
  /** A loan to a court, made when the letter settles if the cash is there (else it lapses). */
  court_loan?: { court: string; amount: number; rate: number; term_quarters: number };
}

export interface PoliticsLetterData {
  event: string;
  /** The quarter the letter describes (it arrives at the end of the quarter before). */
  year: number;
  quarter: 1 | 2 | 3 | 4;
  /** all: every house; senator: a house with a Senate seat; court_or_influence: a court banker, or influence of at least min_influence. */
  to: "all" | "senator" | "court_or_influence";
  min_influence?: number;
  /** Politics effects by response, applied once the letter settles. Responses not listed have none. */
  responses: PoliticsLetterEffect[];
}

export interface PoliticsData {
  /** False silences every roll and letter (the test data uses it). Decisions still work. */
  enabled: boolean;
  influence: { start: number; max: number; decay: number; cultivate: { cost: number; gain: number } };
  offices: OfficeData[];
  courts: {
    list: CourtData[];
    max_held: number;
    influence_per_quarter: number;
    reputation_per_year: number;
    favour: { start: number; accept: number; decline: number; max: number; dismiss_below: number };
    dismiss_influence: number;
    request_chance: number;
    request_mood: ByMood;
    amount_step: number;
    rate: number;
    term_quarters: number;
    accept_influence: number;
    delay_chance: ByMood;
    delay_quarters: number;
    default_chance: number;
    default_mood: ByMood;
    /** Commission a state takes off its own banker's bid when ranking it. */
    contract_favour: number;
    /** Reputation a state asks less of its own banker. */
    gate_relief: number;
  };
  contracts: { favour_per_influence: number; gate_per_influence: number; max_gate: number };
  assurance: { influence: number; min_influence: number; withdrawal_factor: number };
  letters: PoliticsLetterData[];
}

// ---------------------------------------------------------------- state.politics

export interface Seat {
  office: OfficeId;
  person: number;
  since_turn: number;
}

export interface Vacancy {
  office: OfficeId;
  /** The quarter the seat can be stood for. */
  turn: number;
  /** The member standing, once the house has put one forward. */
  candidate: number | null;
}

export interface CourtPost {
  court: string;
  since_turn: number;
  favour: number;
}

export interface CourtRequest {
  id: number;
  court: string;
  amount: number;
  rate: number;
  term_quarters: number;
  /** The quarter it can be accepted in. */
  turn: number;
  accepted: boolean;
}

export interface CourtLoan {
  id: number;
  court: string;
  principal: number;
  rate: number;
  start_turn: number;
  due_turn: number;
  status: "active" | "repaid" | "defaulted";
}

export interface PoliticsState {
  rng_state: number;
  next_id: number;
  influence: number;
  seats: Seat[];
  vacancies: Vacancy[];
  courts: CourtPost[];
  /** Courts that dismissed the house: they will not take it back. */
  dismissed: string[];
  requests: CourtRequest[];
  loans: CourtLoan[];
  /** The quarter the Senate's assurance was given, or null. */
  assurance_turn: number | null;
  /** How many of state.letter_outcomes politics has already read. */
  outcomes_seen: number;
}

export interface StandForOfficeDecision {
  kind: "stand_for_office";
  office: OfficeId;
  member: number;
}
export interface CultivateInfluenceDecision {
  kind: "cultivate_influence";
}
export interface SeekCourtDecision {
  kind: "seek_court";
  court: string;
}
export interface LendCourtDecision {
  kind: "lend_court";
  request: number;
}
export interface SenateAssuranceDecision {
  kind: "senate_assurance";
}

export type PoliticsDecision = StandForOfficeDecision | CultivateInfluenceDecision | SeekCourtDecision | LendCourtDecision | SenateAssuranceDecision;
export type PoliticsCategory = "political_gift" | "court_loan" | "court_interest" | "court_repayment" | "court_default";
/** Ledger accounts this system holds, counted in net worth through `politicsBook`. */
export type PoliticsAccount = "court_loans";

const KINDS: ReadonlySet<string> = new Set(["stand_for_office", "cultivate_influence", "seek_court", "lend_court", "senate_assurance"]);

export function createPolitics(data: GameData, rng: Rng): PoliticsState {
  const seed = ((rng as Partial<SeededRng>).state ?? Math.floor(rng.next() * 0x100000000)) ^ 0x2c0f1e57;
  return {
    rng_state: createRng(seed >>> 0).state,
    next_id: 1,
    influence: data.politics.influence.start,
    seats: [],
    vacancies: [],
    courts: [],
    dismissed: [],
    requests: [],
    loans: [],
    assurance_turn: null,
    outcomes_seen: 0,
  };
}

// ---------------------------------------------------------------- small helpers

const dateIndex = (d: QuarterDate) => d.year * 4 + d.quarter;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const officeData = (id: OfficeId, data: GameData) => data.politics.offices.find((o) => o.id === id);
export const courtData = (id: string, data: GameData) => data.politics.courts.list.find((c) => c.id === id);

function withPoliticsRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = createRng(state.politics.rng_state);
  const out = fn(rng);
  state.politics.rng_state = rng.state;
  return out;
}

function politicsNews(state: GameState, title: string, text: string): void {
  state.news.push({ turn: state.world.turn, kind: "event", title, text });
}

function changeInfluence(state: GameState, delta: number, data: GameData): void {
  state.politics.influence = clamp(Math.round(state.politics.influence + delta), 0, data.politics.influence.max);
}

const personById = (state: GameState, id: number) => state.people.find((p) => p.id === id);

/** The seat a house holds in `office`, if any. */
export const seatIn = (state: GameState, office: OfficeId): Seat | undefined => state.politics.seats.find((s) => s.office === office);

/** True if the office is open for vacancies in the quarter `date`. */
function officeOpen(o: OfficeData, date: QuarterDate): boolean {
  if (dateIndex(date) < dateIndex(o.from)) return false;
  return !o.until || dateIndex(date) < dateIndex(o.until);
}

// ---------------------------------------------------------------- read by other systems

/** The house's influence, 0 to 100. B3 legacy reads it for prestige. */
export function influence(state: GameState): number {
  return state.politics.influence;
}

/** The offices the house holds: seats by office (the holder's person id) and the courts it serves. */
export function offices(state: GameState): { senate: number | null; diet: number | null; courts: string[] } {
  return {
    senate: seatIn(state, "senate")?.person ?? null,
    diet: seatIn(state, "diet")?.person ?? null,
    courts: state.politics.courts.map((c) => c.court),
  };
}

/** True if the house is banker to the court that rules `stateId`. */
function servesStateCourt(state: GameState, stateId: string, data: GameData): boolean {
  return state.politics.courts.some((c) => courtData(c.court, data)?.state === stateId);
}

/**
 * Commission a state takes off the player's bid when ranking it for a loan contract (A5's
 * bidScore): more for influence, and more again for the state's own court banker. 0 means no
 * change. For the integrator to subtract in src/sim/finance/contracts.ts.
 */
export function contractFavour(state: GameState, stateId: string, data: GameData): number {
  const p = data.politics;
  const own = servesStateCourt(state, stateId, data) ? p.courts.contract_favour : 0;
  return Math.round((state.politics.influence * p.contracts.favour_per_influence + own) * 10000) / 10000;
}

/**
 * Reputation a state asks less of the player for its bonds and contracts: a point per ten of
 * influence (at most max_gate) and the court banker's relief. 0 means no change.
 */
export function contractGateRelief(state: GameState, stateId: string, data: GameData): number {
  const p = data.politics;
  const own = servesStateCourt(state, stateId, data) ? p.courts.gate_relief : 0;
  return Math.min(p.contracts.max_gate, Math.floor(state.politics.influence * p.contracts.gate_per_influence)) + own;
}

/** Factor on this quarter's withdrawals: lower after the Senate's assurance, otherwise 1 (no change). */
export function withdrawalRelief(state: GameState, data: GameData): number {
  return state.politics.assurance_turn === state.world.turn ? data.politics.assurance.withdrawal_factor : 1;
}

/** What court loans are worth: the principal still out. */
export function politicsBook(state: GameState): number {
  return state.politics.loans.filter((l) => l.status === "active").reduce((s, l) => s + l.principal, 0);
}

/** Balances of the ledger accounts this system adds, for the save check. */
export function politicsAccounts(state: GameState): Record<PoliticsAccount, number> {
  return { court_loans: politicsBook(state) };
}

/** Requests open for an answer this quarter. */
export function openCourtRequests(state: GameState): CourtRequest[] {
  return state.politics.requests.filter((r) => r.turn === state.world.turn && !r.accepted);
}

/** The vacancy in `office` open this quarter, if any. */
export function openVacancy(state: GameState, office: OfficeId): Vacancy | undefined {
  return state.politics.vacancies.find((v) => v.office === office && v.turn === state.world.turn);
}

/** Members who may stand for `office` now (ignoring the house's own bars). */
export function eligibleMembers(state: GameState, office: OfficeId, data: GameData): Person[] {
  const o = officeData(office, data);
  if (!o) return [];
  const holder = o.requires ? seatIn(state, o.requires)?.person : undefined;
  return state.people.filter(
    (p) =>
      p.role === "line" &&
      p.death_year === null &&
      p.gender === "m" &&
      ageIn(p, state.world.year) >= o.min_age &&
      !state.politics.seats.some((s) => s.office === office && s.person === p.id) &&
      (!o.requires || holder === p.id),
  );
}

/** Chance a candidate wins `office` now: reputation, influence and the bourse's opinion, within limits. */
export function winChance(state: GameState, office: OfficeId, data: GameData): number {
  const o = officeData(office, data)!;
  const houses = tradingHouses(state);
  const opinion = houses.length ? houses.reduce((s, h) => s + h.opinion, 0) / houses.length : 0;
  const w = o.win;
  const p = w.base + w.per_reputation * (state.house.reputation - 50) + w.per_influence * state.politics.influence + w.per_opinion * opinion;
  return Math.round(clamp(p, w.min, w.max) * 1000) / 1000;
}

/** Politics effects of a letter response, in words, for response cards. Empty if none. */
export function politicsOptionEffects(event: string, option: string, data: GameData): string[] {
  const e = data.politics.letters.find((l) => l.event === event)?.responses.find((r) => r.option === option);
  if (!e) return [];
  const out: string[] = [];
  if (e.influence) out.push(`influence ${e.influence > 0 ? "+" : "−"}${Math.abs(e.influence)}`);
  if (e.court_loan) {
    const c = courtData(e.court_loan.court, data);
    out.push(`lends ${fl(e.court_loan.amount)} to ${c?.name ?? e.court_loan.court} at ${Math.round(e.court_loan.rate * 1000) / 10}% for ${e.court_loan.term_quarters} quarters`);
  }
  return out;
}

// ---------------------------------------------------------------- End Turn

/**
 * One quarter of politics, just after the other houses' quarter:
 * 1. bankruptcy strips every office (bankrupts were barred) and stops here;
 * 2. letters settled this End Turn apply their politics effects;
 * 3. a candidate standing this quarter wins or loses (one roll);
 * 4. seats lapse whose holder has died or left the line, or whose office has ended;
 * 5. court requests left unanswered count as declined; a court whose favour falls below the floor dismisses the house;
 * 6. court loans pay interest, may default (one roll each), and at term are repaid or put off (one roll);
 * 7. influence decays and the offices add to it; at year end each court adds reputation;
 * 8. next quarter's vacancies and court requests are drawn, and its politics letters posted.
 * Mutates `state`.
 */
export function resolvePolitics(state: GameState, _rng: Rng, data: GameData): void {
  const p = data.politics;
  if (state.house.status === "bankrupt") {
    stripOffices(state);
    return;
  }
  if (!p.enabled) return;
  withPoliticsRng(state, (rng) => {
    applyLetterOutcomes(state, data);
    settleCandidacies(state, rng, data);
    lapseSeats(state, data);
    settleRequests(state, data);
    serviceCourtLoans(state, rng, data);
    growInfluence(state, data);
    if (state.world.quarter === 4 && state.politics.courts.length) {
      const gain = p.courts.reputation_per_year * state.politics.courts.length;
      state.house.reputation = Math.min(100, state.house.reputation + gain);
    }
    drawVacancies(state, rng, data);
    drawCourtRequests(state, rng, data);
    postLetters(state, data);
  });
}

/** Bankruptcy: every seat and court post is lost, open business closes. Draws nothing. */
export function stripOffices(state: GameState): void {
  const pol = state.politics;
  pol.seats = [];
  pol.courts = [];
  pol.vacancies = [];
  pol.requests = [];
}

/** Applies the politics effects of letters settled since politics last looked. Mutates `state`. */
export function applyLetterOutcomes(state: GameState, data: GameData): void {
  const outcomes = state.letter_outcomes.slice(state.politics.outcomes_seen);
  state.politics.outcomes_seen = state.letter_outcomes.length;
  for (const o of outcomes) {
    const e = data.politics.letters.find((l) => l.event === o.event)?.responses.find((r) => r.option === o.option);
    if (!e) continue;
    if (e.court_loan) {
      const c = e.court_loan;
      if (state.house.cash < c.amount) {
        politicsNews(state, "A loan that could not be made", `The house promised ${fl(c.amount)} to ${courtData(c.court, data)?.name ?? c.court}, but the money was not in the till. Nothing is sent, and nothing is gained.`);
        continue;
      }
      makeCourtLoan(state, c.court, c.amount, c.rate, c.term_quarters, data);
    }
    if (e.influence) changeInfluence(state, e.influence, data);
  }
}

function settleCandidacies(state: GameState, rng: Rng, data: GameData): void {
  const pol = state.politics;
  for (const v of pol.vacancies.filter((x) => x.turn === state.world.turn)) {
    if (v.candidate === null) continue;
    const o = officeData(v.office, data)!;
    const who = personById(state, v.candidate);
    // A candidate who died this quarter cannot take the seat.
    if (!who || who.death_year !== null || who.role !== "line") continue;
    const won = rng.next() < winChance(state, v.office, data);
    if (!won) {
      politicsNews(state, `Passed over for ${o.name}`, `${who.name} stood for ${o.name}, but another was chosen.`);
      continue;
    }
    pol.seats.push({ office: v.office, person: who.id, since_turn: state.world.turn });
    state.house.reputation = Math.min(100, state.house.reputation + o.win_reputation);
    if (o.win_opinion) for (const h of tradingHouses(state)) changeOpinion(state, h.id, o.win_opinion, data.tuning);
    politicsNews(state, `${o.title}: ${who.name}`, `${who.name} has been chosen for ${o.name}. The house's word now carries further.`);
  }
  pol.vacancies = pol.vacancies.filter((x) => x.turn > state.world.turn);
}

/** Seats whose holder has died or left the line lapse; an office that has ended closes. Draws nothing. */
export function lapseSeats(state: GameState, data: GameData): void {
  const pol = state.politics;
  const entering = nextQuarter(state.world);
  const kept: Seat[] = [];
  for (const s of pol.seats) {
    const o = officeData(s.office, data);
    const who = personById(state, s.person);
    const holderGone = !who || who.death_year !== null || who.role !== "line";
    const ended = !o || (o.until !== undefined && dateIndex(entering) >= dateIndex(o.until));
    const lostRequired = o?.requires !== undefined && !pol.seats.some((x) => x.office === o.requires && x.person === s.person && personById(state, x.person)?.death_year === null && personById(state, x.person)?.role === "line");
    if (!holderGone && !ended && !lostRequired) {
      kept.push(s);
      continue;
    }
    const name = who?.name ?? "The house's member";
    if (holderGone) {
      changeInfluence(state, -(o?.loss_influence ?? 0), data);
      politicsNews(state, `A seat in ${o?.name ?? s.office} falls vacant`, `With ${name} gone, the house no longer has a voice in ${o?.name ?? s.office}.`);
    } else if (ended) {
      politicsNews(state, `The end of ${o!.name}`, `${o!.name.replace(/^the /, "The ")} has handed its powers to the Regent. ${name} is no longer the city's envoy.`);
    }
  }
  pol.seats = kept;
}

function settleRequests(state: GameState, data: GameData): void {
  const pol = state.politics;
  const f = data.politics.courts.favour;
  for (const r of pol.requests.filter((x) => x.turn === state.world.turn && !x.accepted)) {
    const post = pol.courts.find((c) => c.court === r.court);
    if (!post) continue;
    post.favour = Math.max(-100, post.favour - f.decline);
  }
  pol.requests = pol.requests.filter((x) => x.turn > state.world.turn);
  for (const post of [...pol.courts]) {
    if (post.favour >= f.dismiss_below) continue;
    pol.courts = pol.courts.filter((c) => c !== post);
    pol.dismissed.push(post.court);
    changeInfluence(state, -data.politics.courts.dismiss_influence, data);
    const c = courtData(post.court, data);
    politicsNews(state, "Dismissed by a court", `${c?.prince ?? "A prince"}, refused once too often, has found another banker. The house is no longer banker to ${c?.name ?? post.court}.`);
  }
}

function serviceCourtLoans(state: GameState, rng: Rng, data: GameData): void {
  const t = data.politics.courts;
  const mood = state.world.sentiment;
  for (const l of state.politics.loans) {
    if (l.status !== "active" || l.start_turn >= state.world.turn) continue;
    const name = courtData(l.court, data)?.name ?? l.court;
    if (rng.next() < t.default_chance * t.default_mood[mood]) {
      l.status = "defaulted";
      addEntry(state, "court_loans", "court_default", -l.principal, `Court loan #${l.id}: ${name} will not repay`);
      politicsNews(state, "A court will not pay", `${name.replace(/^the /, "The ")} declares it cannot repay the ${fl(l.principal)} it owes the house. There is no court to sue a prince in.`);
      continue;
    }
    const interest = Math.round((l.principal * l.rate) / 4);
    if (interest > 0) {
      state.house.cash += interest;
      addEntry(state, "cash", "court_interest", interest, `Court loan #${l.id}: interest from ${name}`);
    }
    if (state.world.turn < l.due_turn) continue;
    if (rng.next() < t.delay_chance[mood]) {
      l.due_turn = state.world.turn + t.delay_quarters;
      politicsNews(state, "Repayment put off", `${name.replace(/^the /, "The ")} asks for another year on its loan of ${fl(l.principal)}. A court banker does not refuse.`);
      continue;
    }
    l.status = "repaid";
    state.house.cash += l.principal;
    const note = `Court loan #${l.id}: repaid by ${name}`;
    addEntry(state, "cash", "court_repayment", l.principal, note);
    addEntry(state, "court_loans", "court_repayment", -l.principal, note);
  }
}

/** Influence decays (rounded down, so a little goes in the end) and each office adds to it. Draws nothing. */
export function growInfluence(state: GameState, data: GameData): void {
  const p = data.politics;
  const income =
    state.politics.seats.reduce((s, seat) => s + (officeData(seat.office, data)?.influence_per_quarter ?? 0), 0) + p.courts.influence_per_quarter * state.politics.courts.length;
  const kept = Math.floor(state.politics.influence * (1 - p.influence.decay));
  state.politics.influence = clamp(kept + income, 0, p.influence.max);
}

function drawVacancies(state: GameState, rng: Rng, data: GameData): void {
  const date = nextQuarter(state.world);
  for (const o of data.politics.offices) {
    if (!officeOpen(o, date) || seatIn(state, o.id)) continue;
    // Roll even when no one could stand, so the stream does not depend on the family.
    if (rng.next() >= o.vacancy_chance) continue;
    if (o.requires && !seatIn(state, o.requires)) continue;
    state.politics.vacancies.push({ office: o.id, turn: state.world.turn + 1, candidate: null });
    politicsNews(state, `A vacancy in ${o.name}`, `A place in ${o.name} falls vacant. A man of the house, 30 or older, may stand for it this quarter.`);
  }
}

function drawCourtRequests(state: GameState, rng: Rng, data: GameData): void {
  const t = data.politics.courts;
  for (const post of state.politics.courts) {
    const c = courtData(post.court, data);
    if (!c) continue;
    if (rng.next() >= t.request_chance * t.request_mood[state.world.sentiment]) continue;
    const [lo, hi] = [c.amount[0]!, c.amount[1]!];
    const raw = lo + (hi - lo) * rng.next();
    const amount = Math.round(raw / t.amount_step) * t.amount_step;
    state.politics.requests.push({ id: state.politics.next_id++, court: c.id, amount, rate: t.rate, term_quarters: t.term_quarters, turn: state.world.turn + 1, accepted: false });
    politicsNews(state, `${c.prince.replace(/^the /, "The ")} asks for money`, `${c.name.replace(/^the /, "The ")} asks its banker for ${fl(amount)} at ${Math.round(t.rate * 1000) / 10}% for ${t.term_quarters} quarters. A refusal will be remembered.`);
  }
}

/** True if a politics letter should go to this house now. */
function letterFor(state: GameState, l: PoliticsLetterData): boolean {
  switch (l.to) {
    case "all":
      return true;
    case "senator":
      return seatIn(state, "senate") !== undefined;
    case "court_or_influence":
      return state.politics.courts.length > 0 || state.politics.influence >= (l.min_influence ?? 0);
  }
}

/** Posts the politics letters dated next quarter whose conditions hold. Draws nothing. */
export function postLetters(state: GameState, data: GameData): void {
  const date = nextQuarter(state.world);
  for (const l of data.politics.letters) {
    if (dateIndex({ year: l.year, quarter: l.quarter }) !== dateIndex(date)) continue;
    if (!letterFor(state, l)) continue;
    const ev = data.events.find((e) => e.id === l.event);
    if (!ev || state.fired_events.some((f) => f.id === l.event) || state.letters.some((x) => x.event === l.event)) continue;
    state.fired_events.push({ id: ev.id, turn: state.world.turn });
    state.letters.push({ event: ev.id, turn: state.world.turn, answer: null });
  }
}

function makeCourtLoan(state: GameState, court: string, amount: number, rate: number, term: number, data: GameData): CourtLoan {
  const loan: CourtLoan = { id: state.politics.next_id++, court, principal: amount, rate, start_turn: state.world.turn, due_turn: state.world.turn + term, status: "active" };
  state.politics.loans.push(loan);
  state.house.cash -= amount;
  const note = `Court loan #${loan.id}: to ${courtData(court, data)?.name ?? court} at ${Math.round(rate * 1000) / 10}%`;
  addEntry(state, "cash", "court_loan", -amount, note);
  addEntry(state, "court_loans", "court_loan", amount, note);
  return loan;
}

// ---------------------------------------------------------------- decisions

export const isPoliticsDecision = (d: Decision): d is PoliticsDecision => KINDS.has(d.kind);

const notEnough = (cost: number, state: GameState) => `Not enough cash above the reserve (cost ${fl(cost)}, free ${fl(freeCash(state))})`;

/** Returns why a politics decision is invalid, or null if it can go ahead. */
export function checkPoliticsDecision(state: GameState, d: PoliticsDecision, data: GameData): string | null {
  const noAction = checkCapacity(state, d.kind, data.tuning);
  if (noAction) return noAction;
  const p = data.politics;
  const pol = state.politics;
  switch (d.kind) {
    case "stand_for_office": {
      const o = officeData(d.office, data);
      if (!o) return `Unknown office "${d.office}"`;
      const v = openVacancy(state, d.office);
      if (!v) return `No place in ${o.name} is vacant this quarter`;
      if (v.candidate !== null) return `The house already has a candidate for ${o.name}`;
      const who = personById(state, d.member);
      if (!who) return `Unknown member #${d.member}`;
      if (!eligibleMembers(state, d.office, data).some((x) => x.id === d.member)) {
        if (who.death_year !== null || who.role !== "line") return `${who.name} is not a living member of the line`;
        if (who.gender !== "m") return `Only men could sit in ${o.name}`;
        if (ageIn(who, state.world.year) < o.min_age) return `${who.name} must be ${o.min_age} or older`;
        if (o.requires) return `Only the house's member in ${officeData(o.requires, data)?.name ?? o.requires} may stand`;
        return `${who.name} already sits in ${o.name}`;
      }
      if (state.house.reputation < o.min_reputation) return `${o.name.replace(/^the /, "The ")} takes only a house of reputation ${o.min_reputation} or more (yours is ${state.house.reputation})`;
      if (pol.influence < o.min_influence) return `Standing for ${o.name} needs influence of ${o.min_influence} (yours is ${pol.influence})`;
      if (netWorth(state) < o.min_net_worth) return `A citizen must hold ${fl(o.min_net_worth)} in property to stand`;
      if (o.cost > freeCash(state)) return notEnough(o.cost, state);
      return null;
    }
    case "cultivate_influence":
      if (pol.influence >= p.influence.max) return "The house's influence is already at its height";
      if (p.influence.cultivate.cost > freeCash(state)) return notEnough(p.influence.cultivate.cost, state);
      return null;
    case "seek_court": {
      const c = courtData(d.court, data);
      if (!c) return `Unknown court "${d.court}"`;
      if (pol.courts.some((x) => x.court === d.court)) return `The house is already banker to ${c.name}`;
      if (pol.dismissed.includes(d.court)) return `${c.prince.replace(/^the /, "The ")} has dismissed the house and will not take it back`;
      if (pol.courts.length >= p.courts.max_held) return `A house can serve at most ${p.courts.max_held} courts`;
      if (state.house.reputation < c.min_reputation) return `${c.name.replace(/^the /, "The ")} takes only a house of reputation ${c.min_reputation} or more (yours is ${state.house.reputation})`;
      if (pol.influence < c.min_influence) return `${c.name.replace(/^the /, "The ")} needs influence of ${c.min_influence} (yours is ${pol.influence})`;
      if (c.gift > freeCash(state)) return notEnough(c.gift, state);
      return null;
    }
    case "lend_court": {
      const r = openCourtRequests(state).find((x) => x.id === d.request);
      if (!r) return `No court request #${d.request} is open this quarter`;
      if (r.amount > freeCash(state)) return notEnough(r.amount, state);
      return null;
    }
    case "senate_assurance":
      if (!seatIn(state, "senate")) return "Only a house with a seat in the Senate can give the city's assurance";
      if (!inCrisis(state)) return "The Senate's assurance is only for an uneasy or panicking market";
      if (pol.assurance_turn === state.world.turn) return "The assurance has already been given this quarter";
      if (pol.influence < Math.max(p.assurance.min_influence, p.assurance.influence)) return `The assurance needs influence of ${Math.max(p.assurance.min_influence, p.assurance.influence)} (yours is ${pol.influence})`;
      return null;
  }
}

export function applyPoliticsDecision(state: GameState, d: PoliticsDecision, data: GameData): DecisionResult {
  const reason = checkPoliticsDecision(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const p = data.politics;
  const pol = next.politics;
  const pay = (amount: number, note: string) => {
    next.house.cash -= amount;
    addEntry(next, "cash", "political_gift", -amount, note);
  };
  switch (d.kind) {
    case "stand_for_office": {
      const o = officeData(d.office, data)!;
      pay(o.cost, `Standing for ${o.name}: ${personById(next, d.member)!.name}`);
      openVacancy(next, d.office)!.candidate = d.member;
      break;
    }
    case "cultivate_influence":
      pay(p.influence.cultivate.cost, "Dinners, gifts and favours to men of influence");
      changeInfluence(next, p.influence.cultivate.gain, data);
      break;
    case "seek_court": {
      const c = courtData(d.court, data)!;
      pay(c.gift, `A gift to ${c.prince}`);
      pol.courts.push({ court: c.id, since_turn: next.world.turn, favour: p.courts.favour.start });
      break;
    }
    case "lend_court": {
      const r = pol.requests.find((x) => x.id === d.request)!;
      r.accepted = true;
      makeCourtLoan(next, r.court, r.amount, r.rate, r.term_quarters, data);
      const post = pol.courts.find((c) => c.court === r.court);
      if (post) post.favour = Math.min(p.courts.favour.max, post.favour + p.courts.favour.accept);
      changeInfluence(next, p.courts.accept_influence, data);
      break;
    }
    case "senate_assurance":
      changeInfluence(next, -p.assurance.influence, data);
      pol.assurance_turn = next.world.turn;
      break;
  }
  useCapacity(next, d.kind, data.tuning);
  return { ok: true, state: next };
}

export function describePoliticsDecision(d: PoliticsDecision, state: GameState, data: GameData): string {
  switch (d.kind) {
    case "stand_for_office":
      return `${personById(state, d.member)?.name ?? `Member #${d.member}`} stands for ${officeData(d.office, data)?.name ?? d.office}`;
    case "cultivate_influence":
      return `Cultivate men of influence (${fl(data.politics.influence.cultivate.cost)})`;
    case "seek_court": {
      const c = courtData(d.court, data);
      return `Seek to become banker to ${c?.name ?? d.court}${c ? ` (a gift of ${fl(c.gift)})` : ""}`;
    }
    case "lend_court": {
      const r = state.politics.requests.find((x) => x.id === d.request);
      return r ? `Lend ${fl(r.amount)} to ${courtData(r.court, data)?.name ?? r.court}` : `Answer court request #${d.request}`;
    }
    case "senate_assurance":
      return "Ask the Senate to assure the city of the house's soundness";
  }
}

// ---------------------------------------------------------------- data check

/** Problems with data/politics.json and the politics letters, as readable lines. Empty means sound. */
export function checkPoliticsData(data: GameData): string[] {
  const problems: string[] = [];
  const p = data.politics;
  const dash = /[\u2014\u2013]/;
  if (dash.test(JSON.stringify(p))) problems.push("politics.json uses a dash; the writing style forbids em dashes");
  const officeIds = new Set(p.offices.map((o) => o.id));
  for (const o of p.offices) {
    if (o.requires && !officeIds.has(o.requires)) problems.push(`${o.id}: requires unknown office "${o.requires}"`);
    if (!(o.vacancy_chance >= 0 && o.vacancy_chance <= 1)) problems.push(`${o.id}: vacancy_chance must be 0 to 1`);
    if (o.win.min > o.win.max) problems.push(`${o.id}: win.min above win.max`);
  }
  const stateIds = new Set(data.states.map((s) => s.id));
  const courtIds = new Set<string>();
  for (const c of p.courts.list) {
    if (courtIds.has(c.id)) problems.push(`${c.id}: duplicate court`);
    courtIds.add(c.id);
    if (c.state && !stateIds.has(c.state)) problems.push(`${c.id}: unknown state "${c.state}"`);
    if (c.amount.length !== 2 || !(c.amount[0]! > 0 && c.amount[1]! >= c.amount[0]!)) problems.push(`${c.id}: amount needs a range above zero`);
  }
  for (const l of p.letters) {
    const ev = data.events.find((e) => e.id === l.event);
    if (!l.event.startsWith("politics-")) problems.push(`${l.event}: politics letters have ids starting "politics-"`);
    if (!ev) {
      problems.push(`${l.event}: no such event in data/events.json`);
      continue;
    }
    if (!ev.follow_up) problems.push(`${l.event}: must be marked follow_up so it never fires by date or weight`);
    if (!ev.options?.length) problems.push(`${l.event}: needs responses`);
    for (const e of l.responses) {
      const opt = e.option;
      if (!ev.options?.some((o) => o.id === opt)) problems.push(`${l.event}: effects name unknown response "${opt}"`);
      if (e.court_loan && !courtIds.has(e.court_loan.court)) problems.push(`${l.event}: unknown court "${e.court_loan.court}"`);
      if (opt === ev.default_option && e.court_loan) problems.push(`${l.event}: the default response cannot lend`);
    }
  }
  return problems;
}
