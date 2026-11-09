// The hooks the integrator wired after wave 3 merged: war (C3) on bond prices and contract
// announcements, politics (C2) on bond gates, contract ranking and withdrawals, and legacy's (B3)
// influence pillar read from politics.
import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { applyDecision } from "../src/sim/decisions";
import { bondPrice, reputationGate, statePrice, stateRisk } from "../src/sim/bonds";
import { announceContracts, awardContracts, eraFactor } from "../src/sim/finance/contracts";
import type { Contract } from "../src/sim/finance/types";
import { createHouses } from "../src/sim/houses";
import { newGame } from "../src/sim/init";
import { createRng } from "../src/sim/rng";
import { influence as legacyInfluence } from "../src/sim/systems/legacy";
import { withdrawalRelief } from "../src/sim/systems/politics";
import { warBondDiscount, warContractFactor, warPhaseOf } from "../src/sim/systems/war";
import type { GameData } from "../src/sim/tuning";
import type { GameState } from "../src/sim/types";
import { fixedRng, fresh, quiet } from "./helpers";

const withHouses: GameData = { ...quiet, houses: gameData.houses };
const NEVER = 0.999999;
const issuer = (id: string) => gameData.states.find((s) => s.id === id)!;

function contract(s: GameState, over: Partial<Contract> = {}): Contract {
  const c: Contract = {
    id: s.finance.next_id++, state: "bavaria", size: 200000, coupon: 0.05, term_years: 10, open_turn: s.world.turn, status: "open",
    player_bid: null, winner: null, commission: null, issue_price: null, placed: 0, quarters_placed: 0, caution: 0, carried: 0, ...over,
  };
  s.finance.contracts.push(c);
  return c;
}

describe("war on bond prices and contracts (C3)", () => {
  it("prices a state at war below the market and leaves a state at peace alone", () => {
    const s = newGame(gameData, createRng(1));
    const atWar = gameData.states.find((x) => warPhaseOf(s, gameData, x.id) !== null)!;
    const atPeace = gameData.states.find((x) => warPhaseOf(s, gameData, x.id) === null)!;
    expect(atWar).toBeDefined();
    expect(atPeace).toBeDefined();
    const market = (id: string) => bondPrice(stateRisk(s, issuer(id)), s.world.sentiment, gameData.tuning);
    expect(warBondDiscount(s, atWar.id, gameData)).toBeGreaterThan(0);
    expect(statePrice(s, atWar, gameData)).toBeCloseTo(market(atWar.id) * (1 - warBondDiscount(s, atWar.id, gameData)), 4);
    expect(statePrice(s, atWar, gameData)).toBeLessThan(market(atWar.id));
    expect(statePrice(s, atPeace, gameData)).toBe(market(atPeace.id));
  });

  it("a state at war announces a loan on a roll that would miss in peace", () => {
    const s = newGame(gameData, createRng(1));
    s.finance.contracts = [];
    const atWar = gameData.states.find((x) => warPhaseOf(s, gameData, x.id) !== null && gameData.finance.contracts.sizes[x.id])!;
    expect(warContractFactor(s, atWar.id, gameData)).toBeGreaterThan(1);
    // Only the war state's roll matters: everyone rolls just above the peacetime chance.
    const t = gameData.finance.contracts;
    const peace = t.announce_chance * eraFactor(s.world.year, gameData) * t.mood_factor[s.world.sentiment];
    announceContracts(s, fixedRng(Math.min(0.99, peace * 1.01), 0.5, 0, 0.5), gameData);
    expect(s.finance.contracts.some((c) => c.state === atWar.id)).toBe(true);
  });
});

describe("politics on gates, contracts and withdrawals (C2)", () => {
  it("influence lowers a state's reputation gate, by at most the cap", () => {
    const s = fresh();
    const base = reputationGate(s, issuer("prussia"), quiet);
    s.politics.influence = 40;
    expect(reputationGate(s, issuer("prussia"), quiet)).toBe(base - 4);
    s.politics.influence = 100;
    expect(reputationGate(s, issuer("prussia"), quiet)).toBe(base - quiet.politics.contracts.max_gate);
  });

  it("influence lets a dearer bid win the ranking, while the fee stays the bid", () => {
    const run = (influence: number) => {
      const s = fresh();
      s.houses = createHouses(withHouses);
      s.politics.influence = influence;
      const c = contract(s);
      const r = applyDecision(s, { kind: "bid_contract", contract: c.id, commission: 0.02 }, withHouses);
      if (!r.ok) throw new Error(r.reason);
      // Kessler bids at the bottom of its range (1.5%); every other house's roll misses.
      awardContracts(r.state, fixedRng(0, 0, NEVER), withHouses);
      return r.state.finance.contracts[0]!;
    };
    expect(run(0)).toMatchObject({ winner: "kessler" });
    expect(run(100)).toMatchObject({ winner: "player", commission: 0.02 });
  });

  it("the Senate's assurance halves withdrawals only in the quarter it is given", () => {
    const s = fresh();
    expect(withdrawalRelief(s, quiet)).toBe(1);
    s.politics.assurance_turn = s.world.turn;
    expect(withdrawalRelief(s, quiet)).toBe(quiet.politics.assurance.withdrawal_factor);
  });
});

describe("legacy reads influence from politics (B3)", () => {
  it("the influence pillar is politics' influence", () => {
    const s = fresh();
    expect(legacyInfluence(s, quiet)).toBe(0);
    s.politics.influence = 37;
    expect(legacyInfluence(s, quiet)).toBe(37);
  });
});
