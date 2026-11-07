import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { runOver } from "../src/sim/actions";
import { chronicle, dateOfTurn } from "../src/sim/chronicle";
import { succeed } from "../src/sim/family";
import { newGame } from "../src/sim/init";
import { createRng } from "../src/sim/rng";
import { endTurn } from "../src/sim/turn";
import type { GameState } from "../src/sim/types";
import { fresh, noDefaults, quiet } from "./helpers";
import { aggressiveDecisions, economyDecisions } from "../src/harness/golden";

const { tuning } = gameData;

/** Plays a whole run (or until bankruptcy) with a strategy. */
function fullRun(seed: number, strategy = economyDecisions): GameState {
  const rng = createRng(seed);
  let s = newGame(gameData, rng);
  while (!runOver(s, tuning)) s = endTurn(s, strategy(s, gameData), rng, gameData);
  return s;
}

describe("dateOfTurn", () => {
  it("counts quarters from the start date", () => {
    expect(dateOfTurn(1, tuning)).toEqual({ year: 1815, quarter: 1 });
    expect(dateOfTurn(4, tuning)).toEqual({ year: 1815, quarter: 4 });
    expect(dateOfTurn(5, tuning)).toEqual({ year: 1816, quarter: 1 });
    expect(dateOfTurn(144, tuning)).toEqual({ year: 1850, quarter: 4 });
  });
});

describe("chronicle", () => {
  it("opens with the founder and the opening books", () => {
    expect(chronicle(fresh(), gameData)[0]).toBe("In 1815, Johann Adler, aged 50, opened the books of Haus Adler in Frankfurt with 100,000 fl. in cash and 50,000 fl. owed to depositors.");
  });

  it("tells every succession, and says when the heir was untrained", () => {
    const s = fresh();
    s.world.year = 1830;
    s.world.turn = (1830 - 1815) * 4 + 1;
    succeed(s, quiet);
    const text = chronicle(s, gameData).join("\n");
    const heir = s.people.find((p) => p.is_head && p.death_year === null)!;
    expect(text).toContain(`In 1830 Johann Adler died, aged 65, and ${heir.name} took over at ${1830 - heir.birth_year}`);
    expect(text).toContain("untrained and unready");
  });

  it("describes people by their traits", () => {
    const s = fresh();
    s.people[0]!.traits = ["prudent", "aloof"];
    expect(chronicle(s, gameData)[0]).toMatch(/^In 1815, Johann Adler, prudent and aloof, aged 50, opened the books/);
    s.world.year = 1830;
    s.world.turn = (1830 - 1815) * 4 + 1;
    for (const p of s.people.slice(1)) p.traits = ["shrewd"];
    succeed(s, quiet);
    expect(chronicle(s, gameData)[1]).toMatch(/and \w+ Adler, shrewd, took over at \d+/);
  });

  it("says the founder led to the end when no one died", () => {
    expect(chronicle(fresh(), gameData)).toContain("Johann Adler led the house to the end.");
  });

  it("tells a whole run: history, decades and the ending, with every amount in gulden", () => {
    const s = fullRun(3);
    const text = chronicle(s, gameData);
    const all = text.join("\n");
    expect(all).toContain("Peace after Waterloo (1815)");
    expect(all).toContain("Panic reaches the continent (1826)");
    expect(all).toMatch(/Net worth at the close of 1815: [-\d,]+ fl\., 1820: /);
    expect(text.at(-1)).toMatch(/^By the end of 1850 the house was worth [-\d,]+ fl\., led by .+, aged \d+\. It stood (first|second|third|fourth|fifth|sixth) of the (two|three|four|five|six) houses still trading in Frankfurt\.$/);
    expect(all).not.toMatch(/undefined|NaN|—|\.\./);
  });

  it("ends a bankrupt run with the house closing its doors", () => {
    // Search a few seeds for one the aggressive strategy bankrupts.
    let s: GameState | undefined;
    for (let seed = 1; seed < 200 && !s; seed++) {
      const r = fullRun(seed, aggressiveDecisions);
      if (r.house.status === "bankrupt") s = r;
    }
    expect(s).toBeDefined();
    const text = chronicle(s!, gameData);
    expect(text.at(-1)).toMatch(/^In \d{4} the house could not meet its obligations, even after selling its assets, and closed its doors, worth [-\d,]+ fl\.$/);
    expect(text.join(" ")).not.toMatch(/\.\.|s's /);
    expect(text.join(" ")).toMatch(/The worst default was .+'s?, in \d{4}, which cost [\d,]+ fl\./);
  });

  it("an unfinished run ends at its current quarter", () => {
    let s = fresh();
    s = endTurn(s, [], noDefaults, quiet);
    expect(chronicle(s, gameData).at(-1)).toBe("At 1815 Q1 the house was worth 50,000 fl., led by Johann Adler, aged 50.");
  });

  it("writes possessives properly and never doubles a full stop", () => {
    const s = fresh();
    s.loans.push({ id: 1, borrower_id: 1, borrower_name: "Brenner Brothers", kind: "commercial", principal: 2000, rate: 0.1, quality: 0.5, start_turn: 1, term_quarters: 4, status: "defaulted" });
    s.ledger.push({ id: 99, turn: 1, account: "loans", category: "default", amount: -2000, note: "Loan #1: Brenner Brothers defaulted" });
    const text = chronicle(s, gameData).join(" ");
    expect(text).toContain("The worst default was Brenner Brothers', in 1815, which cost 2,000 fl. ");
    expect(text).not.toContain("..");
  });

  it("is the same for the same run", () => {
    expect(chronicle(fullRun(8), gameData)).toEqual(chronicle(fullRun(8), gameData));
  });
});
