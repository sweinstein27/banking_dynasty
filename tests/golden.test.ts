// Fixed-seed golden runs. If a snapshot changes, the balance changed: make sure that was deliberate,
// then update with `npx vitest run -u`.
// 1. "golden run": lending only (Week 1 strategy), kept so older balance changes stay comparable.
// 2. "golden run: full economy": reserves, bonds, ventures and lending together (Week 2).
import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { bondBook } from "../src/sim/bonds";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { applyDecision } from "../src/sim/decisions";
import { checkLend } from "../src/sim/loans";
import { freeCash } from "../src/sim/reserves";
import { createRng } from "../src/sim/rng";
import { endTurn, loanBook, netWorth } from "../src/sim/turn";
import type { Decision, GameState, Sentiment } from "../src/sim/types";
import { ventureBook } from "../src/sim/ventures";

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

/**
 * Full-economy strategy. Turn 1: set a 20,000 reserve, buy Bavarian bonds, back a mill.
 * Later turns: lend to a good borrower, buy bonds rotating through four states, and back a
 * shipping line with 30% of what is left every fourth turn. Shares are of free cash; decisions that
 * would be refused (for example below a minimum amount) are skipped.
 */
function economyDecisions(state: GameState): Decision[] {
  const t = state.world.turn;
  const rotation = ["bavaria", "austria", "france", "naples"];
  const share = (s: GameState, f: number) => Math.floor((freeCash(s) * f) / 100) * 100;
  const wanted: ((s: GameState) => Decision)[] =
    t === 1
      ? [
          () => ({ kind: "set_reserve", amount: 20000 }),
          (s) => ({ kind: "buy_bond", state: "bavaria", face_value: share(s, 0.2) }),
          (s) => ({ kind: "invest_venture", venture: "mill", amount: share(s, 0.1) }),
        ]
      : [
          (s) => ({ kind: "lend", amount: share(s, 0.2), rate: 0.06, tier: "good" }),
          (s) => ({ kind: "buy_bond", state: rotation[t % rotation.length]!, face_value: share(s, 0.1) }),
          ...(t % 4 === 1 ? [(s: GameState) => ({ kind: "invest_venture", venture: "shipping", amount: share(s, 0.3) }) as Decision] : []),
        ];
  const decisions: Decision[] = [];
  let preview = state;
  for (const make of wanted) {
    const d = make(preview);
    const r = applyDecision(preview, d, gameData);
    if (!r.ok) continue;
    decisions.push(d);
    preview = r.state;
  }
  return decisions;
}

type Strategy = (state: GameState) => Decision[];

function play(strategy: Strategy = scriptedDecisions): {
  state: GameState;
  netWorthByTurn: number[];
  sentimentByTurn: Sentiment[];
} {
  const rng = createRng(SEED);
  let state = newGame(gameData);
  const netWorthByTurn: number[] = [];
  const sentimentByTurn: Sentiment[] = [];
  for (let i = 0; i < TURNS; i++) {
    if (state.house.status === "bankrupt") break;
    state = endTurn(state, strategy(state), rng, gameData);
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
    expect(accountBalance(state, "ventures")).toBe(ventureBook(state));
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

describe("golden run: full economy", () => {
  it("is identical when replayed with the same seed", () => {
    expect(play(economyDecisions).state).toEqual(play(economyDecisions).state);
  });

  it("reconciles every balance to the ledger", () => {
    const { state } = play(economyDecisions);
    expect(accountBalance(state, "cash")).toBe(state.house.cash);
    expect(accountBalance(state, "loans")).toBe(loanBook(state));
    expect(accountBalance(state, "bonds")).toBe(bondBook(state));
    expect(accountBalance(state, "ventures")).toBe(ventureBook(state));
    expect(accountBalance(state, "deposits")).toBe(state.house.deposits);
  });

  it("uses every decision type", () => {
    const { state } = play(economyDecisions);
    expect(state.house.reserve).toBe(20000);
    expect(state.loans.length).toBeGreaterThan(0);
    expect(state.bonds.length).toBeGreaterThan(0);
    expect(state.ventures.length).toBeGreaterThan(0);
  });

  it("matches the recorded result", () => {
    const { state, netWorthByTurn, sentimentByTurn } = play(economyDecisions);
    const tally = (items: { status: string }[]) =>
      items.reduce<Record<string, number>>((acc, i) => ((acc[i.status] = (acc[i.status] ?? 0) + 1), acc), {});
    expect({
      world: state.world,
      status: state.house.status,
      cash: state.house.cash,
      reserve: state.house.reserve,
      deposits: state.house.deposits,
      loan_book: loanBook(state),
      bond_book: bondBook(state),
      venture_book: ventureBook(state),
      net_worth_by_turn: netWorthByTurn,
      sentiment_by_turn: sentimentByTurn,
      loans: tally(state.loans),
      bonds: tally(state.bonds),
      ventures: tally(state.ventures),
      defaulted_states: state.defaulted_states,
      forced_sales: state.ledger.filter((e) => e.category === "forced_sale" && e.account === "cash").length,
      ledger_entries: state.ledger.length,
    }).toMatchSnapshot();
  });
});
