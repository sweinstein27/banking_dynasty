import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { depositInflow, depositInterest, depositLevel, resolveDeposits } from "../src/sim/deposits";
import { accountBalance } from "../src/sim/ledger";
import type { GameData } from "../src/sim/tuning";
import { endTurn, netWorth } from "../src/sim/turn";
import type { GameState, Sentiment } from "../src/sim/types";
import { fresh, noDefaults, quiet } from "./helpers";

const { tuning } = gameData;
const d = tuning.deposits;
/** Quiet in every other way, but with the real deposit flows. */
const withDeposits: GameData = { ...quiet, tuning: { ...quiet.tuning, deposits: d } };

function house(reputation: number, deposits: number, sentiment: Sentiment = "calm"): GameState {
  const s = fresh();
  s.house.reputation = reputation;
  s.house.deposits = deposits;
  s.world.sentiment = sentiment;
  s.ledger = s.ledger.filter((e) => e.account !== "deposits");
  s.ledger.push({ id: 999, turn: 1, account: "deposits", category: "opening", amount: deposits, note: "test opening" });
  return s;
}

describe("depositLevel", () => {
  it("is per_reputation fl. for each point of reputation, so the start is in balance", () => {
    expect(depositLevel(70, tuning)).toBe(70 * d.per_reputation);
    expect(depositLevel(0, tuning)).toBe(0);
    expect(depositLevel(tuning.start.reputation, tuning)).toBe(tuning.start.deposits);
  });
});

describe("depositInterest", () => {
  it("is a quarter of the annual rate, in whole gulden", () => {
    expect(depositInterest(50000, tuning)).toBe(Math.round((50000 * d.interest_rate) / 4));
    expect(depositInterest(0, tuning)).toBe(0);
  });
});

describe("depositInflow", () => {
  it("brings catch_up of the gap below the reputation's level in a calm market", () => {
    expect(depositInflow(house(70, 50000), tuning)).toBe(Math.round(20000 * d.catch_up));
  });

  it("brings nothing above the level, or when uneasy or panicking", () => {
    expect(depositInflow(house(40, 50000), tuning)).toBe(0);
    expect(depositInflow(house(70, 50000, "uneasy"), tuning)).toBe(0);
    expect(depositInflow(house(70, 50000, "panic"), tuning)).toBe(0);
  });
});

describe("resolveDeposits", () => {
  it("credits interest to depositors without moving cash, and lowers net worth by it", () => {
    const s = house(50, 50000);
    const cash = s.house.cash;
    const worth = netWorth(s);
    resolveDeposits(s, tuning);
    const interest = depositInterest(50000, tuning);
    expect(s.house.cash).toBe(cash);
    expect(s.house.deposits).toBe(50000 + interest);
    expect(netWorth(s)).toBe(worth - interest);
    expect(s.ledger.at(-1)).toMatchObject({ account: "deposits", category: "deposit_interest", amount: interest });
  });

  it("adds new deposits as cash and as money owed, leaving net worth unchanged by them", () => {
    const s = house(80, 50000);
    const before = { cash: s.house.cash, worth: netWorth(s) };
    resolveDeposits(s, tuning);
    const interest = depositInterest(50000, tuning);
    const inflow = Math.round((80000 - 50000 - interest) * d.catch_up);
    expect(s.house.cash).toBe(before.cash + inflow);
    expect(s.house.deposits).toBe(50000 + interest + inflow);
    expect(netWorth(s)).toBe(before.worth - interest);
    expect(accountBalance(s, "cash")).toBe(s.house.cash);
    expect(accountBalance(s, "deposits")).toBe(s.house.deposits);
  });

  it("does nothing for a bankrupt house", () => {
    const s = house(80, 50000);
    s.house.status = "bankrupt";
    const copy = structuredClone(s);
    resolveDeposits(s, tuning);
    expect(s).toEqual(copy);
  });

  it("with zero reputation, only interest is credited", () => {
    const s = house(0, 10000);
    resolveDeposits(s, tuning);
    expect(s.house.deposits).toBe(10000 + depositInterest(10000, tuning));
    expect(s.ledger.filter((e) => e.category === "deposit_inflow")).toEqual([]);
  });
});

describe("deposits over time, in End Turn", () => {
  it("a respected house grows toward its level in calm years; a disliked one does not", () => {
    const run = (reputation: number) => {
      let s = house(reputation, 50000);
      for (let i = 0; i < 20; i++) s = endTurn(s, [], noDefaults, withDeposits);
      return s.house.deposits;
    };
    expect(run(80)).toBeGreaterThan(70000);
    expect(run(80)).toBeLessThanOrEqual(80000 + 20 * depositInterest(80000, tuning));
    // At reputation 30 nothing comes in; interest alone adds a little.
    expect(run(30)).toBeLessThan(56000);
  });

  it("withdrawals come first: a panic quarter only credits interest", () => {
    const s = endTurn(house(80, 50000, "panic"), [], noDefaults, withDeposits);
    expect(s.ledger.filter((e) => e.category === "deposit_inflow")).toEqual([]);
    expect(s.ledger.some((e) => e.category === "withdrawal")).toBe(true);
  });
});
