import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { applyWithdrawals, nextSentiment, withdrawalDemand } from "../src/sim/sentiment";
import { endTurn } from "../src/sim/turn";
import type { LendDecision, Sentiment } from "../src/sim/types";
import { fixedRng, noDefaults } from "./helpers";

const tuning = gameData.tuning;
const tr = tuning.sentiment.transitions;
const moods: Sentiment[] = ["calm", "uneasy", "panic"];

describe("transition tuning", () => {
  it("never sums above 1 for any mood", () => {
    for (const m of moods) {
      const total = Object.values(tr[m]).reduce((a, b) => a + (b ?? 0), 0);
      expect(total).toBeLessThanOrEqual(1);
    }
  });

  it("cannot jump straight from calm to panic or panic to calm", () => {
    expect(tr.calm.panic ?? 0).toBe(0);
    expect(tr.panic.calm ?? 0).toBe(0);
  });
});

describe("nextSentiment", () => {
  it("calm turns uneasy on a low roll, stays calm otherwise", () => {
    expect(nextSentiment("calm", 0, tuning)).toBe("uneasy");
    expect(nextSentiment("calm", tr.calm.uneasy! - 1e-9, tuning)).toBe("uneasy");
    expect(nextSentiment("calm", tr.calm.uneasy!, tuning)).toBe("calm");
    expect(nextSentiment("calm", 0.999999, tuning)).toBe("calm");
  });

  it("uneasy can calm down, slide into panic, or stay, in tuning order", () => {
    const toCalm = tr.uneasy.calm!;
    const toPanic = tr.uneasy.panic!;
    expect(nextSentiment("uneasy", toCalm - 1e-9, tuning)).toBe("calm");
    expect(nextSentiment("uneasy", toCalm, tuning)).toBe("panic");
    expect(nextSentiment("uneasy", toCalm + toPanic - 1e-9, tuning)).toBe("panic");
    expect(nextSentiment("uneasy", toCalm + toPanic, tuning)).toBe("uneasy");
  });

  it("panic eases to uneasy on a low roll, persists otherwise", () => {
    expect(nextSentiment("panic", tr.panic.uneasy! - 1e-9, tuning)).toBe("uneasy");
    expect(nextSentiment("panic", tr.panic.uneasy!, tuning)).toBe("panic");
  });

  it("reads its odds from tuning", () => {
    const sticky = structuredClone(tuning);
    sticky.sentiment.transitions.calm = {};
    expect(nextSentiment("calm", 0, sticky)).toBe("calm");
  });
});

describe("endTurn: sentiment", () => {
  it("rolls next quarter's mood at the end of the turn", () => {
    const s = endTurn(newGame(gameData), [], fixedRng(0), gameData);
    expect(s.world.sentiment).toBe("uneasy");
  });

  it("uses this quarter's mood for defaults, not next quarter's", () => {
    // Fair loan: p = p0 * m * 0.4. Roll between the calm and uneasy thresholds, then roll calm -> uneasy.
    const lendFair: LendDecision = { kind: "lend", amount: 10000, rate: 0.08, tier: "fair" };
    const p = tuning.loans.p0 * 0.4;
    const s = endTurn(newGame(gameData), [lendFair], fixedRng(p * 1.5, 0), gameData);
    expect(s.loans[0]!.status).toBe("active");
    expect(s.world.sentiment).toBe("uneasy");
  });

  it("draws one roll for the mood and one for random events when there are no loans", () => {
    let calls = 0;
    endTurn(newGame(gameData), [], { next: () => (calls++, 0.5) }, gameData);
    expect(calls).toBe(2);
  });

  it("does not change the input state", () => {
    const s0 = newGame(gameData);
    s0.world.sentiment = "uneasy";
    const before = structuredClone(s0);
    endTurn(s0, [], fixedRng(0), gameData);
    expect(s0).toEqual(before);
  });
});

describe("withdrawals by mood", () => {
  it("is zero when calm", () => {
    expect(withdrawalDemand(50000, "calm", tuning)).toBe(0);
  });

  it("is the uneasy share of deposits, rounded to whole gulden", () => {
    expect(withdrawalDemand(50000, "uneasy", tuning)).toBe(Math.round(50000 * tuning.sentiment.withdrawal_share.uneasy));
    expect(Number.isInteger(withdrawalDemand(12345, "uneasy", tuning))).toBe(true);
  });

  it("is zero with zero deposits", () => {
    expect(withdrawalDemand(0, "uneasy", tuning)).toBe(0);
  });

  it("writes no ledger entry when nothing is withdrawn", () => {
    const s = newGame(gameData);
    const entries = s.ledger.length;
    expect(applyWithdrawals(s, tuning)).toBeNull();
    expect(s.ledger).toHaveLength(entries);
  });

  it("pays uneasy depositors during End Turn and reconciles", () => {
    const s0 = newGame(gameData);
    s0.world.sentiment = "uneasy";
    const demand = withdrawalDemand(s0.house.deposits, "uneasy", tuning);
    const s1 = endTurn(s0, [], noDefaults, gameData);
    expect(s1.house.deposits).toBe(s0.house.deposits - demand);
    expect(s1.house.cash).toBe(s0.house.cash - demand);
    expect(accountBalance(s1, "cash")).toBe(s1.house.cash);
    expect(accountBalance(s1, "deposits")).toBe(s1.house.deposits);
  });

  it("leaves a shortfall owed when cash is zero (forced sales come in step 3)", () => {
    const s0 = newGame(gameData);
    s0.world.sentiment = "uneasy";
    s0.house.cash = 0;
    const r = applyWithdrawals(s0, tuning);
    expect(r?.shortfall).toBe(withdrawalDemand(50000, "uneasy", tuning));
    expect(s0.house.deposits).toBe(50000);
  });

  it("draws on the reserve first", () => {
    const s0 = newGame(gameData);
    s0.world.sentiment = "uneasy";
    s0.house.reserve = 20000;
    const r = applyWithdrawals(s0, tuning);
    expect(r).toMatchObject({ fromReserve: withdrawalDemand(50000, "uneasy", tuning), fromFreeCash: 0 });
  });
});
