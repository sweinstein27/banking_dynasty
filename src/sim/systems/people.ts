// B2, people with agendas: loyalty, family letters (requests, a member who means to leave, claims
// at a succession, feuds), members splitting off to found a rival house, and education paths.
// The family itself is state.people (src/sim/family.ts); this system keeps state.agendas.
//
// Family letters work like the D3 letters but name a person, so they live here, not in
// data/events.json. A letter arrives at End Turn and is answered in the next quarter. An answer's
// certain effects apply at once; anything that draws (a venture's luck, a forbidden heir's choice,
// the court) is settled at the next End Turn, when unanswered letters take their default.
//
// The system rolls on its own stream, seeded once from the run's RNG (as the markets do), so its
// rolls never shift another system's.
import type { DecisionResult } from "../actions";
import { runOver } from "../actions";
import { checkCapacity, useCapacity } from "../capacity";
import { ageIn, effectiveStat, headOf, heirsOf, livingSpouse, reputationGain, STATS, type Stat } from "../family";
import { fl } from "../format";
import { changeOpinion, tradingHouses } from "../houses";
import { addEntry } from "../ledger";
import { arrangeMarriage, checkMarriage, marriageable } from "../marriages";
import { freeCash } from "../reserves";
import { createRng, type Rng } from "../rng";
import { cloneState } from "../state";
import { netWorth } from "../turn";
import { openTraits } from "../traits";
import type { GameData } from "../tuning";
import type { Decision, GameState, OtherHouse, Person } from "../types";
import { desksTaken, roomData } from "./counting";

// ---------------------------------------------------------------- data/people.json

export type AgendaId = "venture" | "charity" | "match" | "desk" | "allowance";

export interface AgendaData {
  id: AgendaId;
  weight: number;
  cost?: number;
  /** venture: the chance it pays, and what it pays. */
  chance?: number;
  payout?: number;
  /** charity: reputation points (scaled by the head's traits). */
  reputation?: number;
  /** desk: acumen (before traits) that qualifies without the trait. */
  min_acumen?: number;
  /** The trait that makes a member ask (desk, allowance). */
  trait?: string;
  title: string;
  text: string;
  grant_text: string;
  refuse_text: string;
  won_text?: string;
  lost_text?: string;
}

export interface StudyData {
  id: string;
  name: string;
  min_age: number;
  max_age: number;
  quarters: number;
  cost: number;
  gains: Partial<Record<Stat, number>>;
  trait?: string;
  trait_chance?: number;
  /** One Frankfurt house, picked at random, thinks this much better of the house (a classmate). */
  contact_opinion?: number;
  loyalty: number;
  start_text: string;
  return_text: string;
}

export interface PeopleData {
  /** False silences every letter and roll (the test data uses it). Studies and desks still work. */
  enabled: boolean;
  loyalty: {
    start_heir: number;
    start_spouse: number;
    min: number;
    max: number;
    loyal: number;
    disloyal: number;
    grant: number;
    refuse: number;
    passed_over_by_naming: number;
    after_claim_paid: number;
    drift_to: number;
    drift_per_year: number;
  };
  requests: { chance: number; min_age: number; cooldown_quarters: number };
  agendas: AgendaData[];
  /** Traits that make a member ask for a venture or for charity. */
  agenda_traits: { venture: string[]; charity: string[] };
  split: {
    chance: number;
    feud_chance: number;
    buy_off: number;
    buy_off_loyalty: number;
    forbid_stay: number;
    forbid_loyalty: number;
    capital_share: number;
    capital_max: number;
    deposit_share: number;
    reputation: number;
    opinion: number;
    baseline: number;
    feud_opinion: number;
    reputation_base: number;
    reputation_per_connection: number;
    bold_traits: string[];
    title: string;
    text: string;
    buy_off_text: string;
    stay_text: string;
    leave_text: string;
  };
  claims: {
    share: number;
    max: number;
    law_cost: number;
    law_win: number;
    law_reputation: number;
    law_loyalty: number;
    title: string;
    text: string;
    pay_text: string;
    law_won_text: string;
    law_lost_text: string;
    refuse_text: string;
  };
  feuds: {
    reputation_per_quarter: number;
    /** A feud dies out after this many quarters. */
    max_quarters: number;
    reconcile_share: number;
    title: string;
    text: string;
    pay_text: string;
    refuse_text: string;
    ended_death_text: string;
    cooled_text: string;
  };
  studies: StudyData[];
  /** A family clerk's staff trait, from their own traits. */
  desk_traits: Record<string, string>;
  desk_trait_default: string;
}

// ---------------------------------------------------------------- state.agendas

export type FamilyLetterKind = "request" | "leaving" | "claim" | "reconcile";

export interface FamilyLetter {
  id: number;
  kind: FamilyLetterKind;
  /** The request's agenda; null for other kinds. */
  agenda: AgendaId | null;
  /** Who writes. */
  person: number;
  /** The turn at whose end it arrived. */
  turn: number;
  /** Money named in the letter: a claim, terms to end a feud. 0 if none. */
  amount: number;
  /** match: the member to marry, and the house proposed ("merchant" for a merchant family). */
  member: number | null;
  house: string | null;
  /** The chosen response, or null while unanswered. Its certain effects have already applied. */
  answer: string | null;
}

export interface Feud {
  /** The claimant. */
  person: number;
  /** The head they quarrel with. The feud ends with that head. */
  head: number;
  since: number;
}

export interface Study {
  person: number;
  path: string;
  start: number;
  /** Returns at the end of turn until - 1. */
  until: number;
}

/** Something that happened, for the news. */
export interface PeopleLogEntry {
  turn: number;
  title?: string;
  text: string;
}

/** state.agendas (the family itself is state.people) */
export interface PeopleState {
  rng_state: number;
  /** Loyalty by person id. Missing means the starting value for their role. */
  loyalty: Record<string, number>;
  letters: FamilyLetter[];
  next_letter_id: number;
  /** The turn each person last asked for something. */
  last_asked: Record<string, number>;
  feuds: Feud[];
  studies: Study[];
  /** Paths each person has begun, by person id: each path is taken once. */
  studied: Record<string, string[]>;
  /** Family clerks: person id to staff id in state.counting.staff. */
  desks: Record<string, number>;
  /** Successions already looked at for claims. */
  successions_seen: number;
  /** The named heir at the last End Turn, to notice a new naming. */
  named: number | null;
  /** Houses founded by members who left: person id to house id. */
  splits: Record<string, string>;
  /** This quarter's doings, for the news. Older ones are dropped at End Turn. */
  log: PeopleLogEntry[];
}

// ---------------------------------------------------------------- decisions

export interface AnswerFamilyLetterDecision {
  kind: "answer_family_letter";
  letter: number;
  option: string;
}

export interface SendToStudyDecision {
  kind: "send_to_study";
  heir: number;
  path: string;
}

export type PeopleDecision = AnswerFamilyLetterDecision | SendToStudyDecision;
export type PeopleCategory = "family_request" | "split_capital" | "split_deposits" | "claim" | "study";

const KINDS: ReadonlySet<string> = new Set(["answer_family_letter", "send_to_study"]);

// ---------------------------------------------------------------- helpers

export function createPeople(_data: GameData, rng: Rng): PeopleState {
  const stream = createRng(Math.floor(rng.next() * 0x100000000));
  return {
    rng_state: stream.state,
    loyalty: {},
    letters: [],
    next_letter_id: 1,
    last_asked: {},
    feuds: [],
    studies: [],
    studied: {},
    desks: {},
    successions_seen: 0,
    named: null,
    splits: {},
    log: [],
  };
}

/** Runs `fn` with the people system's own stream and stores where it got to. Mutates `state`. */
function withPeopleRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = createRng(state.agendas.rng_state);
  const out = fn(rng);
  state.agendas.rng_state = rng.state;
  return out;
}

/** Fills {name}-style blanks in a text from data/people.json. */
export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

const clamp = (n: number, data: GameData) => Math.min(data.people.loyalty.max, Math.max(data.people.loyalty.min, Math.round(n)));
const round100 = (n: number) => Math.round(n / 100) * 100;
const personById = (state: GameState, id: number) => state.people.find((p) => p.id === id);
const living = (p: Person | undefined): p is Person => !!p && p.death_year === null;

/** Whether a person has a loyalty: living members of the line other than the head, and the head's living spouse. */
export function hasLoyalty(state: GameState, p: Person): boolean {
  if (p.death_year !== null) return false;
  if (p.role === "line") return !p.is_head;
  const head = headOf(state);
  return p.role === "spouse" && !!head && head.spouse === p.id;
}

/** A person's loyalty, 0 to 100: stored, or the starting value for their role. */
export function loyaltyOf(state: GameState, p: Person, data: GameData): number {
  const l = data.people.loyalty;
  return state.agendas.loyalty[p.id] ?? (p.role === "spouse" ? l.start_spouse : l.start_heir);
}

/** Changes a person's loyalty within its bounds. Mutates `state`. */
export function changeLoyalty(state: GameState, id: number, delta: number, data: GameData): void {
  const p = personById(state, id);
  if (!p) return;
  state.agendas.loyalty[id] = clamp(loyaltyOf(state, p, data) + delta, data);
}

export function isLoyal(state: GameState, p: Person, data: GameData): boolean {
  return loyaltyOf(state, p, data) >= data.people.loyalty.loyal;
}

export function isDisloyal(state: GameState, p: Person, data: GameData): boolean {
  return loyaltyOf(state, p, data) <= data.people.loyalty.disloyal;
}

/** Loyalty in a word, for the terminal and the family view. */
export function loyaltyWord(state: GameState, p: Person, data: GameData): string {
  if (isLoyal(state, p, data)) return "loyal";
  if (isDisloyal(state, p, data)) return "disloyal";
  return loyaltyOf(state, p, data) >= data.people.loyalty.drift_to ? "content" : "restless";
}

/** Whether a passed-over heir accepts it (succession then costs no extra reputation). Used by succeed(). */
export function acceptsPassingOver(state: GameState, p: Person, data: GameData): boolean {
  return isLoyal(state, p, data);
}

/** The person's study under way, if any. */
export function studyOf(state: GameState, id: number): Study | undefined {
  return state.agendas.studies.find((s) => s.person === id);
}

export const studyData = (id: string, data: GameData) => data.people.studies.find((s) => s.id === id);
export const agendaData = (id: AgendaId, data: GameData) => data.people.agendas.find((a) => a.id === id)!;

const feudOf = (state: GameState, id: number) => state.agendas.feuds.find((f) => f.person === id);

function log(state: GameState, text: string, title?: string): void {
  state.agendas.log.push(title ? { turn: state.world.turn, title, text } : { turn: state.world.turn, text });
}

// ---------------------------------------------------------------- letters: what can be answered

export interface FamilyOption {
  id: string;
  label: string;
  /** Cash it takes at once. */
  cost: number;
}

export const DEFAULT_OPTION: Record<FamilyLetterKind, string> = { request: "refuse", leaving: "forbid", claim: "refuse", reconcile: "refuse" };

/** The responses to a family letter, with their certain costs. */
export function familyOptions(letter: FamilyLetter, data: GameData): FamilyOption[] {
  const p = data.people;
  switch (letter.kind) {
    case "request": {
      const a = agendaData(letter.agenda!, data);
      return [
        { id: "grant", label: "Grant it", cost: a.cost ?? 0 },
        { id: "refuse", label: "Refuse", cost: 0 },
      ];
    }
    case "leaving":
      return [
        { id: "buy_off", label: "Buy them off", cost: p.split.buy_off },
        { id: "let_go", label: "Let them go", cost: 0 },
        { id: "forbid", label: "Forbid it", cost: 0 },
      ];
    case "claim":
      return [
        { id: "pay", label: "Pay the claim", cost: letter.amount },
        { id: "law", label: "Go to law", cost: p.claims.law_cost },
        { id: "refuse", label: "Refuse", cost: 0 },
      ];
    case "reconcile":
      return [
        { id: "pay", label: "Accept the terms", cost: letter.amount },
        { id: "refuse", label: "Refuse", cost: 0 },
      ];
  }
}

/** A letter's title and text, filled in. */
export function letterWords(state: GameState, letter: FamilyLetter, data: GameData): { title: string; text: string } {
  const p = data.people;
  const vars = letterVars(state, letter, data);
  const src =
    letter.kind === "request" ? agendaData(letter.agenda!, data) : letter.kind === "leaving" ? p.split : letter.kind === "claim" ? p.claims : p.feuds;
  return { title: fill(src.title, vars), text: fill(src.text, vars) };
}

function letterVars(state: GameState, letter: FamilyLetter, data: GameData): Record<string, string> {
  const who = personById(state, letter.person);
  const member = letter.member === null ? undefined : personById(state, letter.member);
  const house = letter.house === "merchant" ? "a merchant family" : state.houses.find((h) => h.id === letter.house)?.name;
  const feud = feudOf(state, letter.person);
  const head = personById(state, feud?.head ?? headOf(state)?.id ?? -1);
  const a = letter.agenda ? agendaData(letter.agenda, data) : undefined;
  return {
    name: who?.name ?? "A member of the family",
    member: member?.name ?? "",
    house: house ?? "",
    head: head?.name ?? "the head",
    amount: fl(letter.amount),
    cost: fl(a?.cost ?? 0),
    payout: fl(a?.payout ?? 0),
  };
}

/** The match a "match" letter proposes now, as a marriage decision. */
function matchDecision(letter: FamilyLetter): Decision {
  return { kind: "arrange_marriage", member: letter.member!, with: letter.house!, form: "in" };
}

/** Desks free next quarter for a family clerk. */
function deskFree(state: GameState, data: GameData): boolean {
  const size = state.counting.room_building?.size ?? state.counting.room;
  return desksTaken(state, data) < roomData(size, data).desks;
}

/** Returns why a response can't be chosen, or null if it can. Uses no capacity (a match takes the head's time, as any marriage). */
export function checkAnswerFamilyLetter(state: GameState, d: AnswerFamilyLetterDecision, data: GameData): string | null {
  const over = runOver(state, data.tuning);
  if (over) return over === "bankrupt" ? "The house is bankrupt" : "The run is over";
  const letter = state.agendas.letters.find((l) => l.id === d.letter);
  if (!letter) return `No family letter #${d.letter} awaits an answer`;
  if (letter.answer !== null) return "That letter has already been answered";
  const option = familyOptions(letter, data).find((o) => o.id === d.option);
  if (!option) return `No response "${d.option}" to that letter`;
  const who = personById(state, letter.person);
  if (!living(who)) return "The writer is no longer living";
  if (option.cost > freeCash(state)) return `Not enough cash above the reserve (cost ${fl(option.cost)}, free ${fl(freeCash(state))})`;
  if (letter.kind === "request" && d.option === "grant") {
    if (letter.agenda === "match") {
      const why = checkMarriage(state, matchDecision(letter) as Parameters<typeof checkMarriage>[1], data);
      if (why) return why;
    }
    if (letter.agenda === "desk") {
      if (who.role !== "line" || who.is_head) return `${who.name} can no longer take a desk`;
      if (!deskFree(state, data)) return "No desk free in the counting room: build a larger room";
    }
  }
  return null;
}

/** Answers a family letter: its certain effects apply now. Returns a new state; the input is not changed. */
export function answerFamilyLetter(state: GameState, d: AnswerFamilyLetterDecision, data: GameData): DecisionResult {
  const reason = checkAnswerFamilyLetter(state, d, data);
  if (reason) return { ok: false, reason };
  let next = cloneState(state);
  if (d.option === "grant") {
    const letter = next.agendas.letters.find((l) => l.id === d.letter)!;
    if (letter.agenda === "match") {
      const r = arrangeMarriage(next, matchDecision(letter) as Parameters<typeof arrangeMarriage>[1], data);
      if (!r.ok) return r;
      next = r.state;
    }
  }
  const letter = next.agendas.letters.find((l) => l.id === d.letter)!;
  letter.answer = d.option;
  applyCertain(next, letter, data);
  return { ok: true, state: next };
}

/** A response's certain effects. The match itself is made by answerFamilyLetter. Mutates `state`. */
function applyCertain(state: GameState, letter: FamilyLetter, data: GameData): void {
  const p = data.people;
  const who = personById(state, letter.person)!;
  const vars = letterVars(state, letter, data);
  const pay = (amount: number, category: PeopleCategory, note: string) => {
    if (amount <= 0) return;
    state.house.cash -= amount;
    addEntry(state, "cash", category, -amount, note);
  };
  const { title } = letterWords(state, letter, data);
  switch (letter.kind) {
    case "request": {
      const a = agendaData(letter.agenda!, data);
      if (letter.answer === "grant") {
        pay(a.cost ?? 0, "family_request", `${who.name}: ${a.id}`);
        if (a.reputation) state.house.reputation = Math.min(100, state.house.reputation + reputationGain(a.reputation, state, data));
        if (a.id === "desk") addFamilyClerk(state, who, data);
        changeLoyalty(state, who.id, p.loyalty.grant, data);
        log(state, fill(a.grant_text, vars), title);
      } else {
        changeLoyalty(state, who.id, -p.loyalty.refuse, data);
        log(state, fill(a.refuse_text, vars), title);
      }
      return;
    }
    case "leaving":
      if (letter.answer === "buy_off") {
        pay(p.split.buy_off, "family_request", `${who.name} persuaded to stay`);
        changeLoyalty(state, who.id, p.split.buy_off_loyalty, data);
        log(state, fill(p.split.buy_off_text, vars), title);
      } else if (letter.answer === "let_go") splitOff(state, who, data);
      return;
    case "claim":
      if (letter.answer === "pay") {
        pay(letter.amount, "claim", `${who.name}'s claim on the house`);
        state.agendas.loyalty[who.id] = clamp(p.loyalty.after_claim_paid, data);
        log(state, fill(p.claims.pay_text, vars), title);
      } else if (letter.answer === "law") {
        pay(p.claims.law_cost, "claim", `Lawyers against ${who.name}'s claim`);
      } else {
        changeLoyalty(state, who.id, -p.loyalty.refuse, data);
        const head = headOf(state);
        if (head && !feudOf(state, who.id)) state.agendas.feuds.push({ person: who.id, head: head.id, since: state.world.turn });
        log(state, fill(p.claims.refuse_text, vars), title);
      }
      return;
    case "reconcile":
      if (letter.answer === "pay") {
        pay(letter.amount, "claim", `Terms with ${who.name}`);
        state.agendas.feuds = state.agendas.feuds.filter((f) => f.person !== who.id);
        changeLoyalty(state, who.id, p.loyalty.grant, data);
        log(state, fill(p.feuds.pay_text, vars), title);
      } else log(state, fill(p.feuds.refuse_text, vars), title);
      return;
  }
}

/** What draws on the RNG: a venture's luck, a forbidden heir's choice, the court. One roll each. Mutates `state`. */
function applyUncertain(state: GameState, letter: FamilyLetter, rng: Rng, data: GameData): void {
  const p = data.people;
  const who = personById(state, letter.person)!;
  const vars = letterVars(state, letter, data);
  const { title } = letterWords(state, letter, data);
  if (letter.kind === "request" && letter.agenda === "venture" && letter.answer === "grant") {
    const a = agendaData("venture", data);
    if (rng.next() < (a.chance ?? 0)) {
      state.house.cash += a.payout ?? 0;
      addEntry(state, "cash", "family_request", a.payout ?? 0, `${who.name}'s venture pays`);
      log(state, fill(a.won_text ?? "", vars), title);
    } else log(state, fill(a.lost_text ?? "", vars), title);
  } else if (letter.kind === "leaving" && letter.answer === "forbid") {
    if (rng.next() < p.split.forbid_stay) {
      changeLoyalty(state, who.id, -p.split.forbid_loyalty, data);
      log(state, fill(p.split.stay_text, vars), title);
    } else splitOff(state, who, data);
  } else if (letter.kind === "claim" && letter.answer === "law") {
    if (rng.next() < p.claims.law_win) {
      state.house.reputation = Math.max(0, state.house.reputation - p.claims.law_reputation);
      changeLoyalty(state, who.id, -p.claims.law_loyalty, data);
      log(state, fill(p.claims.law_won_text, vars), title);
    } else {
      const half = Math.min(round100(letter.amount / 2), Math.max(0, state.house.cash));
      if (half > 0) {
        state.house.cash -= half;
        addEntry(state, "cash", "claim", -half, `${who.name}'s claim, by order of the court`);
      }
      state.agendas.loyalty[who.id] = clamp(p.loyalty.after_claim_paid, data);
      log(state, fill(p.claims.law_lost_text, { ...vars, amount: fl(half) }), title);
    }
  }
}

/**
 * Settles every family letter at End Turn, in arrival order. One whose writer has died or left is
 * dropped. An unanswered one takes its default, certain effects included; then the uncertain
 * effects roll. Clears the letters. Mutates `state`.
 */
function settleFamilyLetters(state: GameState, rng: Rng, data: GameData): void {
  for (const letter of state.agendas.letters) {
    const who = personById(state, letter.person);
    if (!living(who) || !hasLoyalty(state, who)) continue;
    if (letter.answer === null) {
      letter.answer = DEFAULT_OPTION[letter.kind];
      applyCertain(state, letter, data);
    }
    if (who.role === "left") continue;
    applyUncertain(state, letter, rng, data);
  }
  state.agendas.letters = [];
}

function newLetter(state: GameState, kind: FamilyLetterKind, person: number, extra: Partial<FamilyLetter> = {}): FamilyLetter {
  const letter: FamilyLetter = {
    id: state.agendas.next_letter_id++, kind, agenda: null, person, turn: state.world.turn, amount: 0, member: null, house: null, answer: null, ...extra,
  };
  state.agendas.letters.push(letter);
  return letter;
}

// ---------------------------------------------------------------- family clerks

function addFamilyClerk(state: GameState, p: Person, data: GameData): void {
  const c = state.counting;
  const trait = p.traits.map((t) => data.people.desk_traits[t]).find((t) => t !== undefined) ?? data.people.desk_trait_default;
  const id = c.next_staff_id++;
  const skill = Math.min(10, Math.max(1, effectiveStat(p, "acumen", data)));
  c.staff.push({ name: p.name, skill, trait, id, role: "clerk", hired_turn: state.world.turn, start_turn: state.world.turn + 1, leaving: false });
  state.agendas.desks[p.id] = id;
}

/** A family clerk who died, left, or became head leaves the desk; one dismissed is forgotten. Mutates `state`. */
function tendDesks(state: GameState): void {
  for (const [pid, sid] of Object.entries(state.agendas.desks)) {
    const p = personById(state, Number(pid));
    const staff = state.counting.staff.find((m) => m.id === sid);
    if (!staff) {
      delete state.agendas.desks[pid];
      continue;
    }
    if (!living(p) || p.role !== "line" || p.is_head) {
      staff.leaving = true;
      delete state.agendas.desks[pid];
    }
  }
}

// ---------------------------------------------------------------- splitting off

/** What a member leaving now would take: capital, and deposits that follow them. */
export function splitTerms(state: GameState, data: GameData): { capital: number; deposits: number } {
  const s = data.people.split;
  // A share of the house's own capital (net worth), not of its cash, most of which is depositors' money.
  const cash = Math.max(0, state.house.cash);
  const capital = Math.min(s.capital_max, cash, round100(Math.max(0, netWorth(state)) * s.capital_share));
  const deposits = Math.min(round100(Math.max(0, state.house.deposits) * s.deposit_share), Math.max(0, cash - capital));
  return { capital, deposits };
}

/**
 * A member leaves to found a rival house: they take capital, some depositors follow, the house's
 * name suffers, and a new house opens, hostile (more so after a feud). Their spouse and children
 * under age go with them. Draws nothing. Mutates `state`.
 */
export function splitOff(state: GameState, p: Person, data: GameData): OtherHouse {
  const s = data.people.split;
  const surname = data.family.surname;
  const { capital, deposits } = splitTerms(state, data);
  const feud = feudOf(state, p.id);
  const used = new Set(state.houses.flatMap((x) => [x.head.name, x.heir.name]).concat(state.people.map((x) => x.name)));
  const first = data.houses.heir_names.find((n) => !used.has(`${n} ${surname}`)) ?? data.houses.heir_names[0]!;
  const connections = effectiveStat(p, "connections", data);
  const house: OtherHouse = {
    id: `split_${p.id}`,
    name: `${p.name} & Co.`,
    surname,
    temperament: p.traits.some((t) => s.bold_traits.includes(t)) ? "bold" : "cautious",
    head: { name: p.name, birth_year: p.birth_year },
    heir: { name: `${first} ${surname}`, birth_year: Math.min(state.world.year - 1, p.birth_year + 25) },
    wealth: Math.max(1, capital),
    start_wealth: Math.max(1, capital),
    reputation: Math.min(100, s.reputation_base + s.reputation_per_connection * connections),
    opinion: feud ? s.feud_opinion : s.opinion,
    baseline: s.baseline,
    failed_turn: null,
  };
  state.houses.push(house);
  state.agendas.splits[p.id] = house.id;

  if (capital > 0) {
    state.house.cash -= capital;
    addEntry(state, "cash", "split_capital", -capital, `${p.name} takes capital to found ${house.name}`);
  }
  if (deposits > 0) {
    state.house.cash -= deposits;
    state.house.deposits -= deposits;
    const note = `Depositors follow ${p.name} to ${house.name}`;
    addEntry(state, "cash", "split_deposits", -deposits, note);
    addEntry(state, "deposits", "split_deposits", -deposits, note);
  }
  state.house.reputation = Math.max(0, state.house.reputation - s.reputation);

  const going = [p, livingSpouse(state, p), ...state.people.filter((c) => c.parents.includes(p.id) && c.death_year === null && ageIn(c, state.world.year) < data.tuning.family.succession.adult_age)];
  for (const x of going) {
    if (!x || x.role === "left") continue;
    x.role = "left";
    x.origin = house.id;
    delete state.agendas.loyalty[x.id];
    if (state.house.designated_heir === x.id) state.house.designated_heir = null;
    state.agendas.studies = state.agendas.studies.filter((st) => st.person !== x.id);
    state.agendas.feuds = state.agendas.feuds.filter((f) => f.person !== x.id);
  }
  log(state, fill(s.leave_text, { name: p.name, house: house.name, capital: fl(capital), deposits: fl(deposits) }));
  return house;
}

// ---------------------------------------------------------------- claims and feuds

/** What a claim asks now: a share of the house's net worth (its own capital, not depositors' cash), capped. */
export function claimAmount(state: GameState, data: GameData): number {
  const c = data.people.claims;
  return Math.min(c.max, round100(Math.max(0, netWorth(state)) * c.share));
}

/**
 * After each new succession: feuds with the dead head end; each adult heir older than the new head
 * who is not loyal writes a claim. Draws nothing. Mutates `state`.
 */
function claimsAtSuccession(state: GameState, data: GameData): void {
  const list = state.successions.slice(state.agendas.successions_seen);
  state.agendas.successions_seen = state.successions.length;
  if (!list.length) return;
  const head = headOf(state);
  for (const f of state.agendas.feuds.filter((x) => x.head !== head?.id)) {
    const who = personById(state, f.person);
    const was = personById(state, f.head);
    if (who) log(state, fill(data.people.feuds.ended_death_text, { name: who.name, head: was?.name ?? "the head" }));
  }
  state.agendas.feuds = state.agendas.feuds.filter((x) => x.head === head?.id);
  if (!head) return;
  const adult = data.tuning.family.succession.adult_age;
  for (const p of heirsOf(state)) {
    if (p.birth_year >= head.birth_year || ageIn(p, state.world.year) < adult) continue;
    if (isLoyal(state, p, data)) continue;
    newLetter(state, "claim", p.id, { amount: claimAmount(state, data) });
  }
}

/** A feud that has run max_quarters dies out on its own. Draws nothing. Mutates `state`. */
function coolFeuds(state: GameState, data: GameData): void {
  const max = data.people.feuds.max_quarters;
  for (const f of state.agendas.feuds.filter((x) => state.world.turn - x.since >= max)) {
    const who = personById(state, f.person);
    if (who) log(state, fill(data.people.feuds.cooled_text, { name: who.name, head: personById(state, f.head)?.name ?? "the head" }));
  }
  state.agendas.feuds = state.agendas.feuds.filter((x) => state.world.turn - x.since < max);
}

/** Naming a younger heir over older adult heirs costs their loyalty. Draws nothing. Mutates `state`. */
function noticeNaming(state: GameState, data: GameData): void {
  const named = state.house.designated_heir;
  if (named !== null && named !== state.agendas.named) {
    const heir = personById(state, named);
    const adult = data.tuning.family.succession.adult_age;
    if (heir) {
      for (const p of heirsOf(state)) {
        if (p.id !== heir.id && p.birth_year < heir.birth_year && ageIn(p, state.world.year) >= adult) {
          changeLoyalty(state, p.id, -data.people.loyalty.passed_over_by_naming, data);
        }
      }
    }
  }
  state.agendas.named = named;
}

// ---------------------------------------------------------------- requests

/** Who could ask for what now, with the match's member and house filled in. */
export function eligibleRequests(state: GameState, data: GameData): { person: Person; agenda: AgendaData; member: number | null; house: string | null }[] {
  const P = data.people;
  const { year, turn } = state.world;
  const adult = data.tuning.family.succession.adult_age;
  const asking = new Set(state.agendas.letters.filter((l) => l.kind === "request").map((l) => l.person));
  const rested = (p: Person) => {
    const last = state.agendas.last_asked[p.id];
    return last === undefined || turn - last >= P.requests.cooldown_quarters;
  };
  const out: ReturnType<typeof eligibleRequests> = [];
  for (const p of state.people) {
    if (!hasLoyalty(state, p) || asking.has(p.id) || !rested(p) || studyOf(state, p.id) || feudOf(state, p.id)) continue;
    if (ageIn(p, year) < P.requests.min_age) continue;
    for (const a of P.agendas) {
      let ok = false;
      let member: number | null = null;
      let house: string | null = null;
      switch (a.id) {
        case "venture":
          ok = p.traits.some((t) => P.agenda_traits.venture.includes(t));
          break;
        case "charity":
          ok = p.traits.some((t) => P.agenda_traits.charity.includes(t));
          break;
        case "allowance":
          ok = !!a.trait && p.traits.includes(a.trait);
          break;
        case "desk":
          ok = p.role === "line" && ageIn(p, year) >= adult && state.agendas.desks[p.id] === undefined &&
            ((!!a.trait && p.traits.includes(a.trait)) || p.acumen >= (a.min_acumen ?? 99));
          break;
        case "match": {
          if (p.role !== "spouse") break;
          const m = marriageable(state, data).find((x) => !x.is_head && !studyOf(state, x.id));
          if (!m) break;
          const min = data.tuning.family.marriage.in.min_opinion;
          const h = [...tradingHouses(state)].filter((x) => x.opinion >= min).sort((x, y) => y.opinion - x.opinion || x.id.localeCompare(y.id))[0];
          ok = true;
          member = m.id;
          house = h ? h.id : "merchant";
          break;
        }
      }
      if (ok) out.push({ person: p, agenda: a, member, house });
    }
  }
  return out;
}

/** One roll for whether someone asks this quarter (none while a request is open), then one to pick who and what by weight. Mutates `state`. */
function maybeRequest(state: GameState, rng: Rng, data: GameData): void {
  if (rng.next() >= data.people.requests.chance) return;
  const list = eligibleRequests(state, data);
  if (!list.length) return;
  const total = list.reduce((s, x) => s + x.agenda.weight, 0);
  let r = rng.next() * total;
  const pick = list.find((x) => (r -= x.agenda.weight) < 0) ?? list[list.length - 1]!;
  state.agendas.last_asked[pick.person.id] = state.world.turn;
  newLetter(state, "request", pick.person.id, { agenda: pick.agenda.id, member: pick.member, house: pick.house });
}

// ---------------------------------------------------------------- year end

/** Members who might leave: adult heirs, not the named heir, not away studying. */
function mightLeave(state: GameState, data: GameData): Person[] {
  const adult = data.tuning.family.succession.adult_age;
  return heirsOf(state).filter((p) => ageIn(p, state.world.year) >= adult && state.house.designated_heir !== p.id && !studyOf(state, p.id));
}

/**
 * Year end: loyalty drifts toward its middle; each disloyal adult heir (or one in a feud) rolls
 * once to write that they mean to leave; each feud offers terms. Mutates `state`.
 */
function yearEnd(state: GameState, rng: Rng, data: GameData): void {
  const l = data.people.loyalty;
  for (const p of state.people) {
    if (!hasLoyalty(state, p)) continue;
    const v = loyaltyOf(state, p, data);
    const step = Math.min(l.drift_per_year, Math.abs(l.drift_to - v));
    state.agendas.loyalty[p.id] = clamp(v + Math.sign(l.drift_to - v) * step, data);
  }
  for (const p of mightLeave(state, data)) {
    const feud = !!feudOf(state, p.id);
    if (!feud && !isDisloyal(state, p, data)) continue;
    if (rng.next() < (feud ? data.people.split.feud_chance : data.people.split.chance)) newLetter(state, "leaving", p.id);
  }
  for (const f of state.agendas.feuds) {
    const amount = round100(Math.max(0, netWorth(state)) * data.people.feuds.reconcile_share);
    newLetter(state, "reconcile", f.person, { amount });
  }
}

// ---------------------------------------------------------------- education paths

/** Returns why a send_to_study decision is invalid, or null if it can go ahead. */
export function checkSendToStudy(state: GameState, d: SendToStudyDecision, data: GameData): string | null {
  const noAction = checkCapacity(state, "send_to_study", data.tuning);
  if (noAction) return noAction;
  const path = studyData(d.path, data);
  if (!path) return `Unknown path "${d.path}"`;
  const heir = heirsOf(state).find((p) => p.id === d.heir);
  if (!heir) return `No living heir #${d.heir}`;
  const age = ageIn(heir, state.world.year);
  if (age < path.min_age || age > path.max_age) return `${heir.name} is ${age}; ${path.name.toLowerCase()} takes those aged ${path.min_age} to ${path.max_age}`;
  if (studyOf(state, heir.id)) return `${heir.name} is already away studying`;
  if (state.agendas.studied[heir.id]?.includes(path.id)) return `${heir.name} has already had ${path.name.toLowerCase()}`;
  if (path.cost > freeCash(state)) return `Not enough cash above the reserve (cost ${fl(path.cost)}, free ${fl(freeCash(state))})`;
  return null;
}

/** Sends an heir on an education path, paid in full now; they come back changed when it ends. Returns a new state. */
export function sendToStudy(state: GameState, d: SendToStudyDecision, data: GameData): DecisionResult {
  const reason = checkSendToStudy(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const path = studyData(d.path, data)!;
  const heir = personById(next, d.heir)!;
  if (path.cost > 0) {
    next.house.cash -= path.cost;
    addEntry(next, "cash", "study", -path.cost, `${heir.name}: ${path.name.toLowerCase()}`);
  }
  next.agendas.studies.push({ person: heir.id, path: path.id, start: next.world.turn, until: next.world.turn + path.quarters });
  next.agendas.studied[heir.id] = [...(next.agendas.studied[heir.id] ?? []), path.id];
  useCapacity(next, "send_to_study", data.tuning);
  log(next, fill(path.start_text, { name: heir.name }));
  return { ok: true, state: next };
}

/**
 * Studies that end this quarter: the heir comes back with the path's gains, a roll for its trait
 * (if it has one and the trait is open), and a roll for the house a classmate belongs to (if it has
 * a contact). An heir who has become head comes back at once with half the gains, rounded down,
 * and no trait or contact. Mutates `state`.
 */
function resolveStudies(state: GameState, rng: Rng, data: GameData): void {
  const max = data.tuning.family.max_stat;
  const keep: Study[] = [];
  for (const st of state.agendas.studies) {
    const p = personById(state, st.person);
    const path = studyData(st.path, data);
    if (!living(p) || p.role !== "line" || !path) continue;
    const early = p.is_head;
    if (!early && state.world.turn + 1 < st.until) {
      keep.push(st);
      continue;
    }
    for (const stat of STATS) {
      const g = path.gains[stat] ?? 0;
      p[stat] = Math.min(max, p[stat] + (early ? Math.floor(g / 2) : g));
    }
    if (!early) {
      if (path.trait && path.trait_chance && rng.next() < path.trait_chance && openTraits(p.traits, data).some((t) => t.id === path.trait)) p.traits.push(path.trait);
      const houses = tradingHouses(state);
      if (path.contact_opinion && houses.length) changeOpinion(state, houses[Math.floor(rng.next() * houses.length)]!.id, path.contact_opinion, data.tuning);
      changeLoyalty(state, p.id, path.loyalty, data);
    }
    log(state, fill(path.return_text, { name: p.name }));
  }
  state.agendas.studies = keep;
}

// ---------------------------------------------------------------- End Turn

/**
 * The system's End Turn step, after the family's quarter. In order: settle family letters; bring
 * back heirs whose studies end; tend family clerks; a new naming costs older heirs' loyalty; claims
 * after a succession; each feud costs reputation; at year end, drift, letters from those who mean
 * to leave, and terms for each feud; then perhaps a request. With `enabled` false only studies and
 * clerks are tended. Mutates `state`.
 */
export function resolvePeople(state: GameState, _rng: Rng, data: GameData): void {
  // The log holds only this quarter's doings (the news reads them); older ones are dropped.
  state.agendas.log = state.agendas.log.filter((e) => e.turn >= state.world.turn);
  withPeopleRng(state, (rng) => {
    resolveStudies(state, rng, data);
    tendDesks(state);
    if (!data.people.enabled) {
      state.agendas.successions_seen = state.successions.length;
      state.agendas.named = state.house.designated_heir;
      return;
    }
    settleFamilyLetters(state, rng, data);
    tendDesks(state);
    noticeNaming(state, data);
    claimsAtSuccession(state, data);
    coolFeuds(state, data);
    const feuds = state.agendas.feuds.length;
    if (feuds) state.house.reputation = Math.max(0, state.house.reputation - feuds * data.people.feuds.reputation_per_quarter);
    if (state.world.quarter === 4) yearEnd(state, rng, data);
    maybeRequest(state, rng, data);
  });
}

// ---------------------------------------------------------------- routing

export const isPeopleDecision = (d: Decision): d is PeopleDecision => KINDS.has(d.kind);

export function applyPeopleDecision(state: GameState, d: PeopleDecision, data: GameData): DecisionResult {
  return d.kind === "answer_family_letter" ? answerFamilyLetter(state, d, data) : sendToStudy(state, d, data);
}

export function describePeopleDecision(d: PeopleDecision, state: GameState, data: GameData): string {
  if (d.kind === "send_to_study") {
    const heir = personById(state, d.heir);
    return `Send ${heir?.name ?? `#${d.heir}`} to ${studyData(d.path, data)?.name.toLowerCase() ?? d.path}`;
  }
  const letter = state.agendas.letters.find((l) => l.id === d.letter);
  const opt = letter && familyOptions(letter, data).find((o) => o.id === d.option);
  return letter ? `${letterWords(state, letter, data).title}: ${opt?.label.toLowerCase() ?? d.option}` : `Answer family letter #${d.letter}`;
}

/** Problems with data/people.json, as readable lines. */
export function checkPeopleData(data: GameData): string[] {
  const P = data.people;
  const problems: string[] = [];
  const traitIds = new Set(data.traits.map((t) => t.id));
  const ids: AgendaId[] = ["venture", "charity", "match", "desk", "allowance"];
  for (const id of ids) if (!P.agendas.some((a) => a.id === id)) problems.push(`agenda ${id}: missing`);
  for (const t of [...P.agenda_traits.venture, ...P.agenda_traits.charity, ...P.split.bold_traits, ...Object.keys(P.desk_traits)]) {
    if (!traitIds.has(t)) problems.push(`unknown trait "${t}"`);
  }
  for (const a of P.agendas) if (a.trait && !traitIds.has(a.trait)) problems.push(`agenda ${a.id}: unknown trait "${a.trait}"`);
  for (const s of P.studies) {
    if (s.trait && !traitIds.has(s.trait)) problems.push(`study ${s.id}: unknown trait "${s.trait}"`);
    if (!(s.quarters >= 1) || !(s.min_age <= s.max_age)) problems.push(`study ${s.id}: needs quarters >= 1 and min_age <= max_age`);
  }
  const staffTraits = new Set(data.counting.traits.map((t) => t.id));
  for (const t of [...Object.values(P.desk_traits), P.desk_trait_default]) if (!staffTraits.has(t)) problems.push(`unknown staff trait "${t}"`);
  if (/[—–]/.test(JSON.stringify(P))) problems.push("uses a dash; the writing style forbids em dashes");
  return problems;
}
