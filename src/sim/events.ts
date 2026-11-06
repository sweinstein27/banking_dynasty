// Historical and random events from data/events.json. Events fire at the end of a turn, after the
// mood roll, and describe the quarter that follows: their news is read at the start of that quarter.
import { addEntry } from "./ledger";
import type { Rng } from "./rng";
import { recordDefault } from "./borrowers";
import { heirsOf, heirTalent, reputationGain } from "./family";
import { startPanicWarning } from "./sentiment";
import type { EventConditions, EventEffect, GameData, GameEvent, Tuning } from "./tuning";
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
  if (c.holds_bonds_of && !state.bonds.some((b) => b.status === "active" && b.issuer_state === c.holds_bonds_of)) return false;
  return true;
}

/** Applies one event's effects in order. Mutates `state`; callers pass a draft copy. */
export function applyEffects(state: GameState, ev: GameEvent, rng: Rng, data: GameData): void {
  const note = `Event: ${ev.title}`;
  for (const e of ev.effects) applyEffect(state, e, note, rng, data);
}

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
 * Draws one roll every turn, a second only when a random event fires, and one more for each
 * loan_default effect. Mutates `state`; callers pass a draft copy.
 */
export function resolveEvents(state: GameState, rng: Rng, data: GameData): void {
  const date = nextQuarter(state.world);
  const fired = new Set(state.fired_events.map((f) => f.id));
  const fire = (ev: GameEvent) => {
    applyEffects(state, ev, rng, data);
    state.fired_events.push({ id: ev.id, turn: state.world.turn });
  };

  for (const ev of data.events) {
    if (!ev.historical || fired.has(ev.id)) continue;
    if (dateIndex({ year: ev.year!, quarter: ev.quarter! }) !== dateIndex(date)) continue;
    if (!conditionsMet(state, ev.conditions, date)) continue;
    fire(ev);
  }

  if (rng.next() >= data.tuning.events.random_chance) return;
  const eligible = data.events.filter((ev) => !ev.historical && offCooldown(state, ev, data) && conditionsMet(state, ev.conditions, date));
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
    if (/[—–]/.test(ev.title + ev.text)) p("uses a dash; the writing style forbids em dashes");
    if (ev.historical) {
      if (!Number.isInteger(ev.year) || ![1, 2, 3, 4].includes(ev.quarter as number)) p("historical events need a year and a quarter from 1 to 4");
      if (ev.weight !== undefined) p("historical events take no weight");
    } else if (!(typeof ev.weight === "number" && ev.weight > 0)) p("random events need a weight above zero");
    const c = ev.conditions;
    if (!c) p("needs a conditions object (may be empty)");
    else {
      if (c.sentiment?.some((s) => !SENTIMENTS.includes(s))) p("unknown sentiment in conditions");
      if (c.holds_bonds_of && !stateIds.has(c.holds_bonds_of)) p(`unknown state "${c.holds_bonds_of}" in conditions`);
    }
    // An empty list is allowed: some events are news only.
    if (!Array.isArray(ev.effects)) p("needs an effects list (may be empty)");
    for (const e of ev.effects ?? []) {
      if (e.kind === "set_sentiment" && !SENTIMENTS.includes(e.sentiment)) p(`unknown sentiment "${e.sentiment}"`);
      else if (e.kind === "state_risk" && !stateIds.has(e.state)) p(`unknown state "${e.state}"`);
      else if (e.kind === "cash" && (e.amount === undefined) === (e.share === undefined)) p("cash effects need exactly one of amount or share");
      else if (e.kind === "trade_risk" && !(e.factor > 0)) p("trade_risk needs a factor above zero");
      else if (e.kind === "panic_warning" && !(Number.isInteger(e.quarters) && e.quarters >= 1)) p("panic_warning needs a whole number of quarters, at least 1");
      else if (e.kind === "heir_talent" && !(Number.isInteger(e.gain) && e.gain >= 1)) p("heir_talent needs a whole gain of at least 1");
      else if (!["set_sentiment", "reputation", "cash", "loan_default", "state_risk", "trade_risk", "panic_warning", "heir_talent"].includes(e.kind)) p(`unknown effect "${(e as { kind: string }).kind}"`);
    }
  }
  return problems;
}
