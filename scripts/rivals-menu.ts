// Rivals in terminal play (B1): offers for your staff, plots you have heard of, schemes and paper.
import { gameData } from "../src/data";
import { tradingHouses } from "../src/sim/houses";
import { freeCash } from "../src/sim/reserves";
import { heardPlots, heldPaper, openPoachOffers, paperCost, paperRoom, plotWords, rivalsBook, schemeTerms, shortHanded, type SchemeKind } from "../src/sim/systems/rivals";
import type { Decision, GameState } from "../src/sim/types";

type Ask = (prompt: string) => Promise<string | null>;
const fl = (n: number) => `${Math.round(n).toLocaleString("en-US")} fl.`;
const r = gameData.rivals;
const houseName = (s: GameState, id: string) => s.houses.find((h) => h.id === id)?.name ?? id;

export function rivalsLine(s: GameState): string {
  return `Paper ${fl(rivalsBook(s))}`;
}

/** What the rivals are doing this quarter, and the paper the house holds. */
export function printRivals(s: GameState): void {
  console.log("\n--- Rivals courting your staff ---");
  const offers = openPoachOffers(s);
  if (!offers.length) console.log("  None.");
  offers.forEach((o, i) => {
    const m = s.counting.staff.find((x) => x.id === o.staff);
    console.log(`  ${i + 1}) ${houseName(s, o.house)} offers ${m?.name ?? "a member"} ${fl(o.wage)} a quarter${o.matched ? " (matched)" : ""}`);
  });
  console.log("--- Plots you have heard of ---");
  const plots = heardPlots(s);
  if (!plots.length) console.log("  None.");
  plots.forEach((p, i) => console.log(`  ${i + 1}) ${plotWords(p, s)}. Countering costs ${fl(r.plots.counter_cost[p.kind])}`));
  console.log("--- The other houses ---");
  tradingHouses(s).forEach((h, i) => console.log(`  ${i + 1}) ${h.name}: opinion ${h.opinion}, reputation ${h.reputation}, wealth ${fl(h.wealth)}${shortHanded(s, h.id) ? ", short-handed" : ""}`));
  console.log("--- Paper held ---");
  const paper = heldPaper(s);
  if (!paper.length) console.log("  None.");
  paper.forEach((p, i) => console.log(`  ${i + 1}) ${houseName(s, p.house)}: ${fl(p.face)} at ${Math.round(p.rate * 1000) / 10}%, due turn ${p.due_turn}`));
}

async function pick<T>(ask: Ask, items: T[], prompt: string): Promise<T | null> {
  if (!items.length) return null;
  const n = Number((await ask(prompt))?.trim());
  return items[n - 1] ?? null;
}

/** The rivals menu. Returns a decision, or null to go back. */
export async function askRivals(s: GameState, ask: Ask): Promise<Decision | null> {
  printRivals(s);
  console.log(`  Free cash ${fl(freeCash(s))}`);
  const choice = (await ask("[1] Match a wage  [2] Counter a plot  [3] Scheme against a house  [4] Buy a house's paper  [5] Present paper  [b] Back: "))?.trim();
  if (choice === "1") {
    const o = await pick(ask, openPoachOffers(s), "Which offer? ");
    return o ? { kind: "match_wage", staff: o.staff } : null;
  }
  if (choice === "2") {
    const p = await pick(ask, heardPlots(s), "Which plot? ");
    return p ? { kind: "counter_plot", plot: p.id } : null;
  }
  if (choice === "3") {
    const h = await pick(ask, tradingHouses(s), "Which house? ");
    if (!h) return null;
    const kinds: SchemeKind[] = ["rumours", "lure_clerk"];
    kinds.forEach((k, i) => {
      const t = schemeTerms(s, h, k, gameData);
      console.log(`  [${i + 1}] ${k === "rumours" ? "Spread rumours" : "Lure a clerk"}: ${fl(t.cost)}, ${t.odds}, ${t.found}`);
    });
    const k = kinds[Number((await ask("Which scheme? "))?.trim()) - 1];
    return k ? { kind: "scheme", house: h.id, scheme: k } : null;
  }
  if (choice === "4") {
    const h = await pick(ask, tradingHouses(s), "Which house? ");
    if (!h) return null;
    console.log(`  Up to ${fl(paperRoom(s, h, gameData))} to be had, at ${Math.round(r.paper.discount * 100)}% below par. 10,000 fl. costs ${fl(paperCost(10000, gameData))}.`);
    const amount = Number((await ask("Face value: "))?.trim());
    return Number.isFinite(amount) && amount > 0 ? { kind: "buy_paper", house: h.id, amount } : null;
  }
  if (choice === "5") {
    const p = await pick(ask, heldPaper(s), "Which paper? ");
    return p ? { kind: "present_paper", paper: p.id } : null;
  }
  return null;
}
