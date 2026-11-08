// What the Progress panel shows: each technology's adoption with its sums, its dated stages and
// what each opens, the sectors and trades it moves, and the telegraph lines. Built from C4's own
// functions (src/sim/systems/progress.ts). No borrower quality number leaves here: trades are
// described by direction only.
import { adoption, curveLevel, sectorFactor, ventureBlocked, type Stage, type TechnologyType } from "../../sim/systems/progress";
import type { GameData } from "../../sim/tuning";
import type { GameState } from "../../sim/types";
import type { Section } from "./breakdowns";

const pctOf = (r: number) => `${Math.round(r * 1000) / 10}%`;
const dateWords = (s: { year: number; quarter: number }) => `${s.year} Q${s.quarter}`;

export interface StageView {
  stage: Stage;
  title: string;
  date: string;
  reached: boolean;
  /** Venture names it opens, and whether each can be backed now. */
  opens: { id: string; name: string; open: boolean }[];
  early: string | null;
}

export interface TechView {
  tech: TechnologyType;
  adoption: number;
  curve: number;
  local: number;
  /** Words for the bar: "not yet arrived", "34%". */
  label: string;
  sections: Section[];
  stages: StageView[];
  /** Sectors it touches: earnings now and at full adoption. */
  sectors: { sector: string; now: number; atFull: number }[];
  trades: { trade: string; words: string }[];
  next: StageView | null;
}

/** The sums behind a technology's adoption: the curve, plus the house's push once it has arrived, capped at 100%. */
export function adoptionSections(state: GameState, t: TechnologyType, data: GameData): Section[] {
  const { year, quarter } = state.world;
  const curve = curveLevel(t.curve, year, quarter);
  const local = state.progress.local?.[t.id] ?? 0;
  const a = adoption(state, t.id);
  const ventures = t.ventures.map((id) => data.ventures.find((v) => v.id === id)?.name ?? id);
  const sections: Section[] = [
    {
      heading: "Adoption this quarter",
      lines: [
        { label: "Across the German lands, on the dated curve", value: pctOf(curve) },
        ...(t.ventures.length
          ? [{ label: curve > 0 ? "Plus the house's own push" : "The house's push (only once it has arrived)", value: `+ ${pctOf(local)}` }]
          : []),
      ],
      total: { label: "Adoption", value: pctOf(a) },
    },
    {
      heading: "The curve",
      lines: t.curve.map((p) => ({ label: dateWords(p), value: pctOf(p.level) })),
    },
  ];
  if (t.ventures.length)
    sections.push({
      heading: "The house's push",
      lines: [
        { label: `Each open section of ${ventures.join(" or ")}`, value: `+ ${pctOf(t.per_section)}` },
        { label: "At most", value: pctOf(t.local_cap) },
      ],
    });
  return sections;
}

function stageView(state: GameState, s: Stage, data: GameData): StageView {
  const reached = state.progress.stages?.includes(s.id) ?? false;
  return {
    stage: s,
    title: s.title ?? (s.opens?.length ? `${s.opens.map((id) => data.ventures.find((v) => v.id === id)?.name ?? id).join(", ")} open` : "A step forward"),
    date: dateWords(s),
    reached,
    opens: (s.opens ?? []).map((id) => {
      const v = data.ventures.find((x) => x.id === id);
      return { id, name: v?.name ?? id, open: v ? ventureBlocked(state, v, data) === null : false };
    }),
    early: s.early && !reached ? `Comes as early as ${dateWords(s.early)} if the house already has a section of it open.` : null,
  };
}

const TRADE_WORDS = (quality: number, turnover: number) =>
  `${quality < 0 ? "grow weaker" : "grow sounder"}, turnover ${turnover < 1 ? "falls" : "rises"} toward ${Math.round(turnover * 100)}% at full adoption`;

export function techViews(state: GameState, data: GameData): TechView[] {
  return data.progress.technologies.map((t) => {
    const a = adoption(state, t.id);
    const stages = data.progress.stages.filter((s) => s.tech === t.id).map((s) => stageView(state, s, data));
    return {
      tech: t,
      adoption: a,
      curve: curveLevel(t.curve, state.world.year, state.world.quarter),
      local: state.progress.local?.[t.id] ?? 0,
      label: a > 0 ? pctOf(a) : `not yet; arrives ${t.curve[0] ? dateWords(t.curve[0]) : "later"}`,
      sections: adoptionSections(state, t, data),
      stages,
      sectors: data.progress.sectors.filter((e) => e.tech === t.id).map((e) => ({ sector: e.sector, now: 1 + (e.at_full - 1) * a, atFull: e.at_full })),
      trades: data.progress.trades.filter((e) => e.tech === t.id).map((e) => ({ trade: e.trade, words: TRADE_WORDS(e.quality_at_full, e.turnover_at_full) })),
      next: stages.find((s) => !s.reached) ?? null,
    };
  });
}

/** Each sector's earnings multiplier from every technology at once (the sim's own factor). */
export function sectorRows(state: GameState, data: GameData): { sector: string; factor: number }[] {
  const sectors = [...new Set(data.progress.sectors.map((e) => e.sector))];
  return sectors.map((sector) => ({ sector, factor: sectorFactor(state, sector, data) }));
}

/** Telegraph lines to Frankfurt and whether each is open. */
export function telegraphRows(state: GameState, data: GameData): { place: string; date: string; open: boolean }[] {
  const now = state.world.year * 4 + state.world.quarter;
  return data.progress.telegraph_lines.map((l) => ({
    place: data.europe.cities.find((c) => c.id === l.place)?.name ?? l.place,
    date: dateWords(l),
    open: l.year * 4 + l.quarter <= now,
  }));
}
