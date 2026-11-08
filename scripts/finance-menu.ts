// High finance in terminal play (A5): state loans, credit to houses, auctions and insurance.
import { gameData } from "../src/data";
import { bidPrice, openLots, assetSalePrice } from "../src/sim/finance/auctions";
import { cautionFor, contractGate, openContracts } from "../src/sim/finance/contracts";
import { activeHouseLoans, openHouseRequests } from "../src/sim/finance/houseLoans";
import { activePolicies, exposure, openCoverRequests, policyName, premiumFor } from "../src/sim/finance/insurance";
import { freeCash } from "../src/sim/reserves";
import { financeBook } from "../src/sim/systems/finance";
import type { Decision, GameState } from "../src/sim/types";

type Ask = (prompt: string) => Promise<string | null>;
const fl = (n: number) => `${Math.round(n).toLocaleString("en-US")} fl.`;
const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;
const f = gameData.finance;
const houseName = (s: GameState, id: string) => s.houses.find((h) => h.id === id)?.name ?? id;
const stateName = (id: string) => gameData.states.find((x) => x.id === id)?.name ?? id;

export function financeLine(s: GameState): string {
  return `High finance ${fl(financeBook(s))}`;
}

/** Everything open this quarter, and what the house holds. */
export function printFinance(s: GameState): void {
  console.log("\n--- State loans open for bids ---");
  const contracts = openContracts(s);
  if (!contracts.length) console.log("  None this quarter.");
  contracts.forEach((c, i) => {
    const issuer = gameData.states.find((x) => x.id === c.state)!;
    console.log(`  ${i + 1}) ${issuer.name}: ${fl(c.size)} at ${pct(c.coupon)} for ${c.term_years} years. Needs reputation ${contractGate(s, issuer, gameData)}, caution money ${fl(cautionFor(c, gameData))}${c.player_bid !== null ? `. You bid ${pct(c.player_bid)}` : ""}`);
  });
  for (const c of s.finance.contracts.filter((x) => x.status === "placing")) console.log(`  Placing the ${stateName(c.state)} loan: ${fl(c.placed)} of ${fl(c.size)} placed at ${pct(c.commission!)} commission, ${c.quarters_placed} of ${f.contracts.placement.quarters} quarters`);

  console.log("--- Houses asking for credit ---");
  const reqs = openHouseRequests(s);
  if (!reqs.length) console.log("  None.");
  reqs.forEach((r, i) => console.log(`  ${i + 1}) ${houseName(s, r.house)} asks ${fl(r.amount)} for ${r.term_quarters} quarters, at up to ${pct(r.max_rate)}`));
  for (const l of activeHouseLoans(s)) console.log(`  Owed by ${houseName(s, l.house)}: ${fl(l.principal)} at ${pct(l.rate)}, due turn ${l.due_turn}`);

  console.log("--- Auctions ---");
  const lots = openLots(s);
  if (!lots.length) console.log("  Nothing under the hammer.");
  lots.forEach((l, i) => console.log(`  ${i + 1}) ${l.name}, valued at ${fl(l.appraisal)}${l.player_bid !== null ? `. You bid ${fl(bidPrice(l, l.player_bid))}` : ""}`));
  s.finance.assets.forEach((a, i) => console.log(`  Owned ${String.fromCharCode(97 + i)}) ${a.name}: ${fl(a.appraisal)} (paid ${fl(a.paid)})`));

  console.log("--- Requests for cover ---");
  const cover = openCoverRequests(s);
  if (!cover.length) console.log("  None.");
  cover.forEach((r, i) => console.log(`  ${i + 1}) ${policyName(r)}: ${fl(r.value)} for ${r.quarters} quarter${r.quarters === 1 ? "" : "s"}, premium ${pct(r.premium_rate)} (${fl(premiumFor(r, 1))} for the whole)`));
  const live = activePolicies(s);
  if (live.length) console.log(`  The house insures ${live.length} risks, ${fl(exposure(s))} in all.`);
}

async function pick<T>(ask: Ask, items: T[], prompt: string): Promise<T | null> {
  if (!items.length) return null;
  const n = Number((await ask(prompt))?.trim());
  return items[n - 1] ?? null;
}

async function pickRate(ask: Ask, options: number[], prompt: string): Promise<number | null> {
  console.log(`  ${options.map((o, i) => `[${i + 1}] ${pct(o)}`).join("  ")}`);
  const n = Number((await ask(prompt))?.trim());
  return options[n - 1] ?? null;
}

/** The high finance menu. Returns a decision, or null to go back. */
export async function askFinance(s: GameState, ask: Ask): Promise<Decision | null> {
  printFinance(s);
  console.log(`  Free cash ${fl(freeCash(s))}.`);
  const choice = (await ask("[1] Bid for a state loan  [2] Lend to a house  [3] Bid at auction  [4] Sell an asset  [5] Underwrite  [b] Back: "))?.trim();
  if (choice === "1") {
    const c = await pick(ask, openContracts(s), "Which loan? ");
    if (!c) return null;
    const commission = await pickRate(ask, f.contracts.commissions, "Commission to ask: ");
    return commission === null ? null : { kind: "bid_contract", contract: c.id, commission };
  }
  if (choice === "2") {
    const r = await pick(ask, openHouseRequests(s), "Which house? ");
    if (!r) return null;
    const rates = [0.06, 0.08, 0.1, 0.12, 0.15, 0.2].filter((x) => x <= r.max_rate + 1e-9);
    const rate = await pickRate(ask, rates, "Your rate: ");
    return rate === null ? null : { kind: "lend_house", request: r.id, rate };
  }
  if (choice === "3") {
    const lot = await pick(ask, openLots(s), "Which lot? ");
    if (!lot) return null;
    console.log(`  ${f.auctions.bids.map((b, i) => `[${i + 1}] ${fl(bidPrice(lot, b))}`).join("  ")}`);
    const bid = f.auctions.bids[Number((await ask("Your bid: "))?.trim()) - 1];
    return bid === undefined ? null : { kind: "bid_lot", lot: lot.id, bid };
  }
  if (choice === "4") {
    s.finance.assets.forEach((a, i) => console.log(`  ${i + 1}) ${a.name}: sells for ${fl(assetSalePrice(a, f.auctions.sale_discount))}`));
    const a = await pick(ask, s.finance.assets, "Which asset? ");
    return a ? { kind: "sell_asset", asset: a.id } : null;
  }
  if (choice === "5") {
    const r = await pick(ask, openCoverRequests(s), "Which risk? ");
    if (!r) return null;
    const line = await pickRate(ask, f.insurance.lines, "Your line (share of the value): ");
    return line === null ? null : { kind: "underwrite", request: r.id, line };
  }
  return null;
}
