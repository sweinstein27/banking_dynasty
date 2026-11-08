import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { poolFor } from "../src/sim/capacity";
import { applyDecision } from "../src/sim/decisions";
import { maxRate } from "../src/sim/borrowers";
import { createHouses } from "../src/sim/houses";
import { accountBalance } from "../src/sim/ledger";
import { createRng } from "../src/sim/rng";
import { wageBill } from "../src/sim/systems/counting";
import {
  createRivals,
  discoveryChance,
  hearChance,
  loanBuyer,
  paperCost,
  plotChance,
  resolveRivals,
  rivalBid,
  rivalLoanOffer,
  rivalLoanWords,
  rivalsBook,
  schemeChance,
  schemeTerms,
  stealChance,
  type RivalsData,
} from "../src/sim/systems/rivals";
import { netWorth } from "../src/sim/turn";
import type { GameData } from "../src/sim/tuning";
import type { Decision, GameState, OtherHouse } from "../src/sim/types";
import { fresh, quiet, TEST_TERM } from "./helpers";

type Patch = { [K in keyof RivalsData]?: Partial<RivalsData[K]> };

/** Quiet data with the real houses and rivals numbers patched section by section. */
function dataWith(patch: Patch = {}): GameData {
  const r = { ...gameData.rivals } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) r[k] = { ...(gameData.rivals as unknown as Record<string, object>)[k], ...v };
  // Real wages, so a rival's offer can beat one.
  return { ...quiet, houses: gameData.houses, counting: { ...quiet.counting, roles: gameData.counting.roles }, rivals: r as unknown as RivalsData };
}

const NONE = { cautious: 0, bold: 0 };
/** Real houses, but no poaching and no plots unless a test asks. */
const calmRivals = dataWith({ poach: { chance: NONE }, plots: { chance: NONE } });

function game(data: GameData = calmRivals): GameState {
  const s = fresh();
  s.houses = createHouses(data);
  return s;
}

const house = (s: GameState, id: string) => s.houses.find((h) => h.id === id)!;

function apply(s: GameState, d: Decision, data: GameData = calmRivals): GameState {
  const r = applyDecision(s, d, data);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

function reason(s: GameState, d: Decision, data: GameData = calmRivals): string {
  const r = applyDecision(s, d, data);
  if (r.ok) throw new Error("expected a refusal");
  return r.reason;
}

/** Every account this system touches agrees with its ledger. */
function balanced(s: GameState): void {
  expect(accountBalance(s, "rival_paper")).toBe(rivalsBook(s));
  expect(accountBalance(s, "cash")).toBe(s.house.cash);
  expect(accountBalance(s, "deposits")).toBe(s.house.deposits);
}

const rng = createRng(1);

describe("rivals: starting state", () => {
  it("draws nothing from the run's RNG and starts empty", () => {
    const a = createRng(7);
    const r = createRivals(gameData, a);
    expect(a.state).toBe(createRng(7).state);
    expect(r).toMatchObject({ next_id: 1, schemes: [], plots: [], poach_offers: [], paper: [], short_until: {} });
  });

  it("gives decisions their pools: schemes and counters take the head's time, matching a wage is free, paper is a deal", () => {
    expect(poolFor("scheme")).toBe("head");
    expect(poolFor("counter_plot")).toBe("head");
    expect(poolFor("match_wage")).toBeNull();
    expect(poolFor("buy_paper")).toBe("deals");
    expect(poolFor("present_paper")).toBe("deals");
  });

  it("does nothing for a bankrupt house", () => {
    const s = game(dataWith({ plots: { chance: { cautious: 1, bold: 1 } } }));
    s.house.status = "bankrupt";
    const before = JSON.stringify(s);
    resolveRivals(s, rng, dataWith({ plots: { chance: { cautious: 1, bold: 1 } } }));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("rivals: state loans", () => {
  const spite = dataWith({ contracts: { spite_chance: 1 } });
  it("a short-handed house does not bid", () => {
    const s = game();
    s.rivals.short_until.kessler = s.world.turn;
    expect(rivalBid(s, house(s, "kessler"), 0.02, null, calmRivals)).toBeNull();
  });

  it("a hostile house undercuts the player's bid by a step; a neutral one does not", () => {
    const s = game(spite);
    house(s, "kessler").opinion = -50;
    expect(rivalBid(s, house(s, "kessler"), 0.03, 0.02, spite)).toBe(0.0175);
    expect(rivalBid(s, house(s, "albrecht"), 0.03, 0.02, spite)).toBe(0.03);
    // No bid from the player, nothing to undercut; a lower bid is kept.
    expect(rivalBid(s, house(s, "kessler"), 0.03, null, spite)).toBe(0.03);
    expect(rivalBid(s, house(s, "kessler"), 0.015, 0.02, spite)).toBe(0.015);
    // Never below the floor.
    expect(rivalBid(s, house(s, "kessler"), 0.03, 0.0025, spite)).toBe(0.0025);
  });
});

describe("rivals: large borrowers", () => {
  it("offers nothing for a small request, and the best rate for a large one", () => {
    const s = game();
    expect(rivalLoanOffer(s, { amount: 5000, max_rate: 0.08 }, calmRivals)).toBeNull();
    // Kessler is bold (undercut 1%) and not yet spiteful at -30: 7%.
    expect(rivalLoanOffer(s, { amount: 20000, max_rate: 0.08 }, calmRivals)).toMatchObject({ rate: 0.07 });
  });

  it("a spiteful house undercuts further; a short-handed or poor house cannot compete", () => {
    const s = game();
    house(s, "kessler").opinion = -60;
    expect(rivalLoanOffer(s, { amount: 20000, max_rate: 0.08 }, calmRivals)).toMatchObject({ house: "kessler", rate: 0.065 });
    s.rivals.short_until.kessler = s.world.turn;
    expect(rivalLoanOffer(s, { amount: 20000, max_rate: 0.08 }, calmRivals)?.house).not.toBe("kessler");
    expect(rivalLoanOffer(s, { amount: 10_000_000, max_rate: 0.08 }, calmRivals)).toBeNull();
    s.houses = [];
    expect(rivalLoanOffer(s, { amount: 20000, max_rate: 0.08 }, calmRivals)).toBeNull();
  });

  it("the odds of losing the borrower rise with the gap, within limits, and are told in words", () => {
    expect(stealChance(0.07, 0.07, calmRivals)).toBe(0);
    expect(stealChance(0.075, 0.07, calmRivals)).toBeCloseTo(0.4);
    expect(stealChance(0.2, 0.07, calmRivals)).toBe(0.8);
    const s = game();
    expect(rivalLoanWords(s, { amount: 20000, max_rate: 0.08 }, 0.07, calmRivals)).toContain("stays with you");
    expect(rivalLoanWords(s, { amount: 20000, max_rate: 0.08 }, 0.08, calmRivals)).toContain("chance");
  });

  it("a borrower lured away repays the principal at End Turn, with ledger entries", () => {
    const sure = dataWith({ poach: { chance: NONE }, plots: { chance: NONE }, loans: { steal: { base: 1, per_point: 0, max: 1 } } });
    let s = game(sure);
    // Fair and Co. asks at the market's rate for its standing, as in play; the best rival offers 1% less.
    const top = maxRate(s.borrowers[1]!.market_quality, sure.tuning, "commercial", TEST_TERM);
    s.requests[1]!.max_rate = top;
    s = apply(s, { kind: "lend", borrower: 2, amount: 30000, rate: top }, sure);
    const cash = s.house.cash;
    resolveRivals(s, rng, sure);
    expect(s.loans[0]!.status).toBe("repaid");
    expect(s.house.cash).toBe(cash + 30000);
    expect(accountBalance(s, "loans")).toBe(0);
    balanced(s);
    expect(s.news.at(-1)?.title).toBe("A borrower is lured away");
  });

  it("an old loan, or one at the rival's rate, is never taken", () => {
    const sure = dataWith({ poach: { chance: NONE }, plots: { chance: NONE }, loans: { steal: { base: 1, per_point: 0, max: 1 } } });
    let s = game(sure);
    s = apply(s, { kind: "lend", borrower: 2, amount: 30000, rate: 0.05 }, sure);
    resolveRivals(s, rng, sure);
    expect(s.loans[0]!.status).toBe("active");
  });
});

describe("rivals: selling loans", () => {
  it("the best-paying house buys: a friendly house pays more than the market", () => {
    const s = game();
    house(s, "stellmann").opinion = 100;
    const b = loanBuyer(s, 10000, 0.1, calmRivals);
    expect(b).toEqual({ house: "stellmann", name: "Haus Stellmann", price: 9200 });
  });

  it("with no house able to buy, a house abroad pays the market's price", () => {
    const s = game();
    s.houses = [];
    expect(loanBuyer(s, 10000, 0.1, calmRivals)).toEqual({ house: null, name: "a house in Amsterdam", price: 9000 });
  });

  it("a sale names the buyer, moves its wealth and warms it", () => {
    let s = game();
    s = apply(s, { kind: "lend", borrower: 3, amount: 10000, rate: 0.06 });
    const before = s.houses.map((h) => ({ ...h }));
    s = apply(s, { kind: "sell_loan", loan: 1 });
    const buyer = s.houses.find((h, i) => h.wealth !== before[i]!.wealth)!;
    expect(buyer).toBeDefined();
    expect(buyer.opinion).toBe(before.find((h) => h.id === buyer.id)!.opinion + 1);
    expect(s.ledger.at(-1)!.note).toContain(buyer.name);
    balanced(s);
  });
});

describe("rivals: the player's schemes", () => {
  const sure = dataWith({ poach: { chance: NONE }, plots: { chance: NONE }, schemes: { chance_min: 1, chance_max: 1, discovery: { base: 0, per_connection: 0, min: 0, max: 0 } } });
  const caught = dataWith({ poach: { chance: NONE }, plots: { chance: NONE }, schemes: { chance_min: 0, chance_max: 0, discovery: { base: 1, per_connection: 0, min: 1, max: 1 } } });

  it("are refused for an unknown or failed house, without cash, without the head's time, or twice in a quarter", () => {
    const s = game();
    expect(reason(s, { kind: "scheme", house: "nobody", scheme: "rumours" })).toBe('Unknown house "nobody"');
    house(s, "winter").failed_turn = 1;
    expect(reason(s, { kind: "scheme", house: "winter", scheme: "rumours" })).toBe("Gebrüder Winter has failed");
    const once = apply(s, { kind: "scheme", house: "kessler", scheme: "rumours" });
    expect(reason(once, { kind: "scheme", house: "kessler", scheme: "lure_clerk" })).toContain("already has a scheme against Bankhaus Kessler");
    const broke = game();
    broke.house.cash = 0;
    expect(reason(broke, { kind: "scheme", house: "kessler", scheme: "rumours" })).toContain("Not enough cash");
    const busy = game();
    busy.counting.used.head = 99;
    expect(reason(busy, { kind: "scheme", house: "kessler", scheme: "rumours" })).toContain("The head has no time left");
  });

  it("luring a clerk needs a free desk", () => {
    const s = game();
    const desks = gameData.counting.rooms[0]!.desks;
    while (s.counting.staff.length < desks) s.counting.staff.push({ ...s.counting.staff[0]!, id: s.counting.staff.length + 10 });
    expect(reason(s, { kind: "scheme", house: "kessler", scheme: "lure_clerk" })).toContain("No desk free");
  });

  it("show their cost and odds in words", () => {
    const s = game();
    const t = schemeTerms(s, house(s, "kessler"), "rumours", calmRivals);
    expect(t.cost).toBe(800);
    expect(t.odds).toMatch(/chance.* it works$/);
    expect(t.found).toMatch(/it is found out$/);
    expect(schemeChance(s, house(s, "albrecht"), "rumours", calmRivals)).toBeLessThan(schemeChance(s, house(s, "rautenberg"), "rumours", calmRivals));
    expect(discoveryChance(s, calmRivals)).toBeGreaterThan(0);
  });

  it("rumours that work cost the house its name and some wealth; the cost is in the ledger", () => {
    let s = game(sure);
    const cash = s.house.cash;
    s = apply(s, { kind: "scheme", house: "kessler", scheme: "rumours" }, sure);
    expect(s.house.cash).toBe(cash - 800);
    const k = { ...house(s, "kessler") };
    resolveRivals(s, rng, sure);
    expect(house(s, "kessler").reputation).toBe(k.reputation - 8);
    expect(house(s, "kessler").wealth).toBe(k.wealth - Math.round(k.wealth * 0.02));
    expect(house(s, "kessler").opinion).toBe(k.opinion);
    expect(s.rivals.schemes[0]).toMatchObject({ worked: true, found_out: false });
    balanced(s);
  });

  it("a lured clerk joins next quarter and leaves the house short-handed for a year", () => {
    let s = game(sure);
    const staff = s.counting.staff.length;
    s = apply(s, { kind: "scheme", house: "kessler", scheme: "lure_clerk" }, sure);
    resolveRivals(s, rng, sure);
    expect(s.counting.staff.length).toBe(staff + 1);
    const clerk = s.counting.staff.at(-1)!;
    expect(clerk).toMatchObject({ role: "clerk", start_turn: s.world.turn + 1 });
    expect(clerk.skill).toBeGreaterThanOrEqual(5);
    expect(s.rivals.short_until.kessler).toBe(s.world.turn + 4);
  });

  it("a scheme found out costs the player's name and the house's opinion, and other houses think worse too", () => {
    let s = game(caught);
    s = apply(s, { kind: "scheme", house: "albrecht", scheme: "rumours" }, caught);
    const rep = s.house.reputation;
    const opinions = s.houses.map((h) => h.opinion);
    resolveRivals(s, rng, caught);
    expect(s.house.reputation).toBe(rep - 4);
    expect(house(s, "albrecht").opinion).toBe(opinions[1]! - 30);
    expect(house(s, "kessler").opinion).toBe(opinions[0]! - 5);
    expect(house(s, "albrecht").reputation).toBe(gameData.houses.houses[1]!.reputation);
  });

  it("works against a house split from the family (not in data/houses.json)", () => {
    let s = game(sure);
    s.houses.push({ ...house(s, "winter"), id: "split_9", name: "Paul & Co.", failed_turn: null });
    s = apply(s, { kind: "scheme", house: "split_9", scheme: "rumours" }, sure);
    resolveRivals(s, rng, sure);
    expect(house(s, "split_9").reputation).toBe(house(s, "winter").reputation - 8);
  });
});

describe("rivals: paper", () => {
  it("is refused below the minimum, off the step, beyond the house's room, without cash, or for a failed house", () => {
    const s = game();
    expect(reason(s, { kind: "buy_paper", house: "albrecht", amount: 1000 })).toContain("at least");
    expect(reason(s, { kind: "buy_paper", house: "albrecht", amount: 5500 })).toContain("multiple");
    expect(reason(s, { kind: "buy_paper", house: "rautenberg", amount: 10000 })).toContain("Only 4,000 fl.");
    house(s, "winter").failed_turn = 1;
    expect(reason(s, { kind: "buy_paper", house: "winter", amount: 5000 })).toContain("has failed");
    s.house.cash = 0;
    expect(reason(s, { kind: "buy_paper", house: "albrecht", amount: 5000 })).toContain("Not enough cash");
  });

  it("is bought at a discount, pays interest from the next quarter and is repaid at par, all in the ledger", () => {
    let s = game();
    const cash = s.house.cash;
    s = apply(s, { kind: "buy_paper", house: "albrecht", amount: 10000 });
    expect(s.house.cash).toBe(cash - paperCost(10000, calmRivals));
    expect(rivalsBook(s)).toBe(9700);
    // Bought at cost: net worth does not move until the paper pays.
    expect(netWorth(s)).toBe(netWorth(game()));
    balanced(s);
    resolveRivals(s, rng, calmRivals);
    expect(s.house.cash).toBe(cash - 9700);
    for (let i = 0; i < 4; i++) {
      s.world.turn += 1;
      resolveRivals(s, rng, calmRivals);
    }
    expect(s.house.cash).toBe(cash - 9700 + 4 * 125 + 10000);
    expect(rivalsBook(s)).toBe(0);
    balanced(s);
  });

  it("presented early pays par now, drains the house and offends it", () => {
    let s = game();
    s = apply(s, { kind: "buy_paper", house: "albrecht", amount: 10000 });
    const wealth = house(s, "albrecht").wealth;
    const opinion = house(s, "albrecht").opinion;
    const cash = s.house.cash;
    s = apply(s, { kind: "present_paper", paper: 1 });
    expect(s.house.cash).toBe(cash + 10000);
    expect(house(s, "albrecht").wealth).toBe(wealth - 2000);
    expect(house(s, "albrecht").opinion).toBe(opinion - 5);
    expect(reason(s, { kind: "present_paper", paper: 1 })).toContain("no longer held");
    balanced(s);
  });

  it("presented in a panic, it breaks a house pushed below its floor", () => {
    let s = game();
    house(s, "rautenberg").wealth = 200000;
    s = apply(s, { kind: "buy_paper", house: "rautenberg", amount: 5000 });
    // Its floor is 40% of 80,000 fl.; presenting drains 1,000 fl. and takes it below.
    house(s, "rautenberg").wealth = 32500;
    s = apply(s, { kind: "present_paper", paper: 1 });
    s.world.sentiment = "panic";
    resolveRivals(s, rng, calmRivals);
    expect(house(s, "rautenberg").failed_turn).toBe(s.world.turn);
  });

  it("of a failed house recovers a share at the mood's rate", () => {
    let s = game();
    s = apply(s, { kind: "buy_paper", house: "albrecht", amount: 10000 });
    const cash = s.house.cash;
    house(s, "albrecht").failed_turn = s.world.turn;
    resolveRivals(s, rng, calmRivals);
    expect(s.house.cash).toBe(cash + 3000);
    expect(s.rivals.paper[0]!.status).toBe("lost");
    balanced(s);
  });

  it("keeps a house from plotting while it is held", () => {
    let s = game();
    house(s, "kessler").opinion = -80;
    expect(plotChance(s, house(s, "kessler"), calmRivals)).toBe(0);
    const plotting = dataWith({ plots: { chance: { cautious: 0.1, bold: 0.1 } } });
    expect(plotChance(s, house(s, "kessler"), plotting)).toBeGreaterThan(0);
    s = apply(s, { kind: "buy_paper", house: "kessler", amount: 5000 }, plotting);
    expect(plotChance(s, house(s, "kessler"), plotting)).toBe(0);
  });
});

describe("rivals: poaching", () => {
  const poaching = dataWith({ poach: { chance: { cautious: 1, bold: 1 }, min_skill: 1 }, plots: { chance: NONE } });

  it("courts the most skilled member, never the partner, for a better wage", () => {
    const s = game(poaching);
    s.counting.staff.push({ ...s.counting.staff[0]!, id: 50, role: "partner", skill: 10 });
    resolveRivals(s, rng, poaching);
    expect(s.rivals.poach_offers).toHaveLength(1);
    const o = s.rivals.poach_offers[0]!;
    expect(o.staff).toBe(1);
    expect(o.open_turn).toBe(s.world.turn + 1);
    expect(o.wage).toBeGreaterThan(25);
  });

  it("matched, the member stays at the higher wage; unmatched, they leave", () => {
    const s0 = game(poaching);
    resolveRivals(s0, rng, poaching);
    s0.world.turn += 1;
    const o = s0.rivals.poach_offers[0]!;
    const kept = apply(s0, { kind: "match_wage", staff: o.staff }, poaching);
    expect(wageBill(kept, poaching)).toBe(wageBill(s0, poaching) + o.wage - gameData.counting.roles.clerk.wage);
    expect(reason(kept, { kind: "match_wage", staff: o.staff }, poaching)).toBe("The wage is already matched");
    const none = dataWith({ poach: { chance: NONE }, plots: { chance: NONE } });
    resolveRivals(kept, rng, none);
    expect(kept.counting.staff.some((m) => m.id === o.staff)).toBe(true);
    resolveRivals(s0, rng, none);
    expect(s0.counting.staff.some((m) => m.id === o.staff)).toBe(false);
  });

  it("a matched member is not courted again for less than they are paid", () => {
    const s = game(poaching);
    s.counting.staff = [s.counting.staff[0]!];
    s.counting.staff[0]!.raise = 1000;
    resolveRivals(s, rng, poaching);
    expect(s.rivals.poach_offers).toEqual([]);
  });

  it("an offer for someone already leaving cannot be matched", () => {
    const s = game(poaching);
    resolveRivals(s, rng, poaching);
    s.world.turn += 1;
    const o = s.rivals.poach_offers[0]!;
    s.counting.staff.find((m) => m.id === o.staff)!.leaving = true;
    expect(reason(s, { kind: "match_wage", staff: o.staff }, poaching)).toContain("leaving anyway");
  });
});

describe("rivals: plots against the player", () => {
  const plotting = (heard: number, debt = 0) =>
    dataWith({ poach: { chance: NONE }, plots: { chance: { cautious: 1, bold: 1 }, opinion_scale: 1, debt_share: debt, hear: { base: heard, per_correspondent: 0, per_connection: 0, max: 1 }, per_quarter: 1 } });

  it("hostile houses plot, more the more they dislike the house; friends never", () => {
    const d = dataWith({ plots: { chance: { cautious: 0.02, bold: 0.04 } } });
    const s = game(d);
    house(s, "kessler").opinion = -25;
    const a = plotChance(s, house(s, "kessler"), d);
    house(s, "kessler").opinion = -75;
    expect(plotChance(s, house(s, "kessler"), d)).toBeGreaterThan(a);
    expect(plotChance(s, house(s, "stellmann"), d)).toBe(0);
    expect(hearChance(s, d)).toBeGreaterThan(0);
  });

  it("a plot heard of can be countered for a price; then it comes to nothing", () => {
    const d = plotting(1);
    let s = game(d);
    resolveRivals(s, rng, d);
    const p = s.rivals.plots[0]!;
    expect(p).toMatchObject({ house: "kessler", kind: "rumours", heard: true, status: "laid" });
    s.world.turn += 1;
    const rep = s.house.reputation;
    const cash = s.house.cash;
    s = apply(s, { kind: "counter_plot", plot: p.id }, d);
    expect(s.house.cash).toBe(cash - 500);
    resolveRivals(s, rng, dataWith({ poach: { chance: NONE }, plots: { chance: NONE } }));
    expect(s.house.reputation).toBe(rep);
    expect(s.rivals.plots[0]!.status).toBe("countered");
  });

  it("a plot not heard of cannot be countered, and rumours strike: name and deposits", () => {
    const d = plotting(0);
    const s = game(d);
    resolveRivals(s, rng, d);
    s.world.turn += 1;
    expect(reason(s, { kind: "counter_plot", plot: s.rivals.plots[0]!.id }, d)).toContain("No plot");
    s.ledger.push({ id: s.next_ledger_id++, turn: s.world.turn, account: "deposits", category: "opening", amount: 100000 - s.house.deposits, note: "test" });
    s.house.deposits = 100000;
    const rep = s.house.reputation;
    resolveRivals(s, rng, dataWith({ poach: { chance: NONE }, plots: { chance: NONE } }));
    expect(s.house.reputation).toBe(rep - 1);
    expect(s.house.deposits).toBe(97000);
    balanced(s);
  });

  it("rumours with no cash take no deposits", () => {
    const d = plotting(0);
    const s = game(d);
    resolveRivals(s, rng, d);
    s.world.turn += 1;
    s.house.cash = 0;
    s.house.deposits = 100000;
    resolveRivals(s, rng, dataWith({ poach: { chance: NONE }, plots: { chance: NONE } }));
    expect(s.house.cash).toBe(0);
    expect(s.house.deposits).toBe(100000);
  });

  it("buying the player's debts moves the debt to the plotting house and calls it next quarter", () => {
    const d = plotting(0, 1);
    const s = game(d);
    s.debts.push({ id: 1, lender: "Haus Stellmann", house: "stellmann", principal: 10000, rate: 0.1, start_turn: s.world.turn, term_quarters: 8, status: "active" });
    resolveRivals(s, rng, d);
    expect(s.rivals.plots[0]!.kind).toBe("buy_debt");
    s.world.turn += 1;
    resolveRivals(s, rng, dataWith({ poach: { chance: NONE }, plots: { chance: NONE } }));
    expect(s.debts[0]).toMatchObject({ house: "kessler", lender: "Bankhaus Kessler", term_quarters: 3 });
    expect(s.world.turn + 1 - s.debts[0]!.start_turn + 1).toBe(s.debts[0]!.term_quarters);
  });

  it("with no debts to buy, a plot is rumours", () => {
    const d = plotting(0, 1);
    const s = game(d);
    resolveRivals(s, rng, d);
    expect(s.rivals.plots[0]!.kind).toBe("rumours");
  });

  it("a plot of a house that fails meanwhile comes to nothing", () => {
    const d = plotting(0);
    const s = game(d);
    resolveRivals(s, rng, d);
    s.world.turn += 1;
    house(s, "kessler").failed_turn = s.world.turn;
    const rep = s.house.reputation;
    resolveRivals(s, rng, dataWith({ poach: { chance: NONE }, plots: { chance: NONE } }));
    expect(s.rivals.plots[0]!.status).toBe("fizzled");
    expect(s.house.reputation).toBe(rep);
  });
});

describe("rivals: determinism", () => {
  it("the same state and data give the same quarter", () => {
    const d = dataWith({ poach: { chance: { cautious: 0.5, bold: 0.5 } }, plots: { chance: { cautious: 0.5, bold: 0.5 } } });
    const a = game(d);
    const b = game(d);
    for (const h of [...a.houses, ...b.houses]) (h as OtherHouse).opinion = -60;
    resolveRivals(a, createRng(3), d);
    resolveRivals(b, createRng(99), d);
    expect(a.rivals).toEqual(b.rivals);
  });
});
