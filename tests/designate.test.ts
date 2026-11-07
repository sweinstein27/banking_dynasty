import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { chronicle } from "../src/sim/chronicle";
import { applyDecisions } from "../src/sim/decisions";
import { checkDesignateHeir, headOf, succeed } from "../src/sim/family";
import { parseSave, toSave } from "../src/sim/save";
import { endTurn } from "../src/sim/turn";
import type { GameState } from "../src/sim/types";
import { fixedRng, fresh, quiet } from "./helpers";

const sc = gameData.tuning.family.succession;
const CALM = 0.999999;

/** 1830: Johann is 65; heirs (ids 2, 3, 4) are 27, 24 and 20, all trained with stats of 5. */
function house(): GameState {
  const s = fresh();
  s.world.year = 1830;
  s.world.turn = (1830 - 1815) * 4 + 1;
  [27, 24, 20].forEach((age, i) => Object.assign(s.people[i + 1]!, { birth_year: 1830 - age, acumen: 5, prudence: 5, connections: 5 }));
  return s;
}

function decide(s: GameState, heir: number): GameState {
  const r = applyDecisions(s, [{ kind: "designate_heir", heir }], gameData);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

describe("naming an heir", () => {
  it("records the named heir and uses one of the quarter's actions, moving no money", () => {
    const s0 = house();
    const s = decide(s0, 3);
    expect(s.house.designated_heir).toBe(3);
    expect(s.actions_this_turn).toBe(0); // A2: naming an heir uses no capacity
    expect(s.house.cash).toBe(s0.house.cash);
    expect(s.ledger).toHaveLength(s0.ledger.length);
  });

  it("refuses the head, the dead, strangers, and the heir already named", () => {
    const s = house();
    expect(checkDesignateHeir(s, { kind: "designate_heir", heir: 1 }, gameData)).toBe("No living heir #1");
    expect(checkDesignateHeir(s, { kind: "designate_heir", heir: 99 }, gameData)).toBe("No living heir #99");
    s.people[2]!.death_year = 1829;
    expect(checkDesignateHeir(s, { kind: "designate_heir", heir: 3 }, gameData)).toBe("No living heir #3");
    const named = decide(house(), 4);
    expect(checkDesignateHeir(named, { kind: "designate_heir", heir: 4 }, gameData)).toMatch(/already the named heir/);
  });

  it("can be changed: the latest choice stands", () => {
    let s = decide(house(), 3);
    s.actions_this_turn = 0;
    s = decide(s, 4);
    expect(s.house.designated_heir).toBe(4);
  });

  it("is in the news", () => {
    const s = endTurn(house(), [{ kind: "designate_heir", heir: 3 }], fixedRng(CALM), quiet);
    expect(s.news.some((n) => n.text === `Johann Adler names ${s.people[2]!.name} as heir to the house.`)).toBe(true);
  });
});

describe("succession with a named heir", () => {
  it("the named heir takes over, and passing over the eldest costs reputation", () => {
    const s = decide(house(), 3);
    succeed(s, quiet);
    expect(headOf(s)!.id).toBe(3);
    expect(s.successions[0]).toMatchObject({ to: 3, named: true, passed_over: 2, trained: true });
    expect(s.house.reputation).toBe(50 - sc.reputation_trained - sc.passed_over_reputation);
    expect(s.house.designated_heir).toBeNull();
  });

  it("naming the eldest costs nothing extra", () => {
    const s = decide(house(), 2);
    succeed(s, quiet);
    expect(s.successions[0]).toMatchObject({ to: 2, named: true, passed_over: null });
    expect(s.house.reputation).toBe(50 - sc.reputation_trained);
  });

  it("if the named heir has died, the automatic choice applies", () => {
    const s = decide(house(), 3);
    s.people[2]!.death_year = 1830;
    succeed(s, quiet);
    expect(headOf(s)!.id).toBe(2);
    expect(s.successions[0]).toMatchObject({ named: false, passed_over: null });
  });

  it("a named child inherits untrained", () => {
    const s = house();
    Object.assign(s.people[3]!, { birth_year: 1820 }); // 10 years old
    const named = decide(s, 4);
    succeed(named, quiet);
    expect(named.successions[0]).toMatchObject({ to: 4, trained: false, passed_over: 2 });
    expect(named.house.reputation).toBe(50 - sc.reputation_untrained - sc.passed_over_reputation);
  });

  it("the automatic choice also pays for passing over the eldest", () => {
    const s = house();
    Object.assign(s.people[1]!, { acumen: 2, prudence: 2, connections: 2 }); // the eldest is untrained
    succeed(s, quiet);
    expect(s.successions[0]).toMatchObject({ to: 3, named: false, passed_over: 2 });
    expect(s.house.reputation).toBe(50 - sc.reputation_trained - sc.passed_over_reputation);
  });

  it("the news and the chronicle tell it", () => {
    let s = decide(house(), 3);
    s.actions_this_turn = 0;
    // The mood roll, the random-event roll, then the death roll (0: Johann dies).
    s = endTurn(s, [], fixedRng(CALM, CALM, 0, CALM), quiet);
    const heir = s.people[2]!;
    const elder = s.people[1]!;
    const news = s.news.find((n) => n.kind === "family" && n.text.includes("has died"))!.text;
    expect(news).toContain(`${heir.name}, aged 24, takes over the house, as Johann Adler had named.`);
    expect(news).toContain(`The elder ${elder.name} is passed over, and the bourse mutters.`);
    expect(chronicle(s, gameData)[1]).toContain(`, as Johann had named, passing over the elder ${elder.name.split(" ")[0]}`);
  });

  it("saves keep the named heir, and refuse a house without the field", () => {
    const s = decide(house(), 3);
    const r = parseSave(toSave(s, 1, 1, []), gameData);
    expect(r.ok && r.save.state.house.designated_heir).toBe(3);
    const raw = JSON.parse(toSave(house(), 1, 1, []));
    delete raw.state.house.designated_heir;
    const bad = parseSave(JSON.stringify(raw), gameData);
    expect(bad.ok ? null : bad.reason).toMatch(/designated_heir/);
  });
});
