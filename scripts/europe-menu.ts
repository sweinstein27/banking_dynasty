// Europe in terminal play (C1): the cities as the house knows them, branches, and bills of exchange.
import { gameData } from "../src/data";
import { billDiscount, billFace, billRoom, branchCandidates, branchHead } from "../src/sim/europe/branches";
import { abroad, cityState, onOrAfter, quote } from "../src/sim/europe/world";
import { newsDelay } from "../src/sim/news";
import { freeCash } from "../src/sim/reserves";
import { europeBook } from "../src/sim/systems/europe";
import type { Decision, GameState } from "../src/sim/types";

type Ask = (prompt: string) => Promise<string | null>;
const fl = (n: number) => `${Math.round(n).toLocaleString("en-US")} fl.`;
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
const e = gameData.europe;
const cur = (id: string) => e.currencies.find((c) => c.id === id)!;

/** Every foreign city as the house knows it, with the Frankfurt quote and how long its news takes. */
export function printEurope(s: GameState): void {
  console.log("\n--- Europe, as the latest letters tell it ---");
  abroad(gameData).forEach((c, i) => {
    const cs = cityState(s, c.id)!;
    const k = cs.known;
    const age = s.world.turn - 1 - k.as_of;
    const trouble = k.status === "peace" ? "" : `, ${k.status.toUpperCase()}`;
    const branch = s.europe.branches.find((b) => b.city === c.id);
    const shut = !onOrAfter(s.world, c.opens) ? `  [branches from ${c.opens.year}]` : "";
    console.log(
      `  ${i + 1}) ${c.name}: ${k.mood}${trouble}${age > 0 ? ` (news ${age} qtr old)` : ""}; ${cur(c.currency).name} at ${quote(s, gameData, c.id).toFixed(3)} fl. (par ${cur(c.currency).par}), rate ${pct(c.rate)}, news takes ${newsDelay(s, c.id, gameData)} days${branch ? "; BRANCH" : ""}${shut}`,
    );
  });
}

/** Holdings lines for Europe: branches and bills. */
export function printEuropeHoldings(s: GameState): void {
  for (const b of s.europe.branches) {
    const c = e.cities.find((x) => x.id === b.city)!;
    const head = branchHead(s, b);
    console.log(`  Branch in ${c.name}: ${b.capital.toFixed(0)} ${cur(c.currency).name} capital, worth ${fl(b.book)}; deposits ${b.deposits.toFixed(0)}; last quarter ${b.last_profit >= 0 ? "+" : ""}${b.last_profit.toFixed(0)}; ${head ? `run by ${head.name}` : "NO HEAD"}`);
  }
  for (const b of s.europe.bills) console.log(`  Bill #${b.id} on ${e.cities.find((x) => x.id === b.city)!.name}: ${b.face.toFixed(0)} ${cur(e.cities.find((x) => x.id === b.city)!.currency).name}, cost ${fl(b.cost)}, paid at the end of this quarter`);
}

export function europeLine(s: GameState): string {
  return `Europe ${fl(europeBook(s))}`;
}

async function pickCity(ask: Ask): Promise<string | null> {
  const list = abroad(gameData);
  const c = list[Number(await ask(`City (1-${list.length}): `)) - 1];
  if (!c) return console.log("Unknown city."), null;
  return c.id;
}

/** The Europe menu: open, fund, recall, staff or close a branch; buy bills. */
export async function askEurope(preview: GameState, ask: Ask): Promise<Decision | null> {
  printEurope(preview);
  printEuropeHoldings(preview);
  const pick = (await ask("[o] Open a branch  [f] Send capital  [r] Recall capital  [a] Appoint a head  [x] Close a branch  [b] Buy bills  [Enter] Back: "))?.trim();
  if (!pick) return null;
  const city = await pickCity(ask);
  if (!city) return null;
  const c = e.cities.find((x) => x.id === city)!;
  if (pick === "o" || pick === "a") {
    const people = branchCandidates(preview, gameData);
    if (!people.length) return console.log("No one of the family is free and of age to run a branch."), null;
    people.forEach((p, i) => console.log(`  ${i + 1}) ${p.name}: acumen ${p.acumen}, prudence ${p.prudence}, connections ${p.connections}${p.traits.length ? `, ${p.traits.join(", ")}` : ""}`));
    const p = people[Number(await ask(`Who (1-${people.length}): `)) - 1];
    if (!p) return console.log("No one chosen."), null;
    if (pick === "a") return { kind: "appoint_branch_head", city, head: p.id };
    const capital = Number(await ask(`Capital in gulden (at least ${fl(e.branch.min_capital)}; setup costs ${fl(c.setup)}, upkeep ${fl(c.upkeep)} a quarter; free cash ${fl(freeCash(preview))}): `));
    return { kind: "open_branch", city, head: p.id, capital };
  }
  if (pick === "f" || pick === "r") {
    const amount = Number(await ask(`Gulden to ${pick === "f" ? "send" : "recall"} (costs ${pct(e.branch.transfer_spread)} in exchange): `));
    return { kind: "fund_branch", city, amount: pick === "f" ? amount : -amount };
  }
  if (pick === "x") return { kind: "close_branch", city };
  if (pick === "b") {
    const amount = Number(await ask(`Gulden (discount ${pct(billDiscount(c, gameData))}; room for ${fl(billRoom(preview, gameData, city))}; free cash ${fl(freeCash(preview))}): `));
    if (amount > 0) console.log(`That buys ${billFace(preview, gameData, city, amount).toFixed(0)} ${cur(c.currency).name}, paid at the end of the quarter.`);
    return { kind: "buy_bill", city, amount };
  }
  return null;
}
