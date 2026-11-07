// The markets in terminal play (A3): the bourse, commodities, holdings and venture stakes.
import { gameData } from "../src/data";
import { company, earningsEstimateFor, goodsValue, holdingValue, shareCost, sharesHeld, spaceUsed, warehouseSpace } from "../src/sim/markets/holdings";
import { dividendPerShare, harvestIndex, outcome } from "../src/sim/markets/prices";
import { freeCash } from "../src/sim/reserves";
import { marketsBook } from "../src/sim/systems/markets";
import type { Decision, GameState } from "../src/sim/types";
import { firstCall, nextCall, quartersLeft, remainingCommitment, stakeSalePrice, ventureType } from "../src/sim/ventures";

type Ask = (prompt: string) => Promise<string | null>;
const fl = (n: number) => `${Math.round(n).toLocaleString("en-US")} fl.`;
/** Prices keep their kreuzer-sized fractions: two decimals. */
const price = (n: number) => `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} fl.`;
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
const m = gameData.markets;

export function printBourse(s: GameState): void {
  const listed = s.markets.companies.filter((c) => c.status === "listed");
  console.log("\n--- Frankfurt bourse ---");
  if (!listed.length) console.log("  No companies are listed yet: the bourse trades state bonds.");
  listed.forEach((c, i) => {
    const est = earningsEstimateFor(s, c.id, gameData);
    const tier = m.reports[est.tier]!.name;
    const dps = dividendPerShare(c);
    console.log(`  ${i + 1}) ${c.name} (${c.sector}): ${price(c.price)} a share, last dividend ${price(c.last_dividend)} (yield ${pct(dps / c.price)}), earnings ${fl(est.low)} to ${fl(est.high)} a year by ${tier}, ${c.shares} shares${sharesHeld(s, c.id) ? `, you hold ${sharesHeld(s, c.id)}` : ""}`);
  });
  const coming = s.markets.companies.filter((c) => c.status === "upcoming").length;
  if (coming) console.log(`  (${coming} more companies will list in later years.)`);
  console.log("--- Commodities ---");
  m.commodities.forEach((t, i) => {
    const mk = s.markets.commodities[t.id]!;
    const held = s.markets.goods[t.id] ?? 0;
    console.log(`  ${String.fromCharCode(97 + i)}) ${t.name}: ${price(mk.price)} per ${t.unit} (normal ${price(t.base_price * mk.level)}), storage ${price(t.storage)} a quarter${held ? `, you hold ${held}` : ""}`);
  });
  const parts = m.regions.map((r) => `${outcome(m, s.markets.harvest[r.id] ?? "fair").name} in ${r.name}`);
  console.log(`  This year's harvest: ${parts.join(", ")} (index ${harvestIndex(s.markets.harvest, m.regions.map((r) => r.id), m).toFixed(2)}).`);
  console.log(`  Warehouse: ${spaceUsed(s, gameData)} of ${warehouseSpace(s, gameData)} space used.`);
}

/** Holdings lines for the markets: shares, goods and venture stakes. */
export function printMarketHoldings(s: GameState): void {
  for (const id of Object.keys(s.markets.shares)) console.log(`  ${sharesHeld(s, id)} shares of ${company(s, id)?.name ?? id}: worth ${fl(holdingValue(s, id))}`);
  for (const id of Object.keys(s.markets.goods)) {
    const t = m.commodities.find((c) => c.id === id)!;
    console.log(`  ${s.markets.goods[id]} ${t.unit} of ${t.name.toLowerCase()}: worth ${fl(goodsValue(s, id))}`);
  }
  for (const v of s.ventures.filter((x) => x.status === "active" || (x.status === "listed" && remainingCommitment(x) > 0))) {
    const t = ventureType(gameData, v.type);
    const where = v.status === "listed" ? `listed as ${company(s, v.company!)?.name}` : v.phase === "running" ? "running" : `building, ${Math.max(0, quartersLeft(s, v))} qtr left`;
    const sections = t.sections > 1 ? `, ${v.sections_open} of ${t.sections} sections open` : "";
    const calls = remainingCommitment(v) > 0 ? `, next call ${fl(nextCall(v))}, ${fl(remainingCommitment(v))} still to come` : v.calls_stopped && v.status === "active" ? ", no more calls" : "";
    console.log(`  Venture #${v.id} ${t.name} (${t.tier}): ${fl(v.invested)} paid in, ${where}${sections}${calls}`);
  }
}

export function marketsLine(s: GameState): string {
  return `Markets ${fl(marketsBook(s))}`;
}

/** The venture menu: what each type is, then a commitment. */
export async function askVentureCommit(preview: GameState, ask: Ask): Promise<Decision | null> {
  console.log("Ventures (you commit an amount; it is called in instalments while the venture is built):");
  gameData.ventures.forEach((t, i) => {
    const locked = preview.world.year < t.unlock_year ? `  [from ${t.unlock_year}]` : "";
    const years = (t.term_quarters / 4).toFixed(1);
    const what = t.tier === "short" ? `pays back +${pct(t.expected_return)} when built` : `earns about ${pct(t.expected_return)} a year once running${t.sections > 1 ? ` (in ${t.sections} sections)` : ""}, floats as ${t.company_name}`;
    console.log(`  ${i + 1}) ${t.name}, ${t.tier}: ${years} years to build, ${t.calls} calls every ${t.call_every} qtr, ${what}, fails ${pct(t.failure_risk)} over the build when calm${locked}`);
  });
  const t = gameData.ventures[Number(await ask(`Venture (1-${gameData.ventures.length}): `)) - 1];
  if (!t) return console.log("Unknown venture."), null;
  const amount = Number(await ask(`Commitment in gulden (first call is 1/${t.calls}; free cash ${fl(freeCash(preview))}): `));
  console.log(`First call: ${fl(firstCall(t, amount))}.`);
  return { kind: "invest_venture", venture: t.id, amount };
}

/** The markets menu: buy or sell shares and goods, buy a report, sell a venture stake. */
export async function askMarkets(preview: GameState, ask: Ask): Promise<Decision | null> {
  printBourse(preview);
  const pick = (await ask("[b] Buy shares  [s] Sell shares  [r] Company report  [g] Buy goods  [x] Sell goods  [v] Sell a venture stake  [Enter] Back: "))?.trim();
  const listed = preview.markets.companies.filter((c) => c.status === "listed");
  if (pick === "b" || pick === "s" || pick === "r") {
    const c = listed[Number(await ask(`Company (1-${listed.length}): `)) - 1];
    if (!c) return console.log("Unknown company."), null;
    if (pick === "r") {
      const tier = Number(await ask(`[1] ${m.reports[1]!.name} (${fl(m.reports[1]!.cost)})  [2] ${m.reports[2]!.name} (${fl(m.reports[2]!.cost)}): `));
      return { kind: "company_report", company: c.id, tier };
    }
    const n = Number(await ask(pick === "b" ? `Shares (one costs about ${fl(shareCost(c, 1, gameData))}; free cash ${fl(freeCash(preview))}): ` : `Shares (you hold ${sharesHeld(preview, c.id)}): `));
    return { kind: pick === "b" ? "buy_shares" : "sell_shares", company: c.id, shares: n };
  }
  if (pick === "g" || pick === "x") {
    const t = m.commodities[(await ask(`Commodity (a-${String.fromCharCode(96 + m.commodities.length)}): `))!.trim().charCodeAt(0) - 97];
    if (!t) return console.log("Unknown commodity."), null;
    const n = Number(await ask(`${t.unit} (each takes ${t.space} space; you hold ${preview.markets.goods[t.id] ?? 0}): `));
    return { kind: pick === "g" ? "buy_commodity" : "sell_commodity", commodity: t.id, units: n };
  }
  if (pick === "v") {
    const open = preview.ventures.filter((v) => v.status === "active");
    if (!open.length) return console.log("No unlisted venture stakes."), null;
    open.forEach((v) => console.log(`  #${v.id} ${ventureType(gameData, v.type).name}: ${fl(v.invested)} paid in, sells for ${fl(stakeSalePrice(v.invested, gameData.tuning))}`));
    const id = Number(await ask("Venture #: "));
    return { kind: "sell_venture", venture: id };
  }
  return null;
}
