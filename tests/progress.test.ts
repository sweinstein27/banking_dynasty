import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { applyDecision } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { ventureOffers } from "../src/sim/offers";
import { createRng, type Rng } from "../src/sim/rng";
import { parseSave, toSave } from "../src/sim/save";
import {
  adoption,
  createProgress,
  curveLevel,
  localPush,
  openingStage,
  progressLine,
  resolveProgress,
  sectorFactor,
  telegraphDelay,
  ventureBlocked,
  ventureOpen,
} from "../src/sim/systems/progress";
import { stepMarkets } from "../src/sim/systems/markets";
import { stepVentures } from "../src/sim/ventures";
import { endTurn } from "../src/sim/turn";
import type { GameData } from "../src/sim/tuning";
import type { GameState, Quarter, Venture } from "../src/sim/types";
import { backWhenOpen, DECLINE_SELL_AT, progressMakers, sellDeclining } from "../src/harness/systems/progress";
import { fresh, quiet } from "./helpers";

const p = gameData.progress;
const tech = (id: string) => p.technologies.find((t) => t.id === id)!;
const vtype = (id: string) => gameData.ventures.find((v) => v.id === id)!;

/** Fails on any draw: progress must roll nothing. */
const noDraws: Rng = {
  next: () => {
    throw new Error("progress drew a random number");
  },
};

/** A fresh house moved to (year, quarter) with progress set for that quarter, as if it had played there. */
function at(year: number, quarter: Quarter, s: GameState = fresh()): GameState {
  s.world.year = year;
  s.world.quarter = quarter;
  // Settle progress for this quarter by resolving from the quarter before.
  const prev = quarter === 1 ? { year: year - 1, quarter: 4 as Quarter } : { year, quarter: (quarter - 1) as Quarter };
  const real = { ...s.world };
  s.world.year = prev.year;
  s.world.quarter = prev.quarter;
  resolveProgress(s, noDraws, gameData);
  s.world.year = real.year;
  s.world.quarter = real.quarter;
  s.news = [];
  return s;
}

/** A house's venture of `type` with `sections` open, enough for the local push. */
function venture(type: string, sections: number, status: Venture["status"] = "active"): Venture {
  return { id: 99, type, status, sections_open: sections, start_turn: 1 } as Venture;
}

describe("data", () => {
  it("every stage, sector and trade names a known technology, and curves run forward", () => {
    const ids = p.technologies.map((t) => t.id);
    for (const s of p.stages) expect(ids).toContain(s.tech);
    for (const e of p.sectors) expect(ids).toContain(e.tech);
    for (const e of p.trades) expect(ids).toContain(e.tech);
    for (const t of p.technologies) {
      const idx = t.curve.map((c) => c.year * 4 + c.quarter);
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
      for (const c of t.curve) expect(c.level).toBeGreaterThan(0);
      for (const c of t.curve) expect(c.level).toBeLessThanOrEqual(1);
    }
  });

  it("sectors and trades exist in the markets and borrower data", () => {
    const sectors = gameData.markets.sectors.map((s) => s.id);
    for (const e of p.sectors) expect(sectors).toContain(e.sector);
    const trades = gameData.borrowers.map((b) => b.trade);
    for (const e of p.trades) expect(trades).toContain(e.trade);
  });

  it("a stage opening a venture agrees with its unlock_year, and each venture opens in at most one stage", () => {
    for (const s of p.stages) {
      for (const id of s.opens ?? []) {
        expect(vtype(id).unlock_year).toBe(s.year);
        expect(p.stages.filter((x) => x.opens?.includes(id))).toHaveLength(1);
      }
    }
  });

  it("each technology's own ventures exist", () => {
    for (const t of p.technologies) for (const id of t.ventures) expect(vtype(id)).toBeDefined();
  });

  it("company listings line up with the wave that brings them", () => {
    const company = (id: string) => gameData.markets.companies.find((c) => c.id === id)!;
    const stage = (id: string) => p.stages.find((s) => s.id === id)!;
    const same = (c: string, s: string) => expect([company(c).list_year, company(c).list_quarter]).toEqual([stage(s).year, stage(s).quarter]);
    same("rhine_steam", "rhine-steamers-1827");
    same("main_gas", "frankfurt-gas-1828");
    same("continental_gas", "obermain-gasworks-1844");
    // Railway companies list after the first line.
    for (const c of gameData.markets.companies.filter((x) => x.sector === "railway")) expect(c.list_year).toBeGreaterThan(1835);
  });
});

describe("curveLevel", () => {
  const curve = [
    { year: 1830, quarter: 1 as Quarter, level: 0.2 },
    { year: 1831, quarter: 1 as Quarter, level: 0.6 },
  ];
  it("is 0 before the first point, the last level after the last, and straight between", () => {
    expect(curveLevel(curve, 1829, 4)).toBe(0);
    expect(curveLevel(curve, 1830, 1)).toBe(0.2);
    expect(curveLevel(curve, 1830, 3)).toBe(0.4);
    expect(curveLevel(curve, 1831, 1)).toBe(0.6);
    expect(curveLevel(curve, 1850, 4)).toBe(0.6);
  });
  it("is 0 for an empty curve", () => {
    expect(curveLevel([], 1840, 1)).toBe(0);
  });
  it("follows the sourced railway anchors", () => {
    const r = tech("railway").curve;
    expect(curveLevel(r, 1835, 3)).toBe(0);
    expect(curveLevel(r, 1835, 4)).toBeGreaterThan(0);
    expect(curveLevel(r, 1840, 1)).toBe(0.1);
    expect(curveLevel(r, 1845, 1)).toBe(0.35);
  });
});

describe("createProgress", () => {
  it("starts with nothing adopted in 1815 and draws nothing", () => {
    const s = createProgress(gameData, noDraws);
    expect(Object.values(s.adoption).every((a) => a === 0)).toBe(true);
    expect(s.stages).toEqual([]);
  });
  it("a later start reaches earlier stages without news", () => {
    const data: GameData = { ...gameData, tuning: { ...gameData.tuning, start: { ...gameData.tuning.start, year: 1840, quarter: 1 } } };
    const s = createProgress(data, noDraws);
    expect(s.stages).toContain("taunus-railway-1839");
    expect(s.stages).not.toContain("trunk-railways-1842");
    expect(s.adoption.railway).toBe(0.1);
  });
});

describe("resolveProgress", () => {
  it("sets next quarter's adoption and writes a stage's news once", () => {
    const s = fresh();
    s.world.year = 1827;
    s.world.quarter = 1;
    resolveProgress(s, noDraws, gameData);
    expect(adoption(s, "steam")).toBe(0.1);
    expect(s.progress.stages).toContain("rhine-steamers-1827");
    expect(s.news.filter((n) => n.title === "Steamers on the Rhine")).toHaveLength(1);
    s.world.quarter = 2;
    resolveProgress(s, noDraws, gameData);
    expect(s.news.filter((n) => n.title === "Steamers on the Rhine")).toHaveLength(1);
  });

  it("writes no news for a stage an event already tells", () => {
    const s = at(1835, 4);
    expect(s.progress.stages).toContain("first-railway-1835");
    expect(s.news).toHaveLength(0);
  });

  it("over a whole run reaches every stage, in date order, drawing nothing of its own", () => {
    const s = fresh();
    for (let y = 1815; y <= 1850; y++) {
      for (const q of [1, 2, 3, 4] as Quarter[]) {
        s.world.year = y;
        s.world.quarter = q;
        resolveProgress(s, noDraws, gameData);
      }
    }
    const order = [...p.stages].sort((a, b) => a.year * 4 + a.quarter - (b.year * 4 + b.quarter)).map((x) => x.id);
    expect(s.progress.stages).toEqual(order);
    expect(adoption(s, "telegraph")).toBe(1);
  });

  it("does not move End Turn's other rolls: a run with progress plays the same dice", () => {
    const run = (data: GameData) => {
      const rng = createRng(7);
      let s = newGame(data, rng);
      for (let i = 0; i < 6; i++) s = endTurn(s, [], rng, data);
      return rng.next();
    };
    const empty: GameData = { ...gameData, progress: { ...p, technologies: [], stages: [], sectors: [], trades: [] } };
    expect(run(gameData)).toBe(run(empty));
  });
});

describe("local push", () => {
  it("counts open sections of the technology's ventures, not failed ones, capped", () => {
    const s = fresh();
    s.ventures.push(venture("railway", 2), venture("trunk_railway", 1, "listed"), venture("railway", 5, "failed"), venture("canal", 4));
    expect(localPush(s, tech("railway"))).toBe(0.06);
    s.ventures.push(venture("railway", 5));
    expect(localPush(s, tech("railway"))).toBe(tech("railway").local_cap);
    expect(localPush(s, tech("steam"))).toBe(0);
  });

  it("speeds a technology that has arrived, and never one that has not", () => {
    const before = at(1834, 1);
    before.ventures.push(venture("railway", 3));
    resolveProgress(before, noDraws, gameData);
    expect(adoption(before, "railway")).toBe(0);
    const s = at(1840, 1);
    const base = adoption(s, "railway");
    s.ventures.push(venture("railway", 3));
    resolveProgress(s, noDraws, gameData);
    expect(s.progress.local.railway).toBe(0.06);
    expect(adoption(s, "railway")).toBeCloseTo(curveLevel(tech("railway").curve, 1840, 2) + 0.06, 4);
    expect(adoption(s, "railway")).toBeGreaterThan(base);
  });

  it("brings the trunk railway stage forward from 1840 for a house with a railway running", () => {
    const plain = at(1840, 2);
    expect(ventureOpen(plain, vtype("trunk_railway"), gameData)).toBe(false);
    expect(ventureBlocked(plain, vtype("trunk_railway"), gameData)).toBe("Not before 1842");

    const s = at(1839, 4);
    s.ventures.push(venture("railway", 1));
    resolveProgress(s, noDraws, gameData);
    expect(s.progress.stages).toContain("trunk-railways-1842");
    s.world.year = 1840;
    s.world.quarter = 1;
    expect(ventureOpen(s, vtype("trunk_railway"), gameData)).toBe(true);
    expect(s.news.find((n) => n.title === "Trunk lines planned")!.text).toMatch(/come early/);
  });

  it("does not bring a stage forward before its early date", () => {
    const s = at(1838, 1);
    s.ventures.push(venture("railway", 2));
    resolveProgress(s, noDraws, gameData);
    expect(s.progress.stages).not.toContain("trunk-railways-1842");
  });
});

describe("ventures open by stage", () => {
  it("gasworks open with gas in 1828 Q3, railways in 1836", () => {
    expect(ventureBlocked(at(1828, 2), vtype("gasworks"), gameData)).toBe("Not before 1828 Q3");
    expect(ventureOpen(at(1828, 3), vtype("gasworks"), gameData)).toBe(true);
    expect(ventureOpen(at(1835, 4), vtype("railway"), gameData)).toBe(false);
    expect(ventureOpen(at(1836, 1), vtype("railway"), gameData)).toBe(true);
    expect(openingStage(gameData, "brewery")).toBeUndefined();
  });

  it("a venture in no stage still opens by its unlock_year", () => {
    expect(ventureBlocked(at(1837, 4), vtype("mine"), gameData)).toBe("Not before 1838");
    expect(ventureOpen(at(1838, 1), vtype("mine"), gameData)).toBe(true);
  });

  it("opens by date even in a state whose stages were never recorded (a save from before C4)", () => {
    const s = fresh();
    s.world.year = 1843;
    s.progress = {} as GameState["progress"];
    expect(ventureOpen(s, vtype("trunk_railway"), gameData)).toBe(true);
    expect(adoption(s, "railway")).toBe(0);
    expect(sectorFactor(s, "canal", gameData)).toBe(1);
  });

  it("the decision and the offer use the same rule", () => {
    const s = at(1828, 2);
    s.house.cash = 50000;
    const r = applyDecision(s, { kind: "invest_venture", venture: "gasworks", amount: 10000 }, gameData);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not before 1828 q3/);
    expect(ventureOffers(s, gameData).find((o) => o.id === "gasworks")!.blocked).toBe("Not before 1828 Q3");
    const later = at(1828, 3);
    later.house.cash = 50000;
    expect(applyDecision(later, { kind: "invest_venture", venture: "gasworks", amount: 10000 }, gameData).ok).toBe(true);
  });
});

describe("sectorFactor", () => {
  it("is 1 before any technology arrives", () => {
    const s = at(1820, 1);
    for (const sec of gameData.markets.sectors) expect(sectorFactor(s, sec.id, gameData)).toBe(1);
  });

  it("scales with adoption: canals fall and railways rise as railways spread", () => {
    const s = fresh();
    s.progress.adoption = { railway: 0.5, steam: 0, gas: 0, telegraph: 0 };
    expect(sectorFactor(s, "canal", gameData)).toBe(0.8);
    expect(sectorFactor(s, "railway", gameData)).toBe(1.075);
    expect(sectorFactor(s, "bank", gameData)).toBe(1);
  });

  it("multiplies the effects of two technologies on one sector", () => {
    const s = fresh();
    s.progress.adoption = { railway: 1, steam: 1, gas: 0, telegraph: 0 };
    expect(sectorFactor(s, "shipping", gameData)).toBeCloseTo(1.15 * 0.85, 4);
  });

  it("lowers a listed canal company's earnings with the same roll", () => {
    const earn = (railway: number) => {
      const s = fresh();
      const c = s.markets.companies[0]!;
      c.status = "listed";
      c.sector = "canal";
      s.markets.companies = [c];
      s.progress.adoption = { railway, steam: 0, gas: 0, telegraph: 0 };
      stepMarkets(s, { next: () => 0.5 }, gameData);
      return s.markets.companies[0]!.earnings.at(-1)!;
    };
    expect(earn(1)).toBeLessThan(earn(0));
  });

  it("lowers a running canal venture's earnings with the same roll", () => {
    const earn = (railway: number) => {
      const s = fresh();
      s.ventures.push({
        ...venture("canal", 0),
        invested: 100000,
        committed: 100000,
        called: 100000,
        calls: 16,
        calls_paid: 16,
        calls_stopped: false,
        term_quarters: 64,
        phase: "running",
        earnings: [],
        run_start_turn: 1,
        company: null,
        start_turn: s.world.turn - 70,
      } as Venture);
      s.progress.adoption = { railway, steam: 0, gas: 0, telegraph: 0 };
      stepVentures(s, { next: () => 0.5 }, gameData);
      return s.ventures[0]!.earnings.at(-1)!;
    };
    expect(earn(1)).toBeLessThan(earn(0));
  });
});

describe("trades", () => {
  /** The test house with its four borrowers given real trades. */
  function traded(year: number): GameState {
    const s = at(year, 1);
    ["river freight", "ironmonger", "cloth merchants", "timber"].forEach((t, i) => (s.borrowers[i]!.trade = t));
    return s;
  }

  it("river freight loses quality and turnover as railways spread; ironmongers gain", () => {
    const s = traded(1840);
    const river = s.borrowers.find((b) => b.trade === "river freight")!;
    const iron = s.borrowers.find((b) => b.trade === "ironmonger")!;
    const q0 = river.quality;
    const t0 = river.books.turnover;
    const iq0 = iron.quality;
    s.world.year = 1845;
    resolveProgress(s, noDraws, gameData);
    const d = adoption(s, "railway") - 0.1;
    expect(river.quality).toBeCloseTo(q0 - 0.2 * d, 3);
    expect(river.books.turnover).toBeLessThan(t0);
    expect(iron.quality).toBeGreaterThan(iq0);
  });

  it("keeps quality within the bounds", () => {
    const s = traded(1840);
    const river = s.borrowers.find((b) => b.trade === "river freight")!;
    river.quality = p.quality_bounds.min + 0.001;
    s.world.year = 1850;
    resolveProgress(s, noDraws, gameData);
    expect(river.quality).toBe(p.quality_bounds.min);
  });

  it("leaves other trades alone", () => {
    const s = traded(1840);
    const cloth = s.borrowers.find((b) => b.trade === "cloth merchants")!;
    const before = { q: cloth.quality, t: cloth.books.turnover };
    s.world.year = 1848;
    resolveProgress(s, noDraws, gameData);
    expect({ q: cloth.quality, t: cloth.books.turnover }).toEqual(before);
  });
});

describe("telegraphDelay (the hook for C1's newsDelay)", () => {
  it("keeps the courier's delay until the Berlin line opens in 1849 Q1, then 0", () => {
    expect(telegraphDelay(at(1848, 4), gameData, "berlin", 1)).toBe(1);
    expect(telegraphDelay(at(1849, 1), gameData, "berlin", 1)).toBe(0);
  });
  it("leaves unlinked places alone", () => {
    expect(telegraphDelay(at(1850, 1), gameData, "london", 2)).toBe(2);
  });
});

describe("saves and the terminal", () => {
  it("progress survives a save round trip", () => {
    const rng = createRng(3);
    let s = newGame(gameData, rng);
    s.world.year = 1839;
    s.world.quarter = 2;
    s = endTurn(s, [], rng, gameData);
    const back = parseSave(toSave(s, 3, 0, []), gameData);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.save.state.progress).toEqual(s.progress);
  });

  it("the summary line names every technology and the house's push", () => {
    const s = at(1841, 1);
    expect(progressLine(s, gameData)).toMatch(/Railways 1[0-9]%.*Electric telegraph not yet/);
    s.ventures.push(venture("railway", 2));
    resolveProgress(s, noDraws, gameData);
    expect(progressLine(s, gameData)).toMatch(/house \+4/);
  });
});

describe("harness makers", () => {
  it("investor and aggressive sell canal and shipping shares once railways reach the threshold", () => {
    const s = fresh();
    const c = s.markets.companies.find((x) => x.sector === "shipping")!;
    c.status = "listed";
    s.markets.shares[c.id] = 10;
    const sell = sellDeclining("railway", ["canal", "shipping"], DECLINE_SELL_AT);
    s.progress.adoption = { railway: DECLINE_SELL_AT - 0.01 };
    expect(sell(s)).toBeNull();
    s.progress.adoption = { railway: DECLINE_SELL_AT };
    expect(sell(s)).toEqual({ kind: "sell_shares", company: c.id, shares: 10 });
    expect(progressMakers("investor", s, gameData).early).toHaveLength(1);
    expect(progressMakers("cautious", s, gameData)).toEqual({ early: [], late: [] });
  });

  it("venture-heavy backs a trunk railway once it opens, then waits", () => {
    const back = backWhenOpen("trunk_railway", 8, 0.3, gameData);
    const shut = at(1841, 1);
    shut.house.cash = 200000;
    expect(back(shut)).toBeNull();
    const s = at(1842, 1);
    s.house.cash = 200000;
    const d = back(s);
    expect(d).toMatchObject({ kind: "invest_venture", venture: "trunk_railway" });
    const r = applyDecision(s, d!, quiet);
    expect(r.ok).toBe(true);
    if (r.ok) expect(back(r.state)).toBeNull();
  });
});
