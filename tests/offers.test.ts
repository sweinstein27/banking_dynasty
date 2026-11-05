import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { checkBuyBond } from "../src/sim/bonds";
import { newGame } from "../src/sim/init";
import { bondOffers, lendOffers, ventureOffers } from "../src/sim/offers";
import { checkInvestVenture } from "../src/sim/ventures";

const { tuning } = gameData;

describe("lendOffers", () => {
  it("lists every tier from tuning with its quality and maximum rate", () => {
    expect(lendOffers(tuning)).toEqual([
      { tier: "poor", quality: 0.3, max_rate: 0.16 },
      { tier: "fair", quality: 0.6, max_rate: 0.1 },
      { tier: "good", quality: 0.9, max_rate: 0.06 },
    ]);
  });
});

describe("bondOffers", () => {
  it("prices every state at par when calm", () => {
    const offers = bondOffers(newGame(gameData), gameData);
    expect(offers.map((o) => o.id)).toEqual(gameData.states.map((s) => s.id));
    expect(offers.every((o) => o.price === 1)).toBe(true);
  });

  it("prices below par in a panic", () => {
    const s = newGame(gameData);
    s.world.sentiment = "panic";
    const naples = bondOffers(s, gameData).find((o) => o.id === "naples")!;
    expect(naples.price).toBeLessThan(1);
  });

  it("blocks states above the house's reputation, matching what checkBuyBond refuses", () => {
    const s = newGame(gameData);
    for (const o of bondOffers(s, gameData)) {
      const refused = checkBuyBond(s, { kind: "buy_bond", state: o.id, face_value: 10000 }, gameData);
      expect(o.blocked !== null).toBe(refused !== null);
    }
    expect(bondOffers(s, gameData).find((o) => o.id === "prussia")!.blocked).toBe("Needs reputation 55");
  });

  it("blocks a state that has defaulted", () => {
    const s = newGame(gameData);
    s.defaulted_states.push("naples");
    expect(bondOffers(s, gameData).find((o) => o.id === "naples")!.blocked).toBe("Defaulted");
  });
});

describe("ventureOffers", () => {
  it("blocks railways before their unlock year and allows them after", () => {
    const s = newGame(gameData);
    expect(ventureOffers(s, gameData).find((o) => o.id === "railway")!.blocked).toBe("Not before 1835");
    s.world.year = 1835;
    expect(ventureOffers(s, gameData).find((o) => o.id === "railway")!.blocked).toBeNull();
  });

  it("matches what checkInvestVenture refuses", () => {
    const s = newGame(gameData);
    for (const o of ventureOffers(s, gameData)) {
      const refused = checkInvestVenture(s, { kind: "invest_venture", venture: o.id, amount: 10000 }, gameData);
      expect(o.blocked !== null).toBe(refused !== null);
    }
  });

  it("scales the failure chance with the mood, capped at 1", () => {
    const s = newGame(gameData);
    const calm = ventureOffers(s, gameData).find((o) => o.id === "mill")!.failure_chance;
    s.world.sentiment = "panic";
    const panic = ventureOffers(s, gameData).find((o) => o.id === "mill")!.failure_chance;
    expect(calm).toBe(0.15);
    expect(panic).toBe(Math.min(1, 0.15 * tuning.sentiment_multiplier.panic));
  });
});
