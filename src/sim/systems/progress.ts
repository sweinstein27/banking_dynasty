// C4, progress: technology waves (Rhine steam, gas, railways, the telegraph) arrive over time.
// Each technology has an adoption level from 0 to 1, read off a dated curve in data/progress.json,
// plus a local push from the house's own ventures of that technology. Adoption scales sector
// earnings (railways lift industry and hurt canals), drifts some borrowers' trades, opens ventures
// at dated stages (some earlier if the house backs the technology), and, through
// `telegraphDelay`, shortens how long news takes to reach Frankfurt. Draws no random numbers.
import type { DecisionResult } from "../actions";
import type { Rng } from "../rng";
import type { GameData, VentureType } from "../tuning";
import type { Decision, GameState, Quarter } from "../types";

/** A point on a technology's adoption curve. Adoption is 0 before the first point and the last level after the last. */
export interface CurvePoint {
  year: number;
  quarter: Quarter;
  level: number;
}

export interface TechnologyType {
  id: string;
  name: string;
  curve: CurvePoint[];
  /** Venture types that are this technology: each open section of the house's own adds `per_section` local adoption, up to `local_cap`. */
  ventures: string[];
  per_section: number;
  local_cap: number;
}

/** A dated step in a technology's arrival: news, and the venture types it opens. */
export interface Stage {
  id: string;
  tech: string;
  year: number;
  quarter: Quarter;
  /** Headline and text for the news; a stage without text writes none (an event already tells it). */
  title?: string;
  text?: string;
  /** Venture types this stage opens. Ventures in no stage open by their `unlock_year`. */
  opens?: string[];
  /** The stage comes as early as this date if the house already has a section of this technology open. */
  early?: { year: number; quarter: Quarter; text: string };
}

/** data/progress.json */
export interface ProgressData {
  technologies: TechnologyType[];
  stages: Stage[];
  /** Sector earnings multiplier at full adoption: 1 + (at_full - 1) x adoption. */
  sectors: { tech: string; sector: string; at_full: number }[];
  /** Borrowers in a trade drift as adoption rises: quality by up to `quality_at_full`, turnover to `turnover_at_full` times. */
  trades: { tech: string; trade: string; quality_at_full: number; turnover_at_full: number }[];
  quality_bounds: { min: number; max: number };
  /** Places linked to Frankfurt by electric telegraph from this date: their news arrives without delay. */
  telegraph_lines: { place: string; year: number; quarter: Quarter }[];
}

/** state.progress */
export interface ProgressState {
  /** Adoption this quarter by technology, local push included, 0 to 1. */
  adoption: Record<string, number>;
  /** The house's local push by technology. */
  local: Record<string, number>;
  /** Ids of stages reached, in order. */
  stages: string[];
}
export type ProgressDecision = never;
export type ProgressCategory = never;

const index = (year: number, quarter: number) => year * 4 + quarter - 1;
const round4 = (x: number) => Math.round(x * 10000) / 10000;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** The quarter after (year, quarter). */
function following(year: number, quarter: number): { year: number; quarter: Quarter } {
  return quarter === 4 ? { year: year + 1, quarter: 1 } : { year, quarter: (quarter + 1) as Quarter };
}

/** Adoption on the curve alone at (year, quarter): straight lines between points. */
export function curveLevel(curve: CurvePoint[], year: number, quarter: number): number {
  const at = index(year, quarter);
  const first = curve[0];
  if (!first || at < index(first.year, first.quarter)) return 0;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    const ia = index(a.year, a.quarter);
    const ib = index(b.year, b.quarter);
    if (at < ib) return round4(a.level + ((b.level - a.level) * (at - ia)) / (ib - ia));
  }
  return curve[curve.length - 1]!.level;
}

/** The house's local push for a technology: `per_section` for each open section of its ventures of that technology (any not failed), capped. */
export function localPush(state: GameState, tech: TechnologyType): number {
  if (!tech.ventures.length || tech.per_section <= 0) return 0;
  const sections = state.ventures.filter((v) => tech.ventures.includes(v.type) && v.status !== "failed").reduce((s, v) => s + v.sections_open, 0);
  return round4(Math.min(tech.local_cap, sections * tech.per_section));
}

/** Adoption of a technology this quarter (0 when unknown, as in a state from before C4). */
export function adoption(state: GameState, tech: string): number {
  return state.progress.adoption?.[tech] ?? 0;
}

/** Multiplier on a sector's earnings this quarter from every technology that touches it. 1 for untouched sectors. */
export function sectorFactor(state: GameState, sector: string, data: GameData): number {
  let f = 1;
  for (const e of data.progress.sectors) if (e.sector === sector) f *= 1 + (e.at_full - 1) * adoption(state, e.tech);
  return round4(f);
}

/** The stage that opens a venture type, if any. */
export const openingStage = (data: GameData, ventureId: string) => data.progress.stages.find((s) => s.opens?.includes(ventureId));

/**
 * Why a venture type cannot be backed this quarter, or null if it can. A type opened by a stage
 * opens on the stage's date, or earlier once the stage is reached early; any other type waits for
 * its `unlock_year`.
 */
export function ventureBlocked(state: GameState, type: VentureType, data: GameData): string | null {
  const stage = openingStage(data, type.id);
  if (!stage) return state.world.year < type.unlock_year ? `Not before ${type.unlock_year}` : null;
  if (state.progress.stages?.includes(stage.id)) return null;
  if (index(state.world.year, state.world.quarter) >= index(stage.year, stage.quarter)) return null;
  return `Not before ${stage.quarter === 1 ? stage.year : `${stage.year} Q${stage.quarter}`}`;
}

/** Can the house back this venture type this quarter? */
export const ventureOpen = (state: GameState, type: VentureType, data: GameData) => ventureBlocked(state, type, data) === null;

/**
 * How many quarters news from `place` takes to reach Frankfurt: `base` until a telegraph line to
 * it opens, then 0. The hook for C1's `newsDelay`; nothing calls it until C1 merges.
 */
export function telegraphDelay(state: GameState, data: GameData, place: string, base: number): number {
  const now = index(state.world.year, state.world.quarter);
  const linked = data.progress.telegraph_lines.some((l) => l.place === place && index(l.year, l.quarter) <= now);
  return linked ? 0 : base;
}

/** Adoption and local push for (year, quarter) from the curves and the house's ventures. */
function levels(state: GameState | null, year: number, quarter: number, data: GameData): Pick<ProgressState, "adoption" | "local"> {
  const adoptionOut: Record<string, number> = {};
  const local: Record<string, number> = {};
  for (const t of data.progress.technologies) {
    local[t.id] = state ? localPush(state, t) : 0;
    const base = curveLevel(t.curve, year, quarter);
    // The local push only speeds a technology that has arrived.
    adoptionOut[t.id] = base > 0 ? round4(Math.min(1, base + local[t.id]!)) : 0;
  }
  return { adoption: adoptionOut, local };
}

/** Progress at the start: adoption for the start date, and stages dated on or before it reached without news. */
export function createProgress(data: GameData, _rng: Rng): ProgressState {
  const { year, quarter } = data.tuning.start;
  const now = index(year, quarter);
  return { ...levels(null, year, quarter, data), stages: data.progress.stages.filter((s) => index(s.year, s.quarter) <= now).map((s) => s.id) };
}

function news(state: GameState, text: string, title?: string): void {
  state.news.push({ turn: state.world.turn, kind: "event", text, ...(title ? { title } : {}) });
}

/** Drifts every borrower in a touched trade by the change in adoption. Mutates `state`. */
function driftTrades(state: GameState, before: Record<string, number>, data: GameData): void {
  const { min, max } = data.progress.quality_bounds;
  for (const e of data.progress.trades) {
    const was = before[e.tech] ?? 0;
    const now = adoption(state, e.tech);
    if (now === was) continue;
    const turnover = (1 + (e.turnover_at_full - 1) * now) / (1 + (e.turnover_at_full - 1) * was);
    for (const b of state.borrowers) {
      if (b.trade !== e.trade) continue;
      b.quality = round4(clamp(b.quality + e.quality_at_full * (now - was), min, max));
      b.books.turnover = Math.round(b.books.turnover * turnover);
    }
  }
}

/**
 * The system's End Turn step, after next quarter's events fire: adoption for next quarter (curves
 * plus the house's open sections), stages due next quarter (news, ventures opened; a stage with an
 * early date comes from then if the house has a section of its technology open), then borrowers in
 * touched trades drift. No random draws. Mutates `state`.
 */
export function resolveProgress(state: GameState, _rng: Rng, data: GameData): void {
  const coming = following(state.world.year, state.world.quarter);
  const at = index(coming.year, coming.quarter);
  const before = { ...(state.progress.adoption ?? {}) };
  state.progress = { ...levels(state, coming.year, coming.quarter, data), stages: [...(state.progress.stages ?? [])] };

  for (const s of data.progress.stages) {
    if (state.progress.stages.includes(s.id)) continue;
    const due = at >= index(s.year, s.quarter);
    const early = !due && s.early && at >= index(s.early.year, s.early.quarter) && (state.progress.local[s.tech] ?? 0) > 0;
    if (!due && !early) continue;
    state.progress.stages.push(s.id);
    if (early) news(state, `${s.early!.text} ${s.text ?? ""}`.trim(), s.title);
    else if (s.text) news(state, s.text, s.title);
  }
  driftTrades(state, before, data);
}

/** One line on every technology: its adoption, or "not yet". For the terminal. */
export function progressLine(state: GameState, data: GameData): string {
  const parts = data.progress.technologies.map((t) => {
    const a = adoption(state, t.id);
    const local = state.progress.local?.[t.id] ?? 0;
    return `${t.name} ${a > 0 ? `${Math.round(a * 100)}%${local > 0 ? ` (house +${Math.round(local * 100)})` : ""}` : "not yet"}`;
  });
  return `Progress: ${parts.join(", ")}`;
}

export const isProgressDecision = (_d: Decision): _d is ProgressDecision => false;

export function applyProgressDecision(_state: GameState, d: ProgressDecision, _data: GameData): DecisionResult {
  return d;
}

export function describeProgressDecision(d: ProgressDecision, _state: GameState, _data: GameData): string {
  return d;
}
