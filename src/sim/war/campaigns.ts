// Campaigns in dated phases, the fortunes of war, unrest pressure in every city, Frankfurt's own
// troubles, and what all of these add to states' risk and to trade risk (kept so it can be taken back).
import { cityState } from "../europe/world";
import type { CityStatus, QuarterDate } from "../europe/types";
import { applyShock } from "../markets/prices";
import type { Rng } from "../rng";
import type { GameData } from "../tuning";
import type { GameState } from "../types";
import type { CampaignData, CampaignStage, CurvePoint, Phase, WarData, WarState } from "./types";

const PHASES: readonly string[] = ["mobilizing", "fighting", "settling"];
export const isPhase = (s: CampaignStage): s is Phase => PHASES.includes(s);

const index = (d: QuarterDate) => d.year * 4 + d.quarter;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Where a campaign stands in quarter `d`: the stage of its last dated turn on or before it. */
export function stageAt(c: CampaignData, d: QuarterDate): CampaignStage {
  let stage: CampaignStage = "before";
  for (const t of c.timeline) if (index(t) <= index(d)) stage = t.stage === "peace" ? "over" : t.stage;
  return stage;
}

/** The pressure curve's level at a date, on straight lines between its points. */
export function curveAt(curve: CurvePoint[], d: QuarterDate): number {
  const x = d.year + (d.quarter - 1) / 4;
  if (!curve.length) return 0;
  if (x <= curve[0]!.year) return curve[0]!.level;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (x <= b.year) return a.level + ((b.level - a.level) * (x - a.year)) / (b.year - a.year);
  }
  return curve.at(-1)!.level;
}

/** Pressure a city drifts toward in quarter `d`, before grain and panic. */
export const basePressure = (w: WarData, city: string, d: QuarterDate) => curveAt(w.pressure.curve, d) * (w.pressure.scale[city] ?? 1);

/** The war system at the start date: campaigns already under way stand in their phase; pressure on the curve. */
export function createWarState(data: GameData, rngState: number): WarState {
  const w = data.war;
  const start = { year: data.tuning.start.year, quarter: data.tuning.start.quarter };
  return {
    rng_state: rngState,
    campaigns: Object.fromEntries(w.campaigns.map((c) => [c.id, { stage: stageAt(c, start), fortune: {} }])),
    applied: { risk: {}, trade: 1 },
    loans: [],
    next_id: 1,
    pressure: Object.fromEntries(data.europe.cities.map((c) => [c.id, Math.round(basePressure(w, c.id, start) * 10) / 10])),
    warned: {},
    fired: [],
    lent_on: [],
  };
}

const warNews = (state: GameState, title: string, text: string) => state.news.push({ turn: state.world.turn, kind: "europe", title, text });

export const stateName = (data: GameData, id: string) => data.states.find((s) => s.id === id)?.name ?? data.war.borrowers.find((b) => b.id === id)?.name ?? id;

/**
 * Moves every campaign to its stage for quarter `next`: news of each dated turn, the shock of a
 * phase that begins, and in a fighting quarter one roll per state at war for its fortunes (bad news
 * a step up, good news a step down). Mutates `state`.
 */
export function advanceCampaigns(state: GameState, rng: Rng, data: GameData, next: QuarterDate): void {
  const w = data.war;
  for (const c of w.campaigns) {
    const cs = state.war.campaigns[c.id] ?? (state.war.campaigns[c.id] = { stage: "before", fortune: {} });
    const stage = stageAt(c, next);
    for (const t of c.timeline) if (index(t) === index(next)) warNews(state, t.title, t.text);
    if (stage !== cs.stage) {
      const shock = stage === "over" ? c.shocks?.peace : isPhase(stage) ? c.shocks?.[stage] : undefined;
      if (shock) applyShock(state.markets, shock);
      cs.stage = stage;
    }
    if (stage !== "fighting") continue;
    const good: string[] = [];
    const bad: string[] = [];
    for (const s of c.states) {
      const isBad = rng.next() < w.fortune.bad;
      cs.fortune[s] = clamp((cs.fortune[s] ?? 0) + (isBad ? 1 : -1), -w.fortune.cap, w.fortune.cap);
      (isBad ? bad : good).push(stateName(data, s));
    }
    const parts = [...(good.length ? [w.texts.fortune_good.replaceAll("{states}", good.join(" and "))] : []), ...(bad.length ? [w.texts.fortune_bad.replaceAll("{states}", bad.join(" and "))] : [])];
    if (parts.length) warNews(state, `News of the ${c.name}`, parts.join(" "));
  }
}

/** The status Frankfurt has on the map (C1 never rolls the home city). */
export function homeStatus(state: GameState, data: GameData): CityStatus {
  return cityState(state, data.europe.home)?.status ?? "peace";
}

function setHome(state: GameState, data: GameData, status: CityStatus, left: number): void {
  const c = cityState(state, data.europe.home);
  if (!c) return;
  c.status = status;
  c.status_left = left;
  c.known = { mood: c.mood, status, shock: 1, as_of: state.world.turn };
}

/**
 * Rolls every city's unrest pressure for quarter `next` (one roll each, in data order): it closes
 * `speed` of the gap to the curve (scaled per city) plus dear grain and any panic, plus noise; a
 * city in unrest or at war lets some out. News when it rises through a warning level. Mutates `state`.
 */
export function rollPressure(state: GameState, rng: Rng, data: GameData, next: QuarterDate): void {
  const p = data.war.pressure;
  const grain = grainDearness(state, data);
  for (const city of data.europe.cities) {
    const c = cityState(state, city.id);
    const mood = city.id === data.europe.home ? state.world.sentiment : c?.mood;
    const target = basePressure(data.war, city.id, next) + p.grain * grain + (mood === "panic" ? p.panic : 0);
    const was = state.war.pressure[city.id] ?? 0;
    let now = was + p.speed * (target - was) + p.noise * (2 * rng.next() - 1);
    if (c && c.status !== "peace") now -= p.release;
    now = Math.round(clamp(now, 0, 100) * 10) / 10;
    state.war.pressure[city.id] = now;
    const level = p.warn.filter((l) => now >= l).length;
    const warned = state.war.warned[city.id] ?? 0;
    if (level > warned) {
      const t = data.war.texts.warn[level - 1]!;
      warNews(state, t.title.replaceAll("{city}", city.name), t.text.replaceAll("{city}", city.name));
    }
    state.war.warned[city.id] = level;
  }
}

/** How far grain stands above its base price (0 when at or below it). */
export function grainDearness(state: GameState, data: GameData): number {
  const type = data.markets.commodities.find((c) => c.id === "grain");
  const mk = state.markets?.commodities?.grain;
  if (!type || !mk) return 0;
  return Math.max(0, mk.price / (type.base_price * mk.level) - 1);
}

/**
 * Frankfurt's quarter: a trouble whose quarters have run out ends; dated happenings for `next`
 * fire (status, news, pressure let out); otherwise, above the pressure threshold, one roll may
 * start a quarter of unrest. Always draws one roll. Mutates `state`.
 */
export function rollHome(state: GameState, rng: Rng, data: GameData, next: QuarterDate): void {
  const w = data.war;
  const home = data.europe.home;
  const c = cityState(state, home);
  const u = rng.next();
  if (!c) return;
  if (c.status !== "peace") {
    const left = Math.max(0, c.status_left - 1);
    if (left > 0) c.status_left = left;
    else {
      setHome(state, data, "peace", 0);
      warNews(state, w.texts.home_peace.title, w.texts.home_peace.text);
    }
  }
  const dated = w.home.filter((h) => h.year === next.year && h.quarter === next.quarter && !state.war.fired.includes(h.id));
  for (const h of dated) {
    state.war.fired.push(h.id);
    warNews(state, h.title, h.text);
    if (h.release) state.war.pressure[home] = Math.max(0, (state.war.pressure[home] ?? 0) - h.release);
    if (h.kind !== "news") setHome(state, data, h.kind, h.kind === "peace" ? 0 : h.quarters ?? 1);
  }
  if (dated.some((h) => h.kind !== "news") || c.status !== "peace") return;
  const { from, chance } = w.pressure.home;
  const pressure = state.war.pressure[home] ?? 0;
  if (pressure > from && u < (chance * (pressure - from)) / (100 - from)) {
    setHome(state, data, "unrest", 1);
    warNews(state, w.texts.home_unrest.title, w.texts.home_unrest.text);
  }
}

/** Risk this system wants added to each state now: campaigns in a phase (with fortunes), residuals after peace, and pressure in the state's cities. */
export function wantedRisk(state: GameState, data: GameData): Record<string, number> {
  const w = data.war;
  const out: Record<string, number> = {};
  const add = (s: string, r: number) => (out[s] = (out[s] ?? 0) + r);
  for (const c of w.campaigns) {
    const cs = state.war.campaigns[c.id];
    if (!cs) continue;
    if (isPhase(cs.stage)) for (const s of c.states) add(s, Math.max(0, (c.risk[cs.stage] ?? 0) + (cs.fortune[s] ?? 0) * w.fortune.swing));
    if (cs.stage === "over") for (const [s, r] of Object.entries(c.residual ?? {})) add(s, r);
  }
  for (const city of data.europe.cities) {
    if (!city.state) continue;
    add(city.state, ((state.war.pressure[city.id] ?? 0) / 100) * w.pressure.state_risk);
  }
  return out;
}

/** The factor this system wants on trade risk now: each campaign's phase, and Frankfurt's own trouble. */
export function wantedTrade(state: GameState, data: GameData): number {
  const w = data.war;
  let f = 1;
  for (const c of w.campaigns) {
    const stage = state.war.campaigns[c.id]?.stage;
    if (stage && isPhase(stage)) f *= c.trade?.[stage] ?? 1;
  }
  const home = homeStatus(state, data);
  if (home !== "peace") f *= w.home_trade[home];
  return f;
}

/**
 * Brings state.risk_shift and state.trade_risk to what the war wants, changing them only by the
 * difference from what it applied before, so events' own shifts are untouched and peace takes the
 * war's back. Mutates `state`.
 */
export function syncEffects(state: GameState, data: GameData): void {
  const want = wantedRisk(state, data);
  const applied = state.war.applied;
  for (const s of new Set([...Object.keys(want), ...Object.keys(applied.risk)])) {
    const delta = (want[s] ?? 0) - (applied.risk[s] ?? 0);
    if (Math.abs(delta) < 1e-9) continue;
    state.risk_shift[s] = round6((state.risk_shift[s] ?? 0) + delta);
    applied.risk[s] = round6(want[s] ?? 0);
  }
  const trade = wantedTrade(state, data);
  if (Math.abs(trade - applied.trade) > 1e-9) {
    state.trade_risk = round6((state.trade_risk / applied.trade) * trade);
    applied.trade = trade;
  }
}

/** The phase a state's war is in (the most severe of its campaigns), or null at peace. */
export function warPhaseOf(state: GameState, data: GameData, stateId: string): Phase | null {
  let best: Phase | null = null;
  const rank: Record<Phase, number> = { settling: 1, mobilizing: 2, fighting: 3 };
  for (const c of data.war.campaigns) {
    const stage = state.war?.campaigns?.[c.id]?.stage;
    if (!stage || !isPhase(stage) || !c.states.includes(stateId)) continue;
    if (!best || rank[stage] > rank[best]) best = stage;
  }
  return best;
}
