import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { lenders, lendingTerms } from "../src/sim/crisis";
import { applyDecisions } from "../src/sim/decisions";
import { conditionsMet } from "../src/sim/events";
import { changeOpinion, checkHouseData, createHouses, houseRanking, opinionWord, resolveHouses, tradingHouses } from "../src/sim/houses";
import { describeOption } from "../src/sim/letters";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { createRng } from "../src/sim/rng";
import { parseSave, toSave } from "../src/sim/save";
import { endTurn } from "../src/sim/turn";
import type { GameState } from "../src/sim/types";
import { fixedRng, fresh, noDefaults, quiet } from "./helpers";

const { tuning } = gameData;
const t = tuning.houses;
const MID = 0.5; // a noise roll of 0.5 adds nothing
const CALM = 0.999999;

/** A trait-free test game with only the named houses, their heads all 40 unless set. */
function withHouses(...ids: string[]): GameState {
  const s = fresh();
  s.houses = createHouses(gameData).filter((h) => ids.includes(h.id));
  for (const h of s.houses) h.head.birth_year = s.world.year - 40;
  return s;
}

/** Counts the rolls a call draws, answering each with `value`. */
function counting(value: number) {
  const rng = { draws: 0, next: () => (rng.draws++, value) };
  return rng;
}

describe("house data", () => {
  it("is sound, and a new game starts with every house trading", () => {
    expect(checkHouseData(gameData)).toEqual([]);
    const s = newGame(gameData, createRng(1));
    expect(s.houses.map((h) => h.id)).toEqual(gameData.houses.houses.map((h) => h.id));
    expect(s.houses.every((h) => h.failed_turn === null && h.wealth === h.start_wealth && h.opinion === h.baseline)).toBe(true);
  });

  it("catches a bad file", () => {
    const bad = { ...gameData, houses: { ...gameData.houses, houses: [{ ...gameData.houses.houses[0]!, opinion: 300, temperament: "timid" as never }] } };
    expect(checkHouseData(bad)).toEqual(["kessler: unknown temperament \"timid\"", "kessler: opinion must be -100 to 100"]);
  });
});

describe("a house's quarter", () => {
  it("in a calm market, wealth grows by its temperament's rate and reputation rises", () => {
    const s = withHouses("albrecht", "winter");
    const [a, w] = s.houses;
    resolveHouses(s, fixedRng(MID), gameData);
    expect(a!.wealth).toBe(Math.round(500_000 * (1 + t.growth.cautious)));
    expect(w!.wealth).toBe(Math.round(150_000 * (1 + t.growth.bold)));
    expect(a!.reputation).toBe(71);
  });

  it("a panic hits bold houses harder than cautious ones", () => {
    const s = withHouses("albrecht", "winter");
    s.world.sentiment = "panic";
    // Rolls per house: noise (0.5), then the failure roll (none fails).
    resolveHouses(s, fixedRng(MID, CALM, MID, CALM), gameData);
    const [a, w] = s.houses;
    expect(a!.wealth / a!.start_wealth - 1).toBeCloseTo(t.growth.cautious + t.shock.panic.cautious, 4);
    expect(w!.wealth / w!.start_wealth - 1).toBeCloseTo(t.growth.bold + t.shock.panic.bold, 4);
    // Noise of 0 counts as a good quarter (+1), and a bold house loses a point in a panic: no change.
    expect(w!.reputation).toBe(50);
    expect(a!.reputation).toBe(71);
  });

  it("opinion drifts toward the house's baseline", () => {
    const s = withHouses("stellmann");
    s.houses[0]!.opinion = 80;
    resolveHouses(s, fixedRng(MID), gameData);
    expect(s.houses[0]!.opinion).toBe(Math.round(80 + (20 - 80) * t.opinion.drift));
  });

  it("draws one roll per house in calm, plus a death roll for old heads and a failure roll in a panic", () => {
    const s = withHouses("albrecht", "winter");
    let rng = counting(CALM);
    resolveHouses(s, rng, gameData);
    expect(rng.draws).toBe(2);
    s.houses[0]!.head.birth_year = s.world.year - 70;
    rng = counting(CALM);
    resolveHouses(s, rng, gameData);
    expect(rng.draws).toBe(3);
    s.world.sentiment = "panic";
    rng = counting(CALM);
    resolveHouses(s, rng, gameData);
    expect(rng.draws).toBe(5);
  });
});

describe("a head dies", () => {
  it("the heir takes over, a new heir is named, and opinion moves halfway home", () => {
    const s = withHouses("kessler");
    const h = s.houses[0]!;
    h.head.birth_year = s.world.year - 70;
    h.opinion = 50;
    // Rolls: noise, then death (0: dies).
    resolveHouses(s, fixedRng(MID, 0), gameData);
    expect(h.head.name).toBe("Friedrich Kessler");
    expect(h.heir.name).toBe(`${gameData.houses.heir_names[0]} Kessler`);
    expect(h.heir.birth_year).toBeLessThan(s.world.year);
    const drifted = Math.round(50 + (-30 - 50) * t.opinion.drift);
    expect(h.opinion).toBe(Math.round(drifted + (-30 - drifted) * t.opinion.succession_reset));
  });

  it("is in the news", () => {
    const s0 = withHouses("kessler");
    s0.houses[0]!.head.birth_year = s0.world.year - 70;
    // Rolls: the house's noise and death rolls (houses come before the mood roll), then the mood and the event roll.
    const s1 = endTurn(s0, [], fixedRng(MID, 0, CALM, CALM), quiet);
    expect(s1.news.find((n) => n.kind === "houses")!.text).toBe("Anton Kessler of Bankhaus Kessler has died, aged 70. Friedrich Kessler takes over the house.");
  });
});

describe("a house fails in a panic", () => {
  it("closes its doors, and some of its depositors come to the player, more for a good name", () => {
    const s = withHouses("rautenberg");
    s.world.sentiment = "panic";
    const cash = s.house.cash;
    const deposits = s.house.deposits;
    // Rolls: noise, then failure (0: fails).
    resolveHouses(s, fixedRng(MID, 0), gameData);
    const h = s.houses[0]!;
    expect(h.failed_turn).toBe(s.world.turn);
    const amount = Math.round((t.depositors_share * h.wealth * s.house.reputation) / 100 / 100) * 100;
    expect(amount).toBeGreaterThan(0);
    expect(s.house.cash).toBe(cash + amount);
    expect(s.house.deposits).toBe(deposits + amount);
    expect(accountBalance(s, "cash")).toBe(s.house.cash);
    expect(accountBalance(s, "deposits")).toBe(s.house.deposits);
    expect(tradingHouses(s)).toEqual([]);
  });

  it("is weaker the further it has fallen: the chance scales with start wealth over wealth, up to three times", () => {
    const chance = (wealthShare: number) => {
      const s = withHouses("winter");
      s.world.sentiment = "panic";
      s.houses[0]!.wealth = Math.round(s.houses[0]!.start_wealth * wealthShare);
      let failRoll = 0;
      let i = 0;
      // The failure roll is the second; find the highest roll that still fails by bisection on a threshold.
      let lo = 0, hi = 1;
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2;
        const copy = structuredClone(s);
        i = 0;
        resolveHouses(copy, { next: () => (i++ === 0 ? MID : mid) }, gameData);
        if (copy.houses[0]!.failed_turn !== null) lo = mid;
        else hi = mid;
        failRoll = lo;
      }
      return failRoll;
    };
    const after = 1 + t.growth.bold + t.shock.panic.bold;
    expect(chance(1)).toBeCloseTo(t.fail_chance.bold * Math.max(0.5, 1 / after), 4);
    expect(chance(0.1)).toBeCloseTo(t.fail_chance.bold * 3, 4);
    expect(chance(5)).toBeCloseTo(t.fail_chance.bold * 0.5, 4);
  });

  it("draws nothing once failed, and is in the news with what came to the player", () => {
    const s0 = withHouses("rautenberg");
    s0.world.sentiment = "panic";
    // Rolls: the house's noise and failure rolls, then the mood and the event roll.
    const s1 = endTurn(s0, [], fixedRng(MID, 0, CALM, CALM), quiet);
    expect(s1.news.find((n) => n.kind === "houses")!.text).toMatch(/^Rautenberg & Co\. has closed its doors in the panic\. Some of its depositors bring [\d,]+\sfl\. to your house\.$/);
    const rng = counting(0);
    resolveHouses(s1, rng, gameData);
    expect(rng.draws).toBe(0);
  });
});

describe("opinion", () => {
  it("stays within its limits, and a failed house's no longer changes", () => {
    const s = withHouses("albrecht", "winter");
    changeOpinion(s, "albrecht", 500, tuning);
    expect(s.houses[0]!.opinion).toBe(t.opinion.max);
    changeOpinion(s, "albrecht", -500, tuning);
    expect(s.houses[0]!.opinion).toBe(t.opinion.min);
    s.houses[1]!.failed_turn = 1;
    changeOpinion(s, "winter", 30, tuning);
    expect(s.houses[1]!.opinion).toBe(10);
  });

  it("reads as a word", () => {
    expect([80, 30, 0, -30, -80].map(opinionWord)).toEqual(["Warm", "Friendly", "Neutral", "Cool", "Hostile"]);
  });
});

describe("ranking", () => {
  it("puts every trading house and the player in order of wealth", () => {
    const s = withHouses("albrecht", "rautenberg", "winter");
    s.houses.find((h) => h.id === "winter")!.failed_turn = 1;
    expect(houseRanking(s, 100_000).map((r) => r.name)).toEqual(["Bankhaus Albrecht", s.house.name, "Rautenberg & Co."]);
  });
});

describe("saves", () => {
  it("keep the houses, and refuse a file without them", () => {
    const s = withHouses("kessler");
    const r = parseSave(toSave(s, 1, 1, []), quiet);
    expect(r.ok && r.save.state.houses).toEqual(s.houses);
    const old = { ...s } as Partial<GameState>;
    delete old.houses;
    const bad = parseSave(toSave(old as GameState, 1, 1, []), quiet);
    expect(bad.ok ? "" : bad.reason).toBe('Save file state is missing "houses"');
  });
});

describe("full runs", () => {
  it("houses grow, some fail in panics, and every failure is paid into the books", () => {
    let failures = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const rng = createRng(seed);
      let s = newGame(gameData, rng);
      while (s.world.year < 1850 && s.house.status === "solvent") s = endTurn(s, [], rng, gameData);
      failures += s.houses.filter((h) => h.failed_turn !== null).length;
      expect(accountBalance(s, "cash"), `seed ${seed}`).toBe(s.house.cash);
      expect(s.houses.every((h) => h.opinion >= t.opinion.min && h.opinion <= t.opinion.max)).toBe(true);
    }
    expect(failures).toBeLessThan(20 * gameData.houses.houses.length);
  });
});

describe("courting a house", () => {
  const court = (s: GameState, house: string) => applyDecisions(s, [{ kind: "court_house", house }], gameData);

  it("costs cash and one action, writes the ledger, and raises that house's opinion", () => {
    const s0 = withHouses("albrecht");
    const r = court(s0, "albrecht");
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.house.cash).toBe(s0.house.cash - t.court.cost);
    expect(r.state.actions_this_turn).toBe(1);
    expect(r.state.houses[0]!.opinion).toBe(t.court.opinion);
    expect(r.state.ledger.at(-1)).toMatchObject({ account: "cash", category: "courting", amount: -t.court.cost, note: "Courting Bankhaus Albrecht" });
  });

  it("refuses a failed or unknown house, a house at the top, and too little free cash", () => {
    const s = withHouses("albrecht", "winter");
    s.houses[1]!.failed_turn = 1;
    const reason = (house: string, st = s) => { const r = court(st, house); return r.ok ? null : r.reason; };
    expect(reason("winter")).toBe("Gebrüder Winter has failed");
    expect(reason("nobody")).toBe('Unknown house "nobody"');
    s.houses[0]!.opinion = t.opinion.max;
    expect(reason("albrecht")).toBe("Bankhaus Albrecht could not think better of your house");
    const poor = withHouses("albrecht");
    poor.house.reserve = poor.house.cash;
    expect(reason("albrecht", poor)).toMatch(/^Not enough cash above the reserve/);
  });
});

describe("borrowing from the houses", () => {
  const l = tuning.crisis.lending;
  const panic = () => {
    const s = fresh();
    s.houses = createHouses(gameData);
    s.world.sentiment = "panic";
    return s;
  };

  it("a house's rate falls as its opinion rises", () => {
    const s = panic();
    const h = s.houses.find((x) => x.id === "stellmann")!;
    expect(lendingTerms(s, h, tuning).rate).toBeCloseTo(l.base_rate - (l.rate_per_opinion * 20) / 100, 6);
    h.opinion = 100;
    expect(lendingTerms(s, h, tuning).rate).toBeCloseTo(l.base_rate - l.rate_per_opinion, 6);
  });

  it("a house that thinks poorly of you refuses, and none lends past its share of wealth or the overall cap", () => {
    const s = panic();
    const kessler = lendingTerms(s, s.houses.find((x) => x.id === "kessler")!, tuning);
    expect(kessler.refused).toBe(`Bankhaus Kessler thinks too poorly of your house to lend (opinion -30, needs ${l.min_opinion})`);
    expect(lendingTerms(s, s.houses.find((x) => x.id === "rautenberg")!, tuning).room).toBe(80_000 * l.wealth_share);
    expect(lendingTerms(s, s.houses.find((x) => x.id === "albrecht")!, tuning).room).toBe(l.max_outstanding);
  });

  it("lists the cheapest willing lender first and those who refuse last", () => {
    const ids = lenders(panic(), tuning).map((x) => x.house.id);
    expect(ids[0]).toBe("stellmann");
    expect(ids.at(-1)).toBe("kessler");
  });

  it("repaying on time raises the lender's opinion", () => {
    const r = applyDecisions(panic(), [{ kind: "borrow", house: "stellmann", amount: 10_000 }], gameData);
    if (!r.ok) throw new Error(r.reason);
    let s = r.state;
    for (let i = 0; i < l.term_quarters; i++) s = endTurn(s, [], noDefaults, quiet);
    const drift = s.houses.find((x) => x.id === "stellmann")!;
    expect(s.debts[0]!.status).toBe("repaid");
    // Drift holds opinion at its baseline of 20, so the repayment shows as +5 over it.
    expect(drift.opinion).toBe(20 + l.repaid_opinion);
  });

  it("suspending withdrawals lowers every house's opinion", () => {
    const r = applyDecisions(panic(), [{ kind: "suspend" }], gameData);
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.houses.map((h) => h.opinion)).toEqual(createHouses(gameData).map((h) => h.opinion - tuning.crisis.suspend.opinion_cost));
  });
});

describe("houses in events", () => {
  it("house_opinion holds only for a trading house within its bounds", () => {
    const s = withHouses("kessler");
    const date = { year: 1815, quarter: 3 as const };
    expect(conditionsMet(s, { house_opinion: { house: "kessler", below: -20 } }, date)).toBe(true);
    expect(conditionsMet(s, { house_opinion: { house: "kessler", at_least: -20 } }, date)).toBe(false);
    expect(conditionsMet(s, { house_opinion: { house: "kessler" } }, date)).toBe(true);
    s.houses[0]!.failed_turn = 1;
    expect(conditionsMet(s, { house_opinion: { house: "kessler" } }, date)).toBe(false);
    expect(conditionsMet(s, { house_opinion: { house: "albrecht" } }, date)).toBe(false);
  });

  it("Winter's plea, answered, lends now and is repaid later, unless Winter has failed by then", () => {
    const data = { ...quiet, events: gameData.events.filter((e) => e.id.startsWith("winter-")) };
    const play = (failFirst: boolean) => {
      const s0 = withHouses("winter");
      s0.letters = [{ event: "winter-trouble", turn: 0, answer: null }];
      const r = applyDecisions(s0, [{ kind: "answer_letter", event: "winter-trouble", option: "help" }], data);
      if (!r.ok) throw new Error(r.reason);
      expect(r.state.house.cash).toBe(s0.house.cash - 5000);
      expect(r.state.houses[0]!.opinion).toBe(10 + 25);
      // Rolls: the follow-up's timing (0: next turn), then the house's noise, the mood and the event roll.
      let s = endTurn(r.state, [], fixedRng(0, MID, CALM, CALM), data);
      if (failFirst) s.houses[0]!.failed_turn = s.world.turn - 1;
      return endTurn(s, [], fixedRng(MID, CALM, CALM), data);
    };
    expect(play(false).fired_events.map((f) => f.id)).toEqual(["winter-repays"]);
    expect(play(true).fired_events).toEqual([]);
  });

  it("response cards say who must still be trading for a repayment", () => {
    const help = gameData.events.find((e) => e.id === "winter-trouble")!.options![0]!;
    const [opinion, repay] = describeOption(help, gameData).effects;
    expect(opinion).toBe("Gebrüder Winter's opinion of you +25");
    expect(repay).toMatch(/^within a year: Gebrüder Winter repays \(brings in 5,250\sfl\.\), if Gebrüder Winter is still trading$/);
  });
});
