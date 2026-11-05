import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { fresh, GOOD } from "./helpers";
import { applyDecisions } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { createRng } from "../src/sim/rng";
import { parseSave, SAVE_VERSION, toSave } from "../src/sim/save";
import { endTurn } from "../src/sim/turn";
import type { Decision, GameState } from "../src/sim/types";
import { aggressiveDecisions, PANIC_SEED, play } from "./strategies";

/** The panic seed survives 20 turns of the aggressive strategy, so the run never ends early. */
const SEED = PANIC_SEED;

/** Plays `turns` turns with the aggressive strategy, returning the state and the live RNG. */
function playTo(turns: number) {
  const rng = createRng(SEED);
  let state = newGame(gameData, rng);
  for (let i = 0; i < turns; i++) state = endTurn(state, aggressiveDecisions(state), rng, gameData);
  return { state, rng };
}

function parsed(text: string) {
  const r = parseSave(text, gameData);
  if (!r.ok) throw new Error(r.reason);
  return r.save;
}

describe("save and load", () => {
  it("round-trips a new game", () => {
    const s = fresh();
    const save = parsed(toSave(s, 42, createRng(42).state, []));
    expect(save).toEqual({ version: SAVE_VERSION, seed: 42, rng_state: 42, state: s, queued: [] });
  });

  it("resumes mid-run, with queued decisions, exactly as an unbroken run", () => {
    const unbroken = play(aggressiveDecisions, SEED, 20).state;

    const { state, rng } = playTo(10);
    const queued: Decision[] = aggressiveDecisions(state);
    expect(queued.length).toBeGreaterThan(0);
    const save = parsed(toSave(state, SEED, rng.state, queued));

    const resumedRng = createRng(save.rng_state);
    let s: GameState = endTurn(save.state, save.queued, resumedRng, gameData);
    for (let i = 11; i < 20; i++) s = endTurn(s, aggressiveDecisions(s), resumedRng, gameData);
    expect(s).toEqual(unbroken);
  });

  it("lets the queued decisions be replayed onto the loaded state", () => {
    const { state, rng } = playTo(3);
    const queued = aggressiveDecisions(state);
    const save = parsed(toSave(state, SEED, rng.state, queued));
    const r = applyDecisions(save.state, save.queued, gameData);
    expect(r.ok && r.state.actions_this_turn).toBe(queued.length);
  });
});

describe("parseSave refuses", () => {
  const good = () => JSON.parse(toSave(fresh(), 1, 1, [])) as Record<string, any>;
  const reason = (obj: unknown) => {
    const r = parseSave(typeof obj === "string" ? obj : JSON.stringify(obj), gameData);
    return r.ok ? null : r.reason;
  };

  it("text that is not JSON", () => {
    expect(reason("not json {")).toMatch(/not valid JSON/);
  });

  it("another version", () => {
    expect(reason({ ...good(), version: 1 })).toMatch(/Unsupported save version 1 \(expected 5\)/);
  });

  it("a bad RNG state", () => {
    expect(reason({ ...good(), rng_state: -1 })).toMatch(/RNG state/);
  });

  it("a state with a missing part", () => {
    const g = good();
    delete g.state.ledger;
    expect(reason(g)).toMatch(/missing "ledger"/);
  });

  it("a balance that does not match the ledger", () => {
    const g = good();
    g.state.house.cash += 1;
    expect(reason(g)).toMatch(/cash balance does not match/);
  });

  it("queued decisions the sim would refuse", () => {
    const g = good();
    g.queued = [{ kind: "lend", amount: 10_000_000, rate: 0.06, borrower: GOOD }];
    expect(reason(g)).toMatch(/queued decision the game refuses: Not enough cash/);
  });

  it("an empty object", () => {
    expect(reason({})).toMatch(/Unsupported save version/);
  });
});
