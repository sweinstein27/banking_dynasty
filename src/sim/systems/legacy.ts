// B3, legacy: ambitions each era, titles granted by a sovereign the house has served, and a
// prestige score across five pillars (wealth, standing, family, influence, legacy). The family
// tree view comes in wave 4. Legacy reads other systems only through their exported functions and
// state; the only things it changes are the house's reputation and cash (title fees), and the news.
import type { DecisionResult } from "../actions";
import { runOver } from "../actions";
import { checkCapacity, useCapacity } from "../capacity";
import { headOf, headStat, heirsOf, isTrained, successor } from "../family";
import { fl } from "../format";
import { houseRanking } from "../houses";
import { addEntry } from "../ledger";
import { allies } from "../marriages";
import { freeCash } from "../reserves";
import { createRng, type Rng, type SeededRng } from "../rng";
import { cloneState } from "../state";
import type { GameData, Tuning } from "../tuning";
import { netWorth } from "../turn";
import type { Decision, GameState } from "../types";

// ---------------------------------------------------------------- types

export type AmbitionKind = "state_loan" | "net_worth" | "standing" | "first_house" | "alliance" | "trained_heir" | "branch" | "railway" | "title";

export interface AmbitionDef {
  id: string;
  kind: AmbitionKind;
  /** Era indices (into `eras`) in which it may be offered. */
  eras: number[];
  /** The number to reach: a count, gulden, reputation, or a title rank. */
  target: number;
  /** A public ambition is known on the bourse: missing it costs reputation. */
  public: boolean;
  reward_reputation: number;
  miss_reputation: number;
  /** Points on the legacy pillar once met. */
  legacy: number;
  /** "{target}" is filled in. */
  text: string;
}

export interface TitleDef {
  rank: number;
  id: "von" | "freiherr";
  name: string;
  /** The fee (Taxe) paid with the petition, returned if it is refused. */
  fee: number;
  min_net_worth: number;
  min_reputation: number;
  /** Services to the granting state needed (loan contracts won, plus one for a large holding of its bonds). */
  service: number;
  /** Years the rank below must have been held. */
  after_years: number;
  /** Reputation gained on the grant. */
  reputation: number;
  /** Points on the legacy pillar while held. */
  legacy: number;
}

export interface GrantorDef {
  /** Id from data/states.json. */
  state: string;
  /** Added to every title's min_reputation for this sovereign. */
  reputation_extra: number;
  /** Chance a sound petition is granted, before the head's Connections. */
  chance: number;
}

/** data/legacy.json */
export interface LegacyData {
  /** False turns the system off: no offers, no rolls. Prestige is still computed. */
  enabled: boolean;
  eras: { name: string; from: number; to: number }[];
  /** Ambitions offered at the start of each era. */
  offers: number;
  /** Quarters from an era's start in which one may be chosen. */
  choose_quarters: number;
  ambitions: AmbitionDef[];
  titles: TitleDef[];
  grantors: GrantorDef[];
  petition: {
    /** Added to the grant chance per point of the head's Connections above neutral (taken off below). */
    connections_step: number;
    /** Quarters a refused house must wait before petitioning again. */
    refused_quarters: number;
    /** Face value of a state's bonds that counts as one service to it. */
    bond_face: number;
  };
  prestige: {
    /** Net worth at `floor` scores 0, at `top` 100, on a log scale. */
    wealth: { floor: number; top: number };
    /** Weights on reputation and on rank among the Frankfurt houses (first 100, last 0). */
    standing: { reputation: number; rank: number };
    family: { per_heir: number; max_heirs: number; trained_successor: number; per_ally: number; max_allies: number };
    legacy: { per_listed: number; max_listed: number };
  };
}

/** One era's chosen ambition. */
export interface AmbitionRecord {
  era: number;
  id: string;
  chosen_turn: number;
  status: "open" | "met" | "missed";
  /** The turn it was met or missed, or null while open. */
  settled_turn: number | null;
}

export interface TitleGrant {
  rank: number;
  /** The granting state's id. */
  grantor: string;
  turn: number;
}

export interface Petition {
  rank: number;
  grantor: string;
  /** The fee paid, returned on a refusal. */
  fee: number;
  turn: number;
}

/** One year end's prestige, for the chronicle, the harness and the family tree view. */
export interface PrestigeYear extends Pillars {
  year: number;
  total: number;
}

/** state.legacy */
export interface LegacyState {
  /** Mulberry32 state of legacy's own random stream. */
  rng_state: number;
  /** The era `offers` belong to, or -1 before any were drawn. */
  offers_era: number;
  /** Ambition ids offered for that era. */
  offers: string[];
  /** Chosen ambitions, oldest first, at most one per era. */
  ambitions: AmbitionRecord[];
  /** Titles granted, lowest first. The house holds the last one. */
  titles: TitleGrant[];
  /** A petition awaiting the sovereign's answer at End Turn, or null. */
  petition: Petition | null;
  /** No petition before this turn (after a refusal). */
  petition_after: number;
  /** Prestige at each year end. */
  history: PrestigeYear[];
}

export interface ChooseAmbitionDecision {
  kind: "choose_ambition";
  ambition: string;
}

export interface PetitionTitleDecision {
  kind: "petition_title";
  /** The rank asked for: 1 "von", 2 Freiherr. */
  rank: number;
  /** Id from data/states.json of the sovereign petitioned. */
  grantor: string;
}

export type LegacyDecision = ChooseAmbitionDecision | PetitionTitleDecision;
/** title_fee: the fee paid with a petition (negative) and returned on a refusal (positive). */
export type LegacyCategory = "title_fee";
/** Legacy holds nothing counted in net worth. */
export type LegacyAccount = never;

export type Pillar = "wealth" | "standing" | "family" | "influence" | "legacy";
export const PILLARS: Pillar[] = ["wealth", "standing", "family", "influence", "legacy"];
export type Pillars = Record<Pillar, number>;

// ---------------------------------------------------------------- calendar and rng

/** The turn of a year's first quarter (turn 1 is the start quarter). */
export function turnOfYear(year: number, tuning: Tuning): number {
  return year * 4 - (tuning.start.year * 4 + tuning.start.quarter - 1) + 1;
}

/** The era index a year falls in, or -1 outside every era. */
export function eraOf(year: number, data: GameData): number {
  return data.legacy.eras.findIndex((e) => year >= e.from && year <= e.to);
}

/** Runs `fn` with legacy's own random stream and stores where it got to, so legacy shifts no other system's rolls. Mutates `state`. */
function withLegacyRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = createRng(state.legacy.rng_state);
  const out = fn(rng);
  state.legacy.rng_state = rng.state;
  return out;
}

function news(state: GameState, text: string, title?: string): void {
  state.news.push({ turn: state.world.turn, kind: "family", text, ...(title ? { title } : {}) });
}

const changeReputation = (state: GameState, delta: number) => {
  state.house.reputation = Math.min(100, Math.max(0, state.house.reputation + delta));
};

// ---------------------------------------------------------------- start

/**
 * Legacy's starting state, with the first era's offers drawn. Its random stream is seeded from where
 * the run's RNG stands, without drawing from it, so adding legacy shifts no other system's rolls.
 */
export function createLegacy(data: GameData, rng: Rng): LegacyState {
  const seed = ((rng as Partial<SeededRng>).state ?? Math.floor(rng.next() * 0x100000000)) ^ 0x1e9ac7b3;
  const legacy: LegacyState = {
    rng_state: createRng(seed >>> 0).state,
    offers_era: -1,
    offers: [],
    ambitions: [],
    titles: [],
    petition: null,
    petition_after: 0,
    history: [],
  };
  if (!data.legacy.enabled) return legacy;
  const era = eraOf(data.tuning.start.year, data);
  if (era < 0) return legacy;
  const r = createRng(legacy.rng_state);
  legacy.offers = drawOffers(data.legacy.ambitions.filter((a) => a.eras.includes(era) && a.kind !== "title"), data.legacy.offers, r);
  legacy.offers_era = era;
  legacy.rng_state = r.state;
  return legacy;
}

/** Up to `n` ids picked at random from `pool`, in data order. One roll per pick. */
export function drawOffers(pool: AmbitionDef[], n: number, rng: Rng): string[] {
  const left = [...pool];
  const picked: AmbitionDef[] = [];
  while (picked.length < n && left.length) picked.push(left.splice(Math.floor(rng.next() * left.length), 1)[0]!);
  return pool.filter((a) => picked.includes(a)).map((a) => a.id);
}

// ---------------------------------------------------------------- ambitions

export const ambitionDef = (id: string, data: GameData) => data.legacy.ambitions.find((a) => a.id === id);

/** The ambition's wording, with its target filled in. */
export function ambitionText(a: AmbitionDef): string {
  const target = a.kind === "net_worth" ? fl(a.target) : String(a.target);
  return a.text.replace("{target}", target);
}

/** The era's ambition, if one was chosen. */
export const ambitionOf = (state: GameState, era: number) => state.legacy.ambitions.find((r) => r.era === era);

/** True when `a` is met now. Ambitions counted from a turn (state loans) count from the start of the era. */
export function ambitionMet(state: GameState, a: AmbitionDef, era: number, data: GameData): boolean {
  const from = turnOfYear(data.legacy.eras[era]?.from ?? state.world.year, data.tuning);
  switch (a.kind) {
    case "state_loan":
      return state.finance.contracts.filter((c) => c.winner === "player" && (c.status === "placing" || c.status === "closed") && c.open_turn >= from).length >= a.target;
    case "net_worth":
      return netWorth(state) >= a.target;
    case "standing":
      return state.house.reputation >= a.target;
    case "first_house":
      return houseRanking(state, netWorth(state))[0]?.player === true;
    case "alliance":
      return allies(state).size >= a.target;
    case "trained_heir": {
      const heir = successor(state, data);
      return heir !== undefined && isTrained(heir, state.world.year, data);
    }
    case "branch":
      return state.europe.branches.length >= a.target;
    case "railway":
      return state.ventures.some((v) => v.type.includes("railway") && ["active", "listed", "paid_out"].includes(v.status));
    case "title":
      return titleRank(state) >= a.target;
  }
}

/** Kinds judged only at the era's end (a state of the house, not a deed). */
const AT_END: ReadonlySet<AmbitionKind> = new Set(["trained_heir"]);

/** Ambitions that may be offered now: of the era, not already met, and for titles only the next rank up. */
export function eligibleAmbitions(state: GameState, era: number, data: GameData): AmbitionDef[] {
  return data.legacy.ambitions.filter((a) => {
    if (!a.eras.includes(era)) return false;
    if (a.kind === "title") return a.target === titleRank(state) + 1;
    return AT_END.has(a.kind) || !ambitionMet(state, a, era, data);
  });
}

/** Ambitions the player may choose from now, or none when the choice is closed or already made. */
export function offeredAmbitions(state: GameState, data: GameData): AmbitionDef[] {
  return checkChooseWindow(state, data) ? [] : state.legacy.offers.map((id) => ambitionDef(id, data)!).filter(Boolean);
}

function checkChooseWindow(state: GameState, data: GameData): string | null {
  const over = runOver(state, data.tuning);
  if (over) return over === "bankrupt" ? "The house is bankrupt" : "The run is over";
  const era = eraOf(state.world.year, data);
  if (era < 0 || state.legacy.offers_era !== era) return "No ambitions are on offer";
  if (ambitionOf(state, era)) return "This era's ambition is already chosen";
  const start = turnOfYear(data.legacy.eras[era]!.from, data.tuning);
  if (state.world.turn >= start + data.legacy.choose_quarters) return `Ambitions are chosen in the first ${data.legacy.choose_quarters} quarters of an era`;
  return null;
}

/** Returns why a choose_ambition decision is invalid, or null. It uses no one's time. */
export function checkChooseAmbition(state: GameState, d: ChooseAmbitionDecision, data: GameData): string | null {
  const closed = checkChooseWindow(state, data);
  if (closed) return closed;
  if (!state.legacy.offers.includes(d.ambition)) return `"${d.ambition}" is not on offer`;
  return null;
}

/** Chooses this era's ambition. Returns a new state; the input is not changed. */
export function chooseAmbition(state: GameState, d: ChooseAmbitionDecision, data: GameData): DecisionResult {
  const reason = checkChooseAmbition(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  next.legacy.ambitions.push({ era: eraOf(state.world.year, data), id: d.ambition, chosen_turn: state.world.turn, status: "open", settled_turn: null });
  return { ok: true, state: next };
}

function settle(state: GameState, r: AmbitionRecord, met: boolean, data: GameData): void {
  const a = ambitionDef(r.id, data)!;
  r.status = met ? "met" : "missed";
  r.settled_turn = state.world.turn;
  const era = data.legacy.eras[r.era]!;
  if (met) {
    changeReputation(state, a.reward_reputation);
    news(state, `The house has done what it set out to do in ${era.name}: ${lower(ambitionText(a))}.`, "An ambition met");
  } else {
    if (a.public) changeReputation(state, -a.miss_reputation);
    const talk = a.public ? " The bourse had heard it promised, and notes the failure." : "";
    news(state, `${capital(era.name)} close, and the house has not managed to ${lower(ambitionText(a))}.${talk}`, "An ambition missed");
  }
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Checks the era's ambition: a deed is met the quarter it is done; at the era's last quarter an
 * open ambition is judged (a state of the house, such as a trained heir, only then) and met or
 * missed. Mutates `state`.
 */
export function checkAmbitions(state: GameState, data: GameData): void {
  const { year, quarter } = state.world;
  const era = eraOf(year, data);
  if (era < 0) return;
  const r = ambitionOf(state, era);
  const last = year === data.legacy.eras[era]!.to && quarter === 4;
  if (!r || r.status !== "open") return;
  const a = ambitionDef(r.id, data);
  if (!a) return;
  if (!AT_END.has(a.kind) && ambitionMet(state, a, era, data)) settle(state, r, true, data);
  else if (last) settle(state, r, ambitionMet(state, a, era, data), data);
}

/** At an era's last quarter, the next era's offers are drawn (one roll per offer). Mutates `state`. */
export function drawNextOffers(state: GameState, rng: Rng, data: GameData): void {
  const { year, quarter } = state.world;
  if (quarter !== 4) return;
  const era = eraOf(year, data);
  if (era < 0 || year !== data.legacy.eras[era]!.to) return;
  const nextEra = era + 1;
  if (nextEra >= data.legacy.eras.length) return;
  state.legacy.offers = drawOffers(eligibleAmbitions(state, nextEra, data), data.legacy.offers, rng);
  state.legacy.offers_era = nextEra;
  if (state.legacy.offers.length) news(state, `As ${data.legacy.eras[nextEra]!.name} begin, the family considers what the house should aim for.`, "Ambitions for a new era");
}

// ---------------------------------------------------------------- titles

/** The rank the house holds: 0 none, 1 "von", 2 Freiherr. */
export const titleRank = (state: GameState) => state.legacy.titles.at(-1)?.rank ?? 0;

export const titleDef = (rank: number, data: GameData) => data.legacy.titles.find((t) => t.rank === rank);

/** The head's name as the house's title makes it: "Johann von Adler", "Johann Freiherr von Adler". */
export function titledName(name: string, state: GameState): string {
  const rank = titleRank(state);
  if (rank === 0) return name;
  const parts = name.split(" ");
  const surname = parts.pop()!;
  return [...parts, rank >= 2 ? "Freiherr von" : "von", surname].join(" ");
}

/**
 * Services the house has done a state: each of its loan contracts won, plus one for holding at
 * least petition.bond_face of its bonds.
 */
export function serviceTo(state: GameState, grantor: string, data: GameData): number {
  const contracts = state.finance.contracts.filter((c) => c.state === grantor && c.winner === "player" && (c.status === "placing" || c.status === "closed")).length;
  const face = state.bonds.filter((b) => b.issuer_state === grantor && b.status === "active").reduce((s, b) => s + b.face_value, 0);
  return contracts + (face >= data.legacy.petition.bond_face ? 1 : 0);
}

/** Why the house does not qualify for `rank` from `grantor` now (merits only: not fee, time or a pending petition), or null. */
export function titleBar(state: GameState, rank: number, grantor: string, data: GameData): string | null {
  const t = titleDef(rank, data);
  const g = data.legacy.grantors.find((x) => x.state === grantor);
  if (!t) return `No title of rank ${rank}`;
  if (!g) return `${stateName(grantor, data)} grants no titles to Frankfurt houses`;
  if (titleRank(state) !== rank - 1) return titleRank(state) >= rank ? `The house already holds ${t.name}` : `${t.name} needs the rank below first`;
  const below = state.legacy.titles.at(-1);
  if (below && state.world.turn < below.turn + t.after_years * 4) return `${t.name} needs the rank below held ${t.after_years} years`;
  if (state.defaulted_states.includes(grantor)) return `${stateName(grantor, data)} has defaulted`;
  const rep = t.min_reputation + g.reputation_extra;
  if (state.house.reputation < rep) return `${stateName(grantor, data)} ennobles only houses of reputation ${rep} or more`;
  if (netWorth(state) < t.min_net_worth) return `${t.name} needs a house worth ${fl(t.min_net_worth)}`;
  const service = serviceTo(state, grantor, data);
  if (service < t.service) return `${stateName(grantor, data)} needs ${t.service} service${t.service > 1 ? "s" : ""} (a loan contract won, or ${fl(data.legacy.petition.bond_face)} of its bonds held); the house has ${service}`;
  return null;
}

const stateName = (id: string, data: GameData) => data.states.find((s) => s.id === id)?.name ?? id;

/** Returns why a petition_title decision is invalid, or null. It takes a clerk's (or the head's) time. */
export function checkPetitionTitle(state: GameState, d: PetitionTitleDecision, data: GameData): string | null {
  const noTime = checkCapacity(state, d.kind, data.tuning);
  if (noTime) return noTime;
  if (!data.legacy.enabled) return "Titles are not in this game";
  if (!headOf(state)) return "The house has no head to petition";
  if (state.legacy.petition) return "A petition is already awaiting an answer";
  if (state.world.turn < state.legacy.petition_after) return "The last petition was refused; a new one must wait";
  const bar = titleBar(state, d.rank, d.grantor, data);
  if (bar) return bar;
  const fee = titleDef(d.rank, data)!.fee;
  if (fee > freeCash(state)) return `Not enough cash above the reserve (fee ${fl(fee)}, free ${fl(freeCash(state))})`;
  return null;
}

/** Petitions a sovereign for a title, paying the fee. Answered at End Turn. Returns a new state. */
export function petitionTitle(state: GameState, d: PetitionTitleDecision, data: GameData): DecisionResult {
  const reason = checkPetitionTitle(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const t = titleDef(d.rank, data)!;
  next.house.cash -= t.fee;
  addEntry(next, "cash", "title_fee", -t.fee, `Petition to ${stateName(d.grantor, data)} for the title ${t.name}`);
  next.legacy.petition = { rank: d.rank, grantor: d.grantor, fee: t.fee, turn: state.world.turn };
  useCapacity(next, d.kind, data.tuning);
  return { ok: true, state: next };
}

/** The chance a sound petition is granted: the sovereign's, moved by the head's Connections, within 0 and 1. */
export function grantChance(state: GameState, grantor: string, data: GameData): number {
  const g = data.legacy.grantors.find((x) => x.state === grantor);
  if (!g) return 0;
  const step = data.legacy.petition.connections_step * (headStat(state, "connections", data) - data.tuning.family.neutral_stat);
  return Math.min(1, Math.max(0, g.chance + step));
}

/**
 * The sovereign answers a pending petition: refused at once if the house no longer qualifies, else
 * one roll against grantChance. A grant raises the rank and reputation; a refusal returns the fee
 * and bars petitions for a while. Mutates `state`.
 */
export function answerPetition(state: GameState, rng: Rng, data: GameData): void {
  const p = state.legacy.petition;
  if (!p) return;
  state.legacy.petition = null;
  const t = titleDef(p.rank, data)!;
  const name = stateName(p.grantor, data);
  const granted = titleBar(state, p.rank, p.grantor, data) === null && rng.next() < grantChance(state, p.grantor, data);
  if (granted) {
    state.legacy.titles.push({ rank: p.rank, grantor: p.grantor, turn: state.world.turn });
    changeReputation(state, t.reputation);
    const head = headOf(state);
    news(state, `${name} has raised the house to the nobility${p.rank >= 2 ? " as Freiherren" : ""}. ${head ? titledName(head.name, state) : "The head"} and every heir after carry the title.`, "A title granted");
  } else {
    state.house.cash += p.fee;
    addEntry(state, "cash", "title_fee", p.fee, `Fee returned: ${name} refused the title ${t.name}`);
    state.legacy.petition_after = state.world.turn + 1 + data.legacy.petition.refused_quarters;
    news(state, `${name} has declined to grant the house the title ${t.name}, for now. The fee is returned.`, "A petition refused");
  }
}

// ---------------------------------------------------------------- prestige

/**
 * Influence from politics (C2): seats in the Senate and the Diet, a court banker's place. Politics is
 * being built in parallel; until it merges this is 0. The integrator replaces the body with a call
 * to the function politics exports, scaled to 0 to 100.
 */
export function influence(_state: GameState, _data: GameData): number {
  return 0;
}

const clamp100 = (n: number) => Math.round(Math.min(100, Math.max(0, n)));

/** Wealth: net worth on a log scale between the floor (0) and the top (100); a bankrupt house scores 0. */
export function wealthPillar(state: GameState, data: GameData): number {
  if (state.house.status === "bankrupt") return 0;
  const { floor, top } = data.legacy.prestige.wealth;
  const nw = netWorth(state);
  if (nw <= floor) return 0;
  return clamp100((100 * Math.log(nw / floor)) / Math.log(top / floor));
}

/** Standing: reputation, and rank among the Frankfurt houses still trading (first 100, last 0). */
export function standingPillar(state: GameState, data: GameData): number {
  const w = data.legacy.prestige.standing;
  const ranking = houseRanking(state, netWorth(state));
  const idx = ranking.findIndex((r) => r.player);
  const rank = ranking.length > 1 ? (100 * (ranking.length - 1 - idx)) / (ranking.length - 1) : 100;
  return clamp100(w.reputation * state.house.reputation + w.rank * rank);
}

/** Family: living heirs, a trained successor, and houses allied by marriage. */
export function familyPillar(state: GameState, data: GameData): number {
  const f = data.legacy.prestige.family;
  const heirs = Math.min(f.max_heirs, heirsOf(state).length) * f.per_heir;
  const next = successor(state, data);
  const trained = next && isTrained(next, state.world.year, data) ? f.trained_successor : 0;
  const ties = Math.min(f.max_allies, allies(state).size) * f.per_ally;
  return clamp100(heirs + trained + ties);
}

/** Legacy: the title held, ambitions met, and companies the house floated on the bourse. */
export function legacyPillar(state: GameState, data: GameData): number {
  const l = data.legacy.prestige.legacy;
  const title = titleDef(titleRank(state), data)?.legacy ?? 0;
  const met = state.legacy.ambitions.filter((r) => r.status === "met").reduce((s, r) => s + (ambitionDef(r.id, data)?.legacy ?? 0), 0);
  const listed = Math.min(l.max_listed, state.ventures.filter((v) => v.status === "listed").length) * l.per_listed;
  return clamp100(title + met + listed);
}

/** Each pillar, 0 to 100. */
export function pillars(state: GameState, data: GameData): Pillars {
  return {
    wealth: wealthPillar(state, data),
    standing: standingPillar(state, data),
    family: familyPillar(state, data),
    influence: clamp100(influence(state, data)),
    legacy: legacyPillar(state, data),
  };
}

/** Prestige: the five pillars and their sum (0 to 500). */
export function prestige(state: GameState, data: GameData): Pillars & { total: number } {
  const p = pillars(state, data);
  return { ...p, total: PILLARS.reduce((s, k) => s + p[k], 0) };
}

// ---------------------------------------------------------------- end turn

/**
 * Legacy's End Turn step, last of all, so it scores the finished quarter: 1. the sovereign answers a
 * pending petition (one roll), 2. the era's ambition is checked (met, or at the era's end judged),
 * 3. at an era's end the next era's offers are drawn, 4. at year end prestige is recorded. A bankrupt
 * house does nothing more. Rolls come from legacy's own stream. Mutates `state`.
 */
export function resolveLegacy(state: GameState, _rng: Rng, data: GameData): void {
  if (!data.legacy.enabled || state.house.status === "bankrupt") return;
  withLegacyRng(state, (rng) => {
    answerPetition(state, rng, data);
    checkAmbitions(state, data);
    drawNextOffers(state, rng, data);
  });
  if (state.world.quarter === 4) state.legacy.history.push({ year: state.world.year, ...prestige(state, data) });
}

/** Legacy holds nothing counted in net worth. */
export function legacyBook(_state: GameState): number {
  return 0;
}

/** Problems with data/legacy.json, as readable lines. Empty means the file is sound. */
export function checkLegacyData(data: GameData): string[] {
  const l = data.legacy;
  const out: string[] = [];
  l.eras.forEach((e, i) => {
    if (e.from > e.to) out.push(`Era ${i} ends before it starts`);
    if (i > 0 && e.from !== l.eras[i - 1]!.to + 1) out.push(`Era ${i} does not follow era ${i - 1}`);
  });
  const ids = new Set<string>();
  for (const a of l.ambitions) {
    if (ids.has(a.id)) out.push(`Ambition "${a.id}" appears twice`);
    ids.add(a.id);
    if (!a.eras.length || a.eras.some((e) => e < 0 || e >= l.eras.length)) out.push(`Ambition "${a.id}" has a bad era`);
    if (a.text.includes("\u2014")) out.push(`Ambition "${a.id}" has an em dash`);
  }
  for (const g of l.grantors) if (!data.states.some((s) => s.id === g.state)) out.push(`Grantor "${g.state}" is not a state`);
  l.titles.forEach((t, i) => {
    if (t.rank !== i + 1) out.push(`Title "${t.id}" should have rank ${i + 1}`);
  });
  return out;
}

// ---------------------------------------------------------------- decisions

const KINDS: ReadonlySet<string> = new Set(["choose_ambition", "petition_title"]);
export const isLegacyDecision = (d: Decision): d is LegacyDecision => KINDS.has(d.kind);

export function applyLegacyDecision(state: GameState, d: LegacyDecision, data: GameData): DecisionResult {
  switch (d.kind) {
    case "choose_ambition":
      return chooseAmbition(state, d, data);
    case "petition_title":
      return petitionTitle(state, d, data);
  }
}

export function describeLegacyDecision(d: LegacyDecision, _state: GameState, data: GameData): string {
  switch (d.kind) {
    case "choose_ambition": {
      const a = ambitionDef(d.ambition, data);
      return a ? `Set the house an ambition: ${lower(ambitionText(a))}` : `Choose ambition ${d.ambition}`;
    }
    case "petition_title": {
      const t = titleDef(d.rank, data);
      return `Petition ${stateName(d.grantor, data)} for the title ${t?.name ?? d.rank}${t ? ` (fee ${fl(t.fee)})` : ""}`;
    }
  }
}
