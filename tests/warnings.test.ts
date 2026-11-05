import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { parseSave, toSave } from "../src/sim/save";
import { moodWithWarnings, startPanicWarning } from "../src/sim/sentiment";
import type { GameData, GameEvent } from "../src/sim/tuning";
import { endTurn } from "../src/sim/turn";
import type { GameState } from "../src/sim/types";
import { fixedRng, fresh, quiet } from "./helpers";

const { tuning } = gameData;
const { min, max } = tuning.sentiment.panic_warning_quarters;
const CALM = 0.999999;
/** From uneasy, a roll of 0.35 lands in the panic band (after 0.3 to calm, before 0.4). */
const TO_PANIC = 0.35;

function uneasy(): GameState {
  const s = fresh();
  s.world.sentiment = "uneasy";
  return s;
}

describe("moodWithWarnings", () => {
  it("turns a roll into panic into a countdown of min to max quarters, staying uneasy", () => {
    const low = uneasy();
    expect(moodWithWarnings(low, "panic", fixedRng(0), tuning)).toBe("uneasy");
    expect(low.panic_warning).toEqual({ turns_left: min });
    const high = uneasy();
    moodWithWarnings(high, "panic", fixedRng(CALM), tuning);
    expect(high.panic_warning).toEqual({ turns_left: max });
  });

  it("leaves other rolls alone when no countdown runs, drawing no extra roll", () => {
    let calls = 0;
    const s = uneasy();
    expect(moodWithWarnings(s, "calm", { next: () => (calls++, 0) }, tuning)).toBe("calm");
    expect(calls).toBe(0);
  });

  it("keeps a panicking market in panic without a countdown", () => {
    const s = fresh();
    s.world.sentiment = "panic";
    expect(moodWithWarnings(s, "panic", fixedRng(0), tuning)).toBe("panic");
    expect(s.panic_warning).toBeNull();
  });

  it("holds a running countdown uneasy whatever the roll, then breaks into panic", () => {
    const s = uneasy();
    s.panic_warning = { turns_left: 2 };
    expect(moodWithWarnings(s, "calm", fixedRng(0), tuning)).toBe("uneasy");
    expect(s.panic_warning).toEqual({ turns_left: 1 });
    expect(moodWithWarnings(s, "calm", fixedRng(0), tuning)).toBe("panic");
    expect(s.panic_warning).toBeNull();
  });
});

describe("panic warnings over End Turn", () => {
  it("give exactly the countdown's quarters of uneasy warning news before the panic", () => {
    // Turn 1: the mood roll heads for panic and the countdown roll picks the minimum.
    let s = endTurn(uneasy(), [], fixedRng(TO_PANIC, 0, CALM), quiet);
    expect(s.world.sentiment).toBe("uneasy");
    const moods: string[] = [];
    const warnings: string[] = [];
    for (let i = 0; i < min + 1; i++) {
      warnings.push(...s.news.filter((n) => n.turn === s.world.turn - 1 && n.kind === "warning").map((n) => n.text));
      moods.push(s.world.sentiment);
      s = endTurn(s, [], fixedRng(0.1), quiet); // rolls that would calm the market are ignored
    }
    expect(moods).toEqual([...Array(min).fill("uneasy"), "panic"]);
    expect(warnings).toHaveLength(min);
    expect(warnings[0]).toMatch(new RegExp(`Warning: a panic is coming ${min === 1 ? "next quarter" : `in ${min} quarters`}\\.$`));
    expect(warnings.at(-1)).toMatch(/Warning: a panic is coming next quarter\.$/);
  });

  it("each warning carries one of the warning signs", () => {
    const s = endTurn(uneasy(), [], fixedRng(TO_PANIC, 0, CALM), quiet);
    const w = s.news.find((n) => n.kind === "warning")!;
    expect(tuning.sentiment.warning_signs.some((sign) => w.text.startsWith(sign))).toBe(true);
  });
});

describe("events and warnings", () => {
  const data = (effects: GameEvent["effects"]): GameData => ({
    ...quiet,
    events: [{ id: "e", title: "E", text: "E.", historical: true, year: 1815, quarter: 2, conditions: {}, effects }],
  });

  it("panic_warning starts a countdown and turns the market uneasy", () => {
    const s = endTurn(fresh(), [], fixedRng(CALM), data([{ kind: "panic_warning", quarters: 2 }]));
    expect(s.panic_warning).toEqual({ turns_left: 2 });
    expect(s.world.sentiment).toBe("uneasy");
  });

  it("panic_warning does nothing while a countdown runs or the market panics", () => {
    const running = fresh();
    running.panic_warning = { turns_left: 3 };
    running.world.sentiment = "uneasy";
    // The running countdown ticks to 2 at the mood step; the event must not reset it.
    expect(endTurn(running, [], fixedRng(CALM), data([{ kind: "panic_warning", quarters: 1 }])).panic_warning).toEqual({ turns_left: 2 });
    const s = fresh();
    s.world.sentiment = "panic";
    expect(endTurn(s, [], fixedRng(CALM), data([{ kind: "panic_warning", quarters: 2 }])).panic_warning).toBeNull();
  });

  it("set_sentiment cannot calm a market under warning, but a panic ends the countdown at once", () => {
    const warned = () => {
      const s = uneasy();
      s.panic_warning = { turns_left: 3 };
      return s;
    };
    const calmed = endTurn(warned(), [], fixedRng(CALM), data([{ kind: "set_sentiment", sentiment: "calm" }]));
    expect(calmed.world.sentiment).toBe("uneasy");
    const broken = endTurn(warned(), [], fixedRng(CALM), data([{ kind: "set_sentiment", sentiment: "panic" }]));
    expect(broken.world.sentiment).toBe("panic");
    expect(broken.panic_warning).toBeNull();
  });

  it("startPanicWarning rounds and floors the quarters to at least 1", () => {
    const s = fresh();
    startPanicWarning(s, 0);
    expect(s.panic_warning).toEqual({ turns_left: 1 });
  });
});

describe("the 1825 crisis in the real data", () => {
  it("warns in 1825 Q3 and Q4 before the panic of 1826 Q1", () => {
    let s = fresh();
    const seen: Record<string, string[]> = {};
    while (!(s.world.year === 1826 && s.world.quarter === 1)) {
      s = endTurn(s, [], fixedRng(CALM), { ...gameData, tuning: quiet.tuning });
      seen[`${s.world.year} Q${s.world.quarter}`] = [s.world.sentiment, ...s.news.filter((n) => n.turn === s.world.turn - 1).map((n) => n.kind)];
    }
    expect(seen["1825 Q3"]).toEqual(expect.arrayContaining(["uneasy", "event", "warning"]));
    expect(seen["1825 Q4"]).toEqual(expect.arrayContaining(["uneasy", "event", "warning"]));
    expect(seen["1826 Q1"]![0]).toBe("panic");
  });
});

describe("saves with a warning", () => {
  it("keep the countdown, and refuse a state without the field", () => {
    const s = uneasy();
    s.panic_warning = { turns_left: 2 };
    const r = parseSave(toSave(s, 1, 1, []), gameData);
    expect(r.ok && r.save.state.panic_warning).toEqual({ turns_left: 2 });
    const raw = JSON.parse(toSave(fresh(), 1, 1, []));
    delete raw.state.panic_warning;
    const bad = parseSave(JSON.stringify(raw), gameData);
    expect(bad.ok ? null : bad.reason).toMatch(/panic_warning/);
  });
});
