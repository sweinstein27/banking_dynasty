// Scripted strategies for the golden runs (and, from Week 6, the balancing harness).
import { gameData } from "../src/data";
import { applyDecision } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { checkLend } from "../src/sim/loans";
import { freeCash } from "../src/sim/reserves";
import { createRng } from "../src/sim/rng";
import { endTurn, netWorth } from "../src/sim/turn";
import type { Decision, GameState, Sentiment } from "../src/sim/types";

/** A simple mixed strategy: each turn, lend a share of cash to each tier at its maximum rate. */
export function scriptedDecisions(state: GameState): Decision[] {
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
export function economyDecisions(state: GameState): Decision[] {
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

export type Strategy = (state: GameState) => Decision[];

/** Plays `turns` quarters from a new game with a fixed seed, stopping early on bankruptcy. */
export function play(
  strategy: Strategy,
  seed: number,
  turns: number,
): {
  state: GameState;
  netWorthByTurn: number[];
  sentimentByTurn: Sentiment[];
} {
  const rng = createRng(seed);
  let state = newGame(gameData);
  const netWorthByTurn: number[] = [];
  const sentimentByTurn: Sentiment[] = [];
  for (let i = 0; i < turns; i++) {
    if (state.house.status === "bankrupt") break;
    state = endTurn(state, strategy(state), rng, gameData);
    netWorthByTurn.push(netWorth(state));
    sentimentByTurn.push(state.world.sentiment);
  }
  return { state, netWorthByTurn, sentimentByTurn };
}

/**
 * Aggressive strategy: no reserve. Each turn lend half of free cash to a fair borrower at 10%,
 * put 60% of what is left into the riskiest bonds still for sale (Naples, then France), and every
 * fourth turn back a shipping line with half of what remains. Built to be caught short by a run.
 */
export function aggressiveDecisions(state: GameState): Decision[] {
  const t = state.world.turn;
  const share = (s: GameState, f: number) => Math.floor((freeCash(s) * f) / 100) * 100;
  const bondState = (s: GameState) => (s.defaulted_states.includes("naples") ? "france" : "naples");
  const wanted: ((s: GameState) => Decision)[] = [
    (s) => ({ kind: "lend", amount: share(s, 0.5), rate: 0.1, tier: "fair" }),
    (s) => ({ kind: "buy_bond", state: bondState(s), face_value: share(s, 0.6) }),
    ...(t % 4 === 1 ? [(s: GameState) => ({ kind: "invest_venture", venture: "shipping", amount: share(s, 0.5) }) as Decision] : []),
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
