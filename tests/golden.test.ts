// Fixed-seed golden run. If this snapshot changes, the balance changed: make sure that was deliberate,
// then update with `npx vitest run -u`.
import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { bondBook } from "../src/sim/bonds";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { checkLend } from "../src/sim/loans";
import { createRng } from "../src/sim/rng";
import { endTurn, loanBook, netWorth } from "../src/sim/turn";
import type { Decision, GameState, Sentiment } from "../src/sim/types";

const SEED = 1815;
const TURNS = 20;

/** A simple mixed strategy: each turn, lend a share of cash to each tier at its maximum rate. */
function scriptedDecisions(state: GameState): Decision[] {
  const decisions: Decision[] = [];
  const share = { good: 0.2, fair: 0.15, poor: 0.1 } as const;
  let cash = state.house.cash;
  for (const tier of ["good", "fair", "poor"] as const) {
    const amount = Math.floor((cash * share[tier]) / 100) * 100;
    const d: Decision = { kind: "lend", amount, rate: gameData.tuning.loans.tiers[tier].max_rate, tier };
    if (checkLend({ ...state, house: { ...state.house, cash } }, d, gameData.tuning) === null) {
      decisions.push(d);
      cash -= amount;
    }
  }
  return decisions;
}

function play(): { state: GameState; netWorthByTurn: number[]; sentimentByTurn: Sentiment[] } {
  const rng = createRng(SEED);
  let state = newGame(gameData);
  const netWorthByTurn: number[] = [];
  const sentimentByTurn: Sentiment[] = [];
  for (let i = 0; i < TURNS; i++) {
    state = endTurn(state, scriptedDecisions(state), rng, gameData);
    netWorthByTurn.push(netWorth(state));
    sentimentByTurn.push(state.world.sentiment);
  }
  return { state, netWorthByTurn, sentimentByTurn };
}

describe("golden run", () => {
  it("is identical when replayed with the same seed", () => {
    expect(play().state).toEqual(play().state);
  });

  it("reconciles every balance to the ledger", () => {
    const { state } = play();
    expect(accountBalance(state, "cash")).toBe(state.house.cash);
    expect(accountBalance(state, "loans")).toBe(loanBook(state));
    expect(accountBalance(state, "bonds")).toBe(bondBook(state));
    expect(accountBalance(state, "deposits")).toBe(state.house.deposits);
  });

  it("matches the recorded result", () => {
    const { state, netWorthByTurn, sentimentByTurn } = play();
    const count = (status: string) => state.loans.filter((l) => l.status === status).length;
    expect({
      world: state.world,
      cash: state.house.cash,
      deposits: state.house.deposits,
      loan_book: loanBook(state),
      net_worth_by_turn: netWorthByTurn,
      sentiment_by_turn: sentimentByTurn,
      loans: { active: count("active"), repaid: count("repaid"), defaulted: count("defaulted") },
      ledger_entries: state.ledger.length,
    }).toMatchSnapshot();
  });
});
