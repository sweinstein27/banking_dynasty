// Historical and random events from data/events.json. Events fire at the end of a turn, after the
// mood roll, and describe the quarter that follows: their news is read at the start of that quarter.
import { addEntry } from "./ledger";
import type { Rng } from "./rng";
import { recordDefault } from "./borrowers";
import { heirsOf, heirTalent, heirTrait, reputationGain } from "./family";
import { changeOpinion } from "./houses";
import { startPanicWarning } from "./sentiment";
import type { EventConditions, EventEffect, EventOption, GameData, GameEvent, Tuning } from "./tuning";
import type { GameState, Quarter, Sentiment } from "./types";

export interface QuarterDate {
  year: number;
  quarter: Quarter;
}

/** The quarter after the current one. */
export function nextQuarter(world: QuarterDate): QuarterDate {
  return world.quarter === 4 ? { year: world.year + 1, quarter: 1 } : { year: world.year, quarter: (world.quarter + 1) as Quarter };
}

const dateIndex = (d: QuarterDate) => d.year * 4 + d.quarter;

/** True when every condition holds. `date` is the quarter the event would describe. */
export function conditionsMet(state: GameState, c: EventConditions, date: QuarterDate): boolean {
  if (c.min_year !== undefined && date.year < c.min_year) return false;
  if (c.max_year !== undefined && date.year > c.max_year) return false;
  if (c.sentiment && !c.sentiment.includes(state.world.sentiment)) return false;
  if (c.min_reputation !== undefined && state.house.reputation < c.min_reputation) return false;
  if (c.max_reputation !== undefined && state.house.reputation > c.max_reputation) return false;
  if (c.has_active_loans !== undefined && state.loans.some((l) => l.status === "active") !== c.has_active_loans) return false;
  if (c.has_heirs !== undefined && (heirsOf(state).length > 0) !== c.has_heirs) return false;
  if (c.default_within_quarters !== undefined && !state.borrowers.some((b) => b.last_default_turn !== null && state.world.turn - b.last_default_turn < c.default_within_quarters!)) return false;
  if (c.house_not_allied !== undefined && state.marriages.some((m) => m.house === c.house_not_allied)) return false;
  if (c.house_opinion) {
    const h = state.houses.find((x) => x.id === c.house_opinion!.house);
    if (!h || h.failed_turn !== null) return false;
    if (c.house_opinion.at_least !== undefined && h.opinion < c.house_opinion.at_least) return false;
    if (c.house_opinion.below !== undefined && h.opinion >= c.house_opinion.below) return false;
  }
  if (c.holds_bonds_of && !state.bonds.some((b) => b.status === "active" && b.issuer_state === c.holds_bonds_of)) return false;
  return true;
}

/** Applies one event's effects in order. Mutates `state`; callers pass a draft copy. */
export function applyEffects(state: GameState, ev: GameEvent, rng: Rng, data: GameData): void {
  applyEffectList(state, ev.effects, `Event: ${ev.title}`, rng, data);
}

/** Applies a list of effects in order, with `note` on any ledger entry. Mutates `state`. */
export function applyEffectList(state: GameState, effects: EventEffect[], note: string, rng: Rng, data: GameData): void {
  for (const e of effects) applyEffect(state, e, note, rng, data);
}

/** Effects that draw on the RNG. A letter's response applies these at End Turn; the rest at once. */
const UNCERTAIN: EventEffect["kind"][] = ["loan_default", "heir_talent", "heir_trait", "follow_up"];
export const isUncertain = (e: EventEffect) => UNCERTAIN.includes(e.kind);

function applyEffect(state: GameState, e: EventEffect, note: string, rng: Rng, data: GameData): void {
  const tuning = data.tuning;
  const { house } = state;
  switch (e.kind) {
    case "set_sentiment":
      // A panic warning holds the market uneasy until it breaks: only a panic overrides it.
      if (state.panic_warning && e.sentiment !== "panic") return;
      if (e.sentiment === "panic") state.panic_warning = null;
      state.world.sentiment = e.sentiment;
      return;
    case "panic_warning":
      startPanicWarning(state, e.quarters);
      return;
    case "heir_talent":
      heirTalent(state, e.gain, rng, tuning);
      return;
    case "heir_trait":
      heirTrait(state, e.trait, rng, data);
      return;
    case "opinion":
      changeOpinion(state, e.house, e.delta, tuning);
      return;
    case "follow_up":
      // Fires at the end of one of the next `within_quarters` turns (one roll).
      state.scheduled_events.push({ id: e.event, turn: state.world.turn + 1 + Math.floor(rng.next() * e.within_quarters) });
      return;
    case "reputation": {
      // Gains are scaled by the head's traits (a charismatic head makes more of good news); losses are not.
      const delta = e.delta > 0 ? reputationGain(e.delta, state, data) : e.delta;
      house.reputation = Math.min(100, Math.max(0, Math.round(house.reputation + delta)));
      return;
    }
    case "cash": {
      let amount = e.amount ?? Math.round(house.cash * (e.share ?? 0));
      // A loss takes no more than the cash there is.
      if (amount < 0) amount = -Math.min(-amount, Math.max(0, house.cash));
      if (amount === 0) return;
      house.cash += amount;
      addEntry(state, "cash", "event", amount, note);
      return;
    }
    case "loan_default": {
      const active = state.loans.filter((l) => l.status === "active");
      if (!active.length) return;
      const loan = active[Math.floor(rng.next() * active.length)]!;
      recordDefault(state, loan, `Loan #${loan.id}: ${loan.borrower_name} defaulted (${note})`, tuning);
      return;
    }
    case "state_risk":
      state.risk_shift[e.state] = Math.round(((state.risk_shift[e.state] ?? 0) + e.delta) * 1000) / 1000;
      return;
    case "trade_risk":
      state.trade_risk = Math.round(state.trade_risk * e.factor * 1000) / 1000;
      return;
  }
}

/**
 * Fires the events for the quarter after the current one: first every historical event dated that
 * quarter whose conditions hold (in data order; one whose conditions fail never fires), then, on one roll of `events.random_chance`,
 * one random event picked by weight from those whose conditions hold and whose cooldown has passed.
 * Follow-up events scheduled for this turn fire first. An event with options also leaves a letter.
 * Draws one roll every turn, a second only when a random event fires, and more for effects that
 * draw (loan_default, heir_talent, heir_trait, follow_up). Mutates `state`; callers pass a draft copy.
 */
export function resolveEvents(state: GameState, rng: Rng, data: GameData): void {
  const date = nextQuarter(state.world);
  const fired = new Set(state.fired_events.map((f) => f.id));
  const fire = (ev: GameEvent) => {
    applyEffects(state, ev, rng, data);
    state.fired_events.push({ id: ev.id, turn: state.world.turn });
    if (ev.options?.length && !state.letters.some((l) => l.event === ev.id)) state.letters.push({ event: ev.id, turn: state.world.turn, answer: null });
  };

  // Follow-ups due this turn, in the order they were scheduled. One whose conditions fail is dropped
  // (a house that has failed by then never repays).
  const due = state.scheduled_events.filter((s) => s.turn <= state.world.turn);
  state.scheduled_events = state.scheduled_events.filter((s) => s.turn > state.world.turn);
  for (const s of due) {
    const ev = data.events.find((e) => e.id === s.id);
    if (ev && conditionsMet(state, ev.conditions, date)) fire(ev);
  }

  for (const ev of data.events) {
    if (!ev.historical || fired.has(ev.id)) continue;
    if (dateIndex({ year: ev.year!, quarter: ev.quarter! }) !== dateIndex(date)) continue;
    if (!conditionsMet(state, ev.conditions, date)) continue;
    fire(ev);
  }

  if (rng.next() >= data.tuning.events.random_chance) return;
  const eligible = data.events.filter((ev) => !ev.historical && !ev.follow_up && offCooldown(state, ev, data) && conditionsMet(state, ev.conditions, date));
  const total = eligible.reduce((sum, ev) => sum + ev.weight!, 0);
  if (total <= 0) return;
  let pick = rng.next() * total;
  for (const ev of eligible) {
    pick -= ev.weight!;
    if (pick < 0) return fire(ev);
  }
  fire(eligible.at(-1)!);
}

function offCooldown(state: GameState, ev: GameEvent, data: GameData): boolean {
  const cooldown = ev.cooldown_quarters ?? data.tuning.events.cooldown_quarters;
  const last = state.fired_events.filter((f) => f.id === ev.id).at(-1);
  return !last || state.world.turn - last.turn >= cooldown;
}

const SENTIMENTS: Sentiment[] = ["calm", "uneasy", "panic"];

/** Problems with data/events.json, as readable lines. Empty means the file is sound. */
export function checkEventData(data: GameData): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const stateIds = new Set(data.states.map((s) => s.id));
  for (const ev of data.events) {
    const p = (msg: string) => problems.push(`${ev.id}: ${msg}`);
    if (ids.has(ev.id)) p("duplicate id");
    ids.add(ev.id);
    if (!ev.title || !ev.text) p("needs a title and text");
    if (DASH.test(ev.title + ev.text)) p("uses a dash; the writing style forbids em dashes");
    if (ev.follow_up) {
      if (ev.historical || ev.weight !== undefined) p("follow-up events take no date and no weight");
    } else if (ev.historical) {
      if (!Number.isInteger(ev.year) || ![1, 2, 3, 4].includes(ev.quarter as number)) p("historical events need a year and a quarter from 1 to 4");
      if (ev.weight !== undefined) p("historical events take no weight");
    } else if (!(typeof ev.weight === "number" && ev.weight > 0)) p("random events need a weight above zero");
    const c = ev.conditions;
    if (!c) p("needs a conditions object (may be empty)");
    else {
      if (c.sentiment?.some((s) => !SENTIMENTS.includes(s))) p("unknown sentiment in conditions");
      if (c.holds_bonds_of && !stateIds.has(c.holds_bonds_of)) p(`unknown state "${c.holds_bonds_of}" in conditions`);
      if (c.house_opinion && !data.houses.houses.some((h) => h.id === c.house_opinion!.house)) p(`unknown house "${c.house_opinion.house}" in conditions`);
      if (c.default_within_quarters !== undefined && !(Number.isInteger(c.default_within_quarters) && c.default_within_quarters >= 1)) p("default_within_quarters needs a whole number of at least 1");
    }
    // An empty list is allowed: some events are news only.
    if (!Array.isArray(ev.effects)) p("needs an effects list (may be empty)");
    else checkEffects(ev.effects, p, data);
    if (ev.options !== undefined) checkOptions(ev, p, data);
    else if (ev.default_option !== undefined) p("default_option without options");
  }
  for (const ev of data.events) {
    for (const e of [...ev.effects ?? [], ...(ev.options ?? []).flatMap((o) => [...o.effects, ...(o.chance?.effects ?? [])])]) {
      if (e.kind !== "follow_up") continue;
      const target = data.events.find((x) => x.id === e.event);
      if (!target) problems.push(`${ev.id}: follow_up names unknown event "${e.event}"`);
      else if (!target.follow_up) problems.push(`${ev.id}: follow_up event "${e.event}" must be marked follow_up`);
    }
  }
  return problems;
}

const EFFECT_KINDS = ["set_sentiment", "reputation", "cash", "loan_default", "state_risk", "trade_risk", "panic_warning", "heir_talent", "heir_trait", "follow_up", "opinion"];
const DASH = /[\u2014\u2013]/;

function checkEffects(effects: EventEffect[], p: (msg: string) => void, data: GameData): void {
  const stateIds = new Set(data.states.map((s) => s.id));
  for (const e of effects) {
    if (e.kind === "set_sentiment" && !SENTIMENTS.includes(e.sentiment)) p(`unknown sentiment "${e.sentiment}"`);
    else if (e.kind === "state_risk" && !stateIds.has(e.state)) p(`unknown state "${e.state}"`);
    else if (e.kind === "cash" && (e.amount === undefined) === (e.share === undefined)) p("cash effects need exactly one of amount or share");
    else if (e.kind === "trade_risk" && !(e.factor > 0)) p("trade_risk needs a factor above zero");
    else if (e.kind === "panic_warning" && !(Number.isInteger(e.quarters) && e.quarters >= 1)) p("panic_warning needs a whole number of quarters, at least 1");
    else if (e.kind === "heir_talent" && !(Number.isInteger(e.gain) && e.gain >= 1)) p("heir_talent needs a whole gain of at least 1");
    else if (e.kind === "heir_trait" && !data.traits.some((t) => t.id === e.trait)) p(`unknown trait "${e.trait}"`);
    else if (e.kind === "follow_up" && !(Number.isInteger(e.within_quarters) && e.within_quarters >= 1)) p("follow_up needs a whole within_quarters of at least 1");
    else if (e.kind === "opinion" && !data.houses.houses.some((h) => h.id === e.house)) p(`unknown house "${e.house}"`);
    else if (!EFFECT_KINDS.includes(e.kind)) p(`unknown effect "${(e as { kind: string }).kind}"`);
  }
}

function checkOptions(ev: GameEvent, p: (msg: string) => void, data: GameData): void {
  const options = ev.options!;
  if (!Array.isArray(options) || options.length < 2 || options.length > 3) return p("options need 2 to 3 responses");
  const ids = new Set<string>();
  for (const o of options) {
    const q = (msg: string) => p(`option ${o.id}: ${msg}`);
    if (ids.has(o.id)) q("duplicate id");
    ids.add(o.id);
    if (!o.label || !o.text) q("needs a label and text");
    if (DASH.test(o.label + o.text + (o.chance?.text ?? "") + (o.chance?.miss_text ?? ""))) q("uses a dash; the writing style forbids em dashes");
    if (!Array.isArray(o.effects)) q("needs an effects list (may be empty)");
    else checkEffects(o.effects, q, data);
    if (o.chance) {
      if (!(o.chance.p > 0 && o.chance.p < 1)) q("chance p must be between 0 and 1");
      if (!o.chance.text) q("chance needs a text");
      if (!Array.isArray(o.chance.effects)) q("chance needs an effects list");
      else checkEffects(o.chance.effects, q, data);
    }
  }
  const def = options.find((o) => o.id === ev.default_option);
  if (!def) p("default_option must name one of the options");
  else if (optionCost(def) > 0) p("the default option must cost nothing");
}

/** Cash a response costs up front: its fixed cash losses. Shares of cash are always affordable. */
export function optionCost(o: EventOption): number {
  return o.effects.reduce((sum, e) => (e.kind === "cash" && e.amount !== undefined && e.amount < 0 ? sum - e.amount : sum), 0);
}
