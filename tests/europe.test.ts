import { describe, expect, it } from "vitest";
import { applyDecision } from "../src/sim/decisions";
import { accountBalance } from "../src/sim/ledger";
import { newGame } from "../src/sim/init";
import { createRng } from "../src/sim/rng";
import { endTurn } from "../src/sim/turn";
import type { GameState, Person } from "../src/sim/types";
import {
  billFace,
  billsBook,
  branchDisaster,
  branchesBook,
  branchIn,
  branchQuarter,
  closeChance,
  runBranches,
  settleBills,
} from "../src/sim/europe/branches";
import { arrivalTurn, cityData, cityState, deliverMail, nextDev, nextMood, nextStatus, quote, roadDays, trueRate } from "../src/sim/europe/world";
import { newsDelay } from "../src/sim/news";
import { europeBook } from "../src/sim/systems/europe";
import { fixedRng, fresh, quiet } from "./helpers";

const e = quiet.europe;
const city = (id: string) => cityData(quiet, id)!;

/** A fresh game with Friedrich grown up (born 1790) and a reputation of 60. */
function withAdult(): { s: GameState; heir: Person } {
  const s = fresh();
  const heir = s.people.find((p) => p.name === "Friedrich Adler")!;
  heir.birth_year = 1790;
  s.house.reputation = 60;
  return { s, heir };
}

function open(s: GameState, cityId: string, head: number, capital = 10000): GameState {
  const r = applyDecision(s, { kind: "open_branch", city: cityId, head, capital }, quiet);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

function booksMatch(s: GameState): void {
  expect(accountBalance(s, "branches")).toBe(branchesBook(s));
  expect(accountBalance(s, "bills")).toBe(billsBook(s));
}

describe("europe data", () => {
  it("links only known cities, and every city has a currency", () => {
    const ids = new Set(e.cities.map((c) => c.id));
    for (const l of e.links) expect(ids.has(l.from) && ids.has(l.to)).toBe(true);
    for (const c of e.cities) expect(e.currencies.some((x) => x.id === c.currency)).toBe(true);
    for (const h of e.history) expect(ids.has(h.city)).toBe(true);
  });

  it("finds the shortest road to Frankfurt", () => {
    expect(roadDays(quiet, "paris", "frankfurt")).toBe(5);
    expect(roadDays(quiet, "london", "frankfurt")).toBe(8); // by Paris, not Amsterdam (9)
    expect(roadDays(quiet, "naples", "frankfurt")).toBe(20); // by Vienna
  });
});

describe("news by courier", () => {
  it("is faster with a courier stable, a branch there and correspondents", () => {
    const s = fresh();
    s.counting.staff = s.counting.staff.filter((m) => m.role !== "correspondent");
    expect(newsDelay(s, "london", quiet)).toBe(8);
    expect(newsDelay(s, "frankfurt", quiet)).toBe(0);
    s.counting.facilities.push({ id: "courier_stable", ready_turn: 0 });
    expect(newsDelay(s, "london", quiet)).toBe(4);
    s.europe.branches.push({ city: "london", head: null, opened_turn: 1, capital: 1, deposits: 0, book: 0, last_profit: 0 });
    expect(newsDelay(s, "london", quiet)).toBe(2.4);
    const corr = { name: "C", skill: 3, trait: "sharp", role: "correspondent" as const, hired_turn: 0, start_turn: 0, leaving: false };
    for (let i = 0; i < 5; i++) s.counting.staff.push({ ...corr, id: 100 + i });
    expect(newsDelay(s, "london", quiet)).toBe(Math.round(2.4 * 0.7 * 10) / 10); // capped at 30%
  });

  it("arrives next quarter unless written too late in the quarter", () => {
    expect(arrivalTurn(5, 0, 8, e)).toBe(6);
    expect(arrivalTurn(5, 82, 8, e)).toBe(6);
    expect(arrivalTurn(5, 83, 8, e)).toBe(7);
  });

  it("updates the house's view of a city, and the news, only when the dispatch arrives", () => {
    const s = fresh();
    const view = { mood: "panic" as const, status: "peace" as const, shock: 0.9, as_of: 1 };
    s.europe.mail.push({ city: "london", sent: 1, arrives: 3, view, news: [{ title: "Panic in London", text: "Banks fail." }] });
    deliverMail(s); // turn 1: known at the start of turn 2 only if arrives <= 2
    expect(cityState(s, "london")!.known.mood).toBe("calm");
    expect(s.news.some((n) => n.kind === "europe")).toBe(false);
    s.world.turn = 2;
    deliverMail(s);
    expect(cityState(s, "london")!.known).toEqual(view);
    expect(s.news.find((n) => n.kind === "europe")!.text).toContain("1 quarter old");
    expect(s.europe.mail).toEqual([]);
  });

  it("an older dispatch does not overwrite a newer view", () => {
    const s = fresh();
    cityState(s, "paris")!.known = { mood: "calm", status: "peace", shock: 1, as_of: 4 };
    s.world.turn = 4;
    s.europe.mail.push({ city: "paris", sent: 3, arrives: 5, view: { mood: "panic", status: "peace", shock: 0.9, as_of: 3 }, news: [] });
    deliverMail(s);
    expect(cityState(s, "paris")!.known.mood).toBe("calm");
  });
});

describe("cities and currencies", () => {
  it("moods worsen more often in volatile cities", () => {
    expect(nextMood("calm", 1, 0.049, e)).toBe("uneasy");
    expect(nextMood("calm", 1, 0.06, e)).toBe("calm");
    expect(nextMood("calm", 1.5, 0.06, e)).toBe("uneasy");
    expect(nextMood("panic", 1, 0.4, e)).toBe("uneasy");
  });

  it("unrest lasts its quarters, then may end", () => {
    expect(nextStatus({ status: "peace", status_left: 0 }, 0.01, 0.005, e)).toEqual({ status: "unrest", status_left: 1 });
    expect(nextStatus({ status: "war", status_left: 3 }, 0, 0, e)).toEqual({ status: "war", status_left: 2 });
    expect(nextStatus({ status: "war", status_left: 1 }, 0, 0, e)).toEqual({ status: "peace", status_left: 0 });
    expect(nextStatus({ status: "unrest", status_left: 0 }, 0, 0.9, e)).toEqual({ status: "unrest", status_left: 0 });
  });

  it("rates stay within the band; the thaler holds its parity from 1839", () => {
    const pound = e.currencies.find((c) => c.id === "pound")!;
    const thaler = e.currencies.find((c) => c.id === "thaler")!;
    expect(nextDev(0.019, pound, false, 1, e)).toBeLessThanOrEqual(pound.band);
    expect(nextDev(0, thaler, true, 1, e)).toBe(0.002);
    const s = fresh();
    s.europe.currencies.thaler!.shock = 0.9;
    cityState(s, "berlin")!.known.shock = 0.9;
    expect(quote(s, quiet, "berlin")).toBeCloseTo(1.75 * 0.9);
    s.world.year = 1839;
    expect(quote(s, quiet, "berlin")).toBe(1.75);
  });

  it("the Frankfurt quote ignores a shock abroad until news of it arrives", () => {
    const s = fresh();
    s.europe.currencies.pound!.shock = 0.9;
    expect(quote(s, quiet, "london")).toBe(11.9);
    expect(trueRate(s, quiet, "london")).toBeCloseTo(11.9 * 0.9);
  });

  it("a London panic in 1825 shocks the pound, and the house hears of it", () => {
    let s = newGame(quiet, createRng(7));
    while (!(s.world.year === 1825 && s.world.quarter === 3)) s = endTurn(s, [], createRng(s.world.turn), quiet);
    s = endTurn(s, [], createRng(1), quiet);
    const london = cityState(s, "london")!;
    expect(london.mood).toBe("panic");
    expect(s.europe.currencies.pound!.shock).toBeLessThan(0.95);
    // Known now, or after one more quarter at the latest.
    if (london.known.mood !== "panic") s = endTurn(s, [], createRng(2), quiet);
    expect(s.news.some((n) => n.title === "Panic in London")).toBe(true);
  });
});

describe("branches", () => {
  it("refuses a child, the head of house, a closed city, low reputation and too little cash", () => {
    const s = fresh();
    const head = s.people.find((p) => p.is_head)!;
    const child = s.people.find((p) => p.name === "Friedrich Adler")!;
    const check = (d: Parameters<typeof applyDecision>[1], st = s) => {
      const r = applyDecision(st, d, quiet);
      return r.ok ? null : r.reason;
    };
    expect(check({ kind: "open_branch", city: "paris", head: child.id, capital: 10000 })).toMatch(/too young/);
    expect(check({ kind: "open_branch", city: "paris", head: head.id, capital: 10000 })).toMatch(/head of the house/);
    expect(check({ kind: "open_branch", city: "frankfurt", head: child.id, capital: 10000 })).toMatch(/home/);
    const { s: a, heir } = withAdult();
    expect(check({ kind: "open_branch", city: "naples", head: heir.id, capital: 10000 }, a)).toMatch(/before 1821/);
    a.house.reputation = 50;
    expect(check({ kind: "open_branch", city: "london", head: heir.id, capital: 10000 }, a)).toMatch(/reputation of 55/);
    expect(check({ kind: "open_branch", city: "paris", head: heir.id, capital: 100 }, a)).toMatch(/at least/);
    a.house.cash = 0;
    expect(check({ kind: "open_branch", city: "paris", head: heir.id, capital: 10000 }, a)).toMatch(/Not enough cash/);
    expect(check({ kind: "buy_bill", city: "paris", amount: 1000 }, a)).toMatch(/Not enough cash/);
  });

  it("opening pays the setup and sends capital, less the exchange spread, and the books match", () => {
    const { s, heir } = withAdult();
    const cash = s.house.cash;
    const n = open(s, "paris", heir.id, 10000);
    expect(n.house.cash).toBe(cash - 10000 - city("paris").setup);
    const b = branchIn(n, "paris")!;
    expect(b.head).toBe(heir.id);
    expect(b.book).toBe(Math.round(10000 * (1 - e.branch.transfer_spread)));
    booksMatch(n);
    expect(applyDecision(n, { kind: "open_branch", city: "paris", head: heir.id, capital: 10000 }, quiet).ok).toBe(false);
  });

  it("sends and recalls capital, keeping the minimum", () => {
    const { s, heir } = withAdult();
    let n = open(s, "paris", heir.id, 10000);
    const r1 = applyDecision(n, { kind: "fund_branch", city: "paris", amount: 2000 }, quiet);
    expect(r1.ok).toBe(true);
    n = (r1 as { state: GameState }).state;
    booksMatch(n);
    expect(applyDecision(n, { kind: "fund_branch", city: "paris", amount: -9000 }, quiet).ok).toBe(false);
    const r2 = applyDecision(n, { kind: "fund_branch", city: "paris", amount: -5000 }, quiet);
    expect(r2.ok).toBe(true);
    booksMatch((r2 as { state: GameState }).state);
  });

  it("earns more under an able head, less under a reckless one or none", () => {
    const { s, heir } = withAdult();
    const b = branchIn(open(s, "paris", heir.id, 10000), "paris")!;
    const calm = { mood: "calm" as const, status: "peace" as const };
    const at = (p: Person | undefined) => branchQuarter(b, city("paris"), calm, p, 60, 0.47, quiet).profit;
    const able = { ...heir, acumen: 8, prudence: 8, connections: 8, traits: [] };
    const plain = { ...heir, acumen: 5, prudence: 5, connections: 5, traits: [] };
    const reckless = { ...plain, traits: ["reckless"] };
    expect(at(able)).toBeGreaterThan(at(plain));
    expect(at(plain)).toBeGreaterThan(at(undefined));
    expect(branchQuarter(b, city("paris"), calm, reckless, 60, 0.47, quiet).defaults).toBeGreaterThan(branchQuarter(b, city("paris"), calm, plain, 60, 0.47, quiet).defaults);
    expect(at(plain)).toBeGreaterThan(0);
    // A panic: deposits run and loans go bad.
    const panic = branchQuarter({ ...b, deposits: 5000 }, city("paris"), { mood: "panic", status: "peace" }, plain, 60, 0.47, quiet);
    expect(panic.deposits).toBe(4000);
    expect(panic.profit).toBeLessThan(at(plain));
  });

  it("a war closes a branch: part of its capital is lost, the rest and its head come home", () => {
    const { s, heir } = withAdult();
    const n = open(s, "vienna", heir.id, 10000);
    cityState(n, "vienna")!.status = "war";
    const head = n.people.find((p) => p.id === heir.id)!;
    expect(closeChance(cityState(n, "vienna")!, head, quiet)).toBeGreaterThan(0);
    const cash = n.house.cash;
    const b = branchIn(n, "vienna")!;
    runBranches(n, fixedRng(0), quiet);
    expect(branchIn(n, "vienna")).toBeUndefined();
    const back = n.house.cash - cash;
    expect(back).toBeGreaterThan(0);
    expect(back).toBeLessThan(b.book * (1 - e.branch.close_loss.war) + 50);
    expect(n.news.some((x) => x.title === "The Vienna branch closes")).toBe(true);
    booksMatch(n);
    // Its head is free to lead another.
    expect(applyDecision(n, { kind: "open_branch", city: "paris", head: heir.id, capital: 10000 }, quiet).ok).toBe(true);
  });

  it("no closure roll in peace and calm", () => {
    expect(closeChance({ mood: "calm", status: "peace" }, undefined, quiet)).toBe(0);
    expect(closeChance({ mood: "uneasy", status: "peace" }, undefined, quiet)).toBe(0);
  });

  it("a branch whose head dies carries on headless until another is appointed", () => {
    const { s, heir } = withAdult();
    const n = open(s, "paris", heir.id, 10000);
    n.people.find((p) => p.id === heir.id)!.death_year = 1815;
    runBranches(n, fixedRng(0.99), quiet);
    expect(branchIn(n, "paris")!.head).toBeNull();
    expect(n.news.some((x) => x.title === "The Paris branch has no head")).toBe(true);
    const amalie = n.people.find((p) => p.name === "Amalie Adler")!;
    expect(applyDecision(n, { kind: "appoint_branch_head", city: "paris", head: amalie.id }, quiet).ok).toBe(false); // too young
    amalie.birth_year = 1790;
    const r = applyDecision(n, { kind: "appoint_branch_head", city: "paris", head: amalie.id }, quiet);
    expect(r.ok && branchIn(r.state, "paris")!.head).toBe(amalie.id);
  });

  it("a fire takes a share of the branch's capital", () => {
    const { s, heir } = withAdult();
    const n = open(s, "hamburg", heir.id, 10000);
    const before = branchIn(n, "hamburg")!.book;
    branchDisaster(n, "hamburg", 0.1, "Hamburg burns", quiet);
    expect(branchIn(n, "hamburg")!.book).toBeCloseTo(before * 0.9, -1);
    booksMatch(n);
  });

  it("closing brings the capital home less the spread", () => {
    const { s, heir } = withAdult();
    const n = open(s, "paris", heir.id, 10000);
    const book = branchIn(n, "paris")!.book;
    const r = applyDecision(n, { kind: "close_branch", city: "paris" }, quiet);
    expect(r.ok).toBe(true);
    const c = (r as { state: GameState }).state;
    expect(c.house.cash - n.house.cash).toBe(Math.round(book * (1 - e.branch.transfer_spread)));
    booksMatch(c);
  });
});

describe("bills of exchange", () => {
  it("a bill bought before news of a crisis arrives loses money", () => {
    const s = fresh();
    const r = applyDecision(s, { kind: "buy_bill", city: "london", amount: 2000 }, quiet);
    expect(r.ok).toBe(true);
    const n = (r as { state: GameState }).state;
    const bill = n.europe.bills[0]!;
    expect(bill.face).toBe(billFace(s, quiet, "london", 2000));
    // The crisis reaches Frankfurt; the bill is paid at the new quote.
    n.europe.currencies.pound!.shock = 0.9;
    n.europe.mail.push({ city: "london", sent: 1, arrives: 2, view: { mood: "panic", status: "peace", shock: 0.9, as_of: 1 }, news: [] });
    deliverMail(n);
    const cash = n.house.cash;
    settleBills(n, new Map([[bill.id, false]]), quiet);
    expect(n.house.cash - cash).toBeLessThan(2000);
    expect(n.europe.bills).toEqual([]);
    booksMatch(n);
  });

  it("a bill in calm times earns its discount; a failed payer returns the recovery share", () => {
    const s = fresh();
    const n = (applyDecision(s, { kind: "buy_bill", city: "paris", amount: 1000 }, quiet) as { state: GameState }).state;
    const m = (applyDecision(n, { kind: "buy_bill", city: "paris", amount: 1000 }, quiet) as { state: GameState }).state;
    const cash = m.house.cash;
    const [a, b] = m.europe.bills;
    settleBills(m, new Map([[a!.id, false], [b!.id, true]]), quiet);
    const paid = Math.round(1000 / (1 - (city("paris").rate / 4 + e.bills.spread)));
    expect(m.house.cash - cash).toBeCloseTo(paid + Math.round(paid * e.bills.recovery), -1);
    booksMatch(m);
  });

  it("limits bills on one city, more with a branch there", () => {
    const { s, heir } = withAdult();
    expect(applyDecision(s, { kind: "buy_bill", city: "paris", amount: e.bills.limit + 1 }, quiet).ok).toBe(false);
    const n = open(s, "paris", heir.id, 10000);
    expect(applyDecision(n, { kind: "buy_bill", city: "paris", amount: e.bills.limit + 1 }, quiet).ok).toBe(true);
  });
});

describe("a run with Europe", () => {
  it("keeps the ledger matching the books every quarter, and the same seed gives the same Europe", () => {
    const play = () => {
      let s = newGame(quiet, createRng(42));
      const heir = s.people.find((p) => p.name === "Friedrich Adler")!;
      heir.birth_year = 1790;
      s.house.reputation = 60;
      const rng = createRng(99);
      for (let t = 0; t < 60 && s.house.status !== "bankrupt"; t++) {
        const wanted = [
          { kind: "open_branch" as const, city: "london", head: heir.id, capital: 20000 },
          { kind: "buy_bill" as const, city: ["paris", "vienna", "naples", "amsterdam"][t % 4]!, amount: 1000 },
        ];
        const ds = wanted.filter((d) => applyDecision(s, d, quiet).ok);
        s = endTurn(s, ds, rng, quiet);
        booksMatch(s);
        expect(europeBook(s)).toBe(branchesBook(s) + billsBook(s));
      }
      return s;
    };
    const a = play();
    expect(a.europe).toEqual(play().europe);
    expect(a.europe.fired).toEqual(["naples-revolution-1820", "naples-austrians-1821", "naples-restored-1821", "london-panic-1825"]);
  });
});
