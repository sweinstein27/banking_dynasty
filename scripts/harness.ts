// Balancing harness. Usage: npm run harness -- [--runs N] [--strategies a,b,...] [--out DIR]
// Plays every strategy on seeds 1 to N (the same seeds for each, so they are compared pair by pair),
// writes DIR/runs.csv and DIR/years.csv for analysis outside the game, and prints a summary.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gameData } from "../src/data";
import { runOnce, type RunRow, type YearRow } from "../src/harness/run";
import { STRATEGIES } from "../src/harness/strategies";
import { startNetWorth, STRONG_FINISH, summarize } from "../src/harness/summary";
import { fl } from "../src/sim/format";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const runs = Number(arg("runs") ?? 1000);
const names = (arg("strategies") ?? Object.keys(STRATEGIES).join(",")).split(",").map((s) => s.trim());
const outDir = arg("out") ?? "out";
for (const n of names) if (!STRATEGIES[n]) throw new Error(`Unknown strategy "${n}". Known: ${Object.keys(STRATEGIES).join(", ")}`);
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a whole number of at least 1");

/** Rows as CSV, columns in the order of the first row's keys. Values are numbers or plain words. */
function toCsv(rows: object[]): string {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]!);
  return [keys.join(","), ...rows.map((r) => keys.map((k) => String((r as Record<string, unknown>)[k])).join(","))].join("\n") + "\n";
}

const started = performance.now();
const runRows: RunRow[] = [];
const yearRows: YearRow[] = [];
for (const name of names) {
  const t0 = performance.now();
  for (let seed = 1; seed <= runs; seed++) {
    const { run, years } = runOnce(name, STRATEGIES[name]!, seed, gameData);
    runRows.push(run);
    yearRows.push(...years);
  }
  console.log(`${name}: ${runs} runs in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "runs.csv"), toCsv(runRows));
writeFileSync(join(outDir, "years.csv"), toCsv(yearRows));

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const money = (x: number) => fl(Math.round(x));
const table = summarize(runRows, gameData).map((s) => ({
  strategy: s.strategy,
  bankrupt: pct(s.bankrupt_rate),
  p10: money(s.p10),
  median: money(s.median),
  mean: money(s.mean),
  p90: money(s.p90),
  "above start": pct(s.above_start),
  strong: pct(s.strong),
}));
console.log(`\nSeeds 1 to ${runs}. Start net worth ${fl(startNetWorth(gameData))}; a strong finish is ${fl(STRONG_FINISH)} or more in 1850.`);
console.table(table);
console.log(`Wrote ${join(outDir, "runs.csv")} and ${join(outDir, "years.csv")} in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
