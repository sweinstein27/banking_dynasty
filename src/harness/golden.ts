// The golden runs' strategies, kept exactly as they were so the snapshots only move when the game does.
// The balancing harness has its own strategies in strategies.ts.
import { newGame } from "../sim/init";
import { lendOffers } from "../sim/offers";
import { createRng } from "../sim/rng";
import type { GameData } from "../sim/tuning";
import { endTurn, netWorth } from "../sim/turn";
import type { Decision, GameState, Sentiment } from "../sim/types";
import { accepted, lendShare, safestFirst, shareOfFree, type Strategy } from "./common";

/** A simple lending strategy: each turn, lend 20% of free cash to every borrower who asks, at their maximum rate. */
export function scriptedDecisions(state: GameState, data: GameData): Decision[] {
  return accepted(state, data, lendOffers(state, data).map((o) => (s: GameState) => lendShare(s, o, 0.2)));
}

/**
 * Full-economy strategy. Turn 1: set a 20,000 reserve, buy Bavarian bonds, back a mill.
 * Later turns: lend to the safest-looking borrower who asks, buy bonds rotating through four states,
 * and back a shipping line with 30% of what is left every fourth turn. Shares are of free cash;
 * decisions that would be refused (for example below a minimum amount) are skipped.
 */
export function economyDecisions(state: GameState, data: GameData): Decision[] {
  const t = state.world.turn;
  const rotation = ["bavaria", "austria", "france", "naples"];
  const wanted: ((s: GameState) => Decision | null)[] =
    t === 1
      ? [
          () => ({ kind: "set_reserve", amount: 20000 }),
          (s) => ({ kind: "buy_bond", state: "bavaria", face_value: shareOfFree(s, 0.2) }),
          (s) => ({ kind: "invest_venture", venture: "mill", amount: shareOfFree(s, 0.1) }),
        ]
      : [
          (s) => {
            const best = safestFirst(s, data)[0];
            return best ? lendShare(s, best, 0.2) : null;
          },
          (s) => ({ kind: "buy_bond", state: rotation[t % rotation.length]!, face_value: shareOfFree(s, 0.1) }),
          ...(t % 4 === 1 ? [(s: GameState) => ({ kind: "invest_venture", venture: "shipping", amount: shareOfFree(s, 0.3) }) as Decision] : []),
        ];
  return accepted(state, data, wanted);
}

/**
 * Aggressive strategy: no reserve. Each turn lend half of free cash to the riskiest-looking borrower
 * who asks, at their maximum rate, put 60% of what is left into the riskiest bonds still for sale
 * (Naples, then France), and every fourth turn back a shipping line with half of what remains.
 * Built to be caught short by a run.
 */
export function aggressiveDecisions(state: GameState, data: GameData): Decision[] {
  const t = state.world.turn;
  const bondState = (s: GameState) => (s.defaulted_states.includes("naples") ? "france" : "naples");
  const wanted: ((s: GameState) => Decision | null)[] = [
    (s) => {
      // The riskiest-looking borrower pays the most.
      const riskiest = safestFirst(s, data).at(-1);
      return riskiest ? lendShare(s, riskiest, 0.5) : null;
    },
    (s) => ({ kind: "buy_bond", state: bondState(s), face_value: shareOfFree(s, 0.6) }),
    ...(t % 4 === 1 ? [(s: GameState) => ({ kind: "invest_venture", venture: "shipping", amount: shareOfFree(s, 0.5) }) as Decision] : []),
  ];
  return accepted(state, data, wanted);
}

/** Plays `turns` quarters from a new game with a fixed seed, stopping early on bankruptcy. */
export function play(
  strategy: Strategy,
  seed: number,
  turns: number,
  data: GameData,
): {
  state: GameState;
  netWorthByTurn: number[];
  sentimentByTurn: Sentiment[];
} {
  const rng = createRng(seed);
  let state = newGame(data, rng);
  const netWorthByTurn: number[] = [];
  const sentimentByTurn: Sentiment[] = [];
  for (let i = 0; i < turns; i++) {
    if (state.house.status === "bankrupt") break;
    state = endTurn(state, strategy(state, data), rng, data);
    netWorthByTurn.push(netWorth(state));
    sentimentByTurn.push(state.world.sentiment);
  }
  return { state, netWorthByTurn, sentimentByTurn };
}

/**
 * What the panic golden run must exercise: a panic with a bank run, forced sales of both bonds and
 * loans, a state default, and survival to the last turn. Shared by the golden test and the seed search.
 */
export function panicCoverage(result: ReturnType<typeof play>, turns: number) {
  const { state, sentimentByTurn } = result;
  const sales = (account: string) => state.ledger.filter((e) => e.category === "forced_sale" && e.account === account).length;
  const checks = {
    panic: sentimentByTurn.includes("panic"),
    run: state.ledger.some((e) => e.category === "withdrawal" && e.note.includes("(panic)")),
    bond_sales: sales("bonds") > 0,
    loan_sales: sales("loans") > 0,
    state_default: state.defaulted_states.length > 0,
    survives: state.house.status === "solvent" && sentimentByTurn.length === turns,
  };
  /** Richer runs score higher: panic quarters plus forced sales. */
  const score = sentimentByTurn.filter((s) => s === "panic").length + sales("bonds") + sales("loans") + sales("ventures");
  return { ok: Object.values(checks).every(Boolean), checks, score };
}
