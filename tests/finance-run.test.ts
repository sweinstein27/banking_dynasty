// High finance over full runs: the harness strategies use it, the books always match the ledger,
// and saves made mid-run load.
import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import type { Strategy } from "../src/harness/common";
import { STRATEGIES } from "../src/harness/strategies";
import { runOver } from "../src/sim/actions";
import { bondBook } from "../src/sim/bonds";
import { applyDecisions } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { createRng } from "../src/sim/rng";
import { parseSave, toSave } from "../src/sim/save";
import { financeAccounts } from "../src/sim/systems/finance";
import { endTurn } from "../src/sim/turn";
import type { Decision, GameState } from "../src/sim/types";

function run(strategy: Strategy, seed: number, check: (s: GameState) => void): Decision[] {
  const rng = createRng(seed);
  let s = newGame(gameData, rng);
  const decisions: Decision[] = [];
  while (!runOver(s, gameData.tuning)) {
    const ds = strategy(s, gameData);
    const r = applyDecisions(s, ds, gameData);
    if (!r.ok) throw new Error(`seed ${seed} turn ${s.world.turn}: ${r.reason}`);
    decisions.push(...ds);
    s = endTurn(s, ds, rng, gameData);
    check(s);
  }
  return decisions;
}

const FINANCE = new Set(["bid_contract", "lend_house", "bid_lot", "sell_asset", "underwrite"]);

describe("high finance over full runs", () => {
  const used: Record<string, Set<string>> = {};
  const seeds = [1, 2, 3, 4, 5, 6];
  for (const name of ["cautious", "aggressive", "bond_heavy", "venture_heavy", "investor"]) {
    it(`${name}: books match the ledger every quarter, and a mid-run save loads`, () => {
      used[name] = new Set();
      for (const seed of seeds) {
        let saved = false;
        const ds = run(STRATEGIES[name]!, seed, (s) => {
          for (const [account, balance] of Object.entries(financeAccounts(s))) expect(accountBalance(s, account as "assets"), `${name} ${seed} ${account} turn ${s.world.turn}`).toBe(balance);
          expect(accountBalance(s, "bonds")).toBe(bondBook(s));
          expect(accountBalance(s, "cash")).toBe(s.house.cash);
          if (!saved && s.world.year === 1830 && s.house.status !== "bankrupt") {
            const r = parseSave(toSave(s, seed, 0, []), gameData);
            expect(r.ok, r.ok ? "" : r.reason).toBe(true);
            saved = true;
          }
        });
        for (const d of ds) if (FINANCE.has(d.kind)) used[name]!.add(d.kind);
      }
    }, 60000);
  }

  it("each sensible strategy uses the high finance it was given", () => {
    expect([...used.cautious!]).toEqual(expect.arrayContaining(["underwrite"]));
    expect([...used.aggressive!]).toEqual(expect.arrayContaining(["bid_contract", "underwrite"]));
    // Bond-heavy puts nearly all free cash into bonds each quarter, so it seldom has the caution money for a loan.
    expect([...used.investor!]).toEqual(expect.arrayContaining(["underwrite"]));
  });
});
