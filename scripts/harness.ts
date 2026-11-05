// Balancing harness. Usage: npm run harness -- [--runs N] [--strategies a,b,...] [--tuning FILE] [--out DIR]
// Plays every strategy on seeds 1 to N (the same seeds for each, so they are compared pair by pair),
// writes DIR/runs.csv, DIR/years.csv and DIR/flows.csv for analysis outside the game, prints a
// summary and checks the Week 7 balance targets. --tuning applies an overrides file (see
// src/harness/overrides.ts) without editing data/*.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gameData } from "../src/data";
import { applyOverrides, type Overrides } from "../src/harness/overrides";
import { runOnce, type FlowRow, type RunRow, type YearRow } from "../src/harness/run";
import { STRATEGIES } from "../src/harness/strategies";
import { startNetWorth, STRONG_FINISH, summarize } from "../src/harness/summary";
import { checkTargets } from "../src/harness/targets";
import { fl } from "../src/sim/format";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const runs = Number(arg("runs") ?? 1000);
const names = (arg("strategies") ?? Object.keys(STRATEGIES).join(",")).split(",").map((s) => s.trim());
const outDir = arg("out") ?? "out";
const tuningFile = arg("tuning");
for (const n of names) if (!STRATEGIES[n]) throw new Error(`Unknown strategy "${n}". Known: ${Object.keys(STRATEGIES).join(", ")}`);
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a whole number of at least 1");
const data = tuningFile ? applyOverrides(gameData, JSON.parse(readFileSync(tuningFile, "utf8")) as Overrides) : gameData;

/** Rows as CSV, columns in the order of the first row's keys. Values are numbers or plain words. */
function toCsv(rows: object[]): string {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]!);
  return [keys.join(","), ...rows.map((r) => keys.map((k) => String((r as Record<string, unknown>)[k])).join(","))].join("\n") + "\n";
}

const started = performance.now();
const runRows: RunRow[] = [];
const yearRows: YearRow[] = [];
const flowRows: FlowRow[] = [];
for (const name of names) {
  const t0 = performance.now();
  for (let seed = 1; seed <= runs; seed++) {
    const { run, years, flows } = runOnce(name, STRATEGIES[name]!, seed, data);
    runRows.push(run);
    yearRows.push(...years);
    flowRows.push(...flows);
  }
  console.log(`${name}: ${runs} runs in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "runs.csv"), toCsv(runRows));
writeFileSync(join(outDir, "years.csv"), toCsv(yearRows));
writeFileSync(join(outDir, "flows.csv"), toCsv(flowRows));

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const money = (x: number) => fl(Math.round(x));
const table = summarize(runRows, data).map((s) => ({
  strategy: s.strategy,
  bankrupt: pct(s.bankrupt_rate),
  p10: money(s.p10),
  median: money(s.median),
  mean: money(s.mean),
  p90: money(s.p90),
  "above start": pct(s.above_start),
  strong: pct(s.strong),
}));
console.log(`\nSeeds 1 to ${runs}${tuningFile ? `, with overrides from ${tuningFile}` : ""}. Start net worth ${fl(startNetWorth(data))}; a strong finish is ${fl(STRONG_FINISH)} or more in 1850.`);
console.table(table);
console.log("Targets:");
for (const t of checkTargets(runRows, data)) console.log(`  ${t.pass === null ? "n/a " : t.pass ? "PASS" : "FAIL"} ${t.id} ${t.description}: ${t.detail}`);
console.log(`Wrote runs.csv, years.csv and flows.csv to ${outDir}/ in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
