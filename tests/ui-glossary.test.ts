// Explanation cards: every link leads to a card, and every term the UI names exists.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { GLOSSARY, parseGlossary } from "../src/ui/glossary";
import { breakdown, type BreakdownId } from "../src/ui/model/breakdowns";
import { newGame } from "../src/sim/init";
import { createRng } from "../src/sim/rng";

describe("glossary", () => {
  it("links only to cards that exist", () => {
    for (const [id, card] of Object.entries(GLOSSARY)) {
      for (const s of parseGlossary(card.body(gameData))) {
        if ("link" in s) expect(GLOSSARY[s.link], `${id} links to ${s.link}`).toBeDefined();
      }
    }
  });

  it("has no em dashes and no unclosed links", () => {
    for (const card of Object.values(GLOSSARY)) {
      const text = card.body(gameData);
      expect(text).not.toMatch(/—/);
      expect(parseGlossary(text).every((s) => !s.text.includes("[["))).toBe(true);
    }
  });

  it("covers every term the breakdowns link to", () => {
    const s = newGame(gameData, createRng(1));
    const ids: BreakdownId[] = ["cash", "worth", "reputation", "deposits", "upkeep", "market", "date"];
    for (const id of ids) {
      const b = breakdown(id, s, s, gameData);
      if (b.term) expect(GLOSSARY[b.term], b.term).toBeDefined();
      for (const sec of b.sections) for (const l of [...sec.lines, ...(sec.total ? [sec.total] : [])]) if (l.term) expect(GLOSSARY[l.term], l.term).toBeDefined();
    }
  });

  it("covers every <Term id> written in the UI", () => {
    const dir = "src/ui";
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".tsx"))) {
      for (const m of readFileSync(`${dir}/${f}`, "utf8").matchAll(/<Term id="([a-z_]+)"/g)) expect(GLOSSARY[m[1]!], `${f}: ${m[1]}`).toBeDefined();
    }
  });

  it("parses links with and without their own words", () => {
    expect(parseGlossary("See [[reserve]] and [[free_cash|spare money]].")).toEqual([
      { text: "See " },
      { link: "reserve", text: "reserve" },
      { text: " and " },
      { link: "free_cash", text: "spare money" },
      { text: "." },
    ]);
  });
});
