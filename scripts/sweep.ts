// Tuning sweep. Usage: npm run sweep -- --grid FILE [--runs N] [--strategies a,b,...]
// The grid file is { "base": overrides, "vary": { "tuning.loans.p0": [0.03, 0.04], "events.warehouse-fire.weight": [1, 2] } }.
// Every combination of the varied values is played on seeds 1 to N (200 by default) and ranked by
// how many Week 7 targets it passes. Confirm a winner with `npm run harness -- --tuning FILE`.
import { readFileSync } from "node:fs";
import { gameData } from "../src/data";
import { applyOverrides, combine, overrideAt, type Overrides } from "../src/harness/overrides";
import { runOnce, type RunRow } from "../src/harness/run";
import { STRATEGIES } from "../src/harness/strategies";
import { summarize } from "../src/harness/summary";
import { CONTENDERS, checkTargets } from "../src/harness/targets";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const gridFile = arg("grid");
if (!gridFile) throw new Error("--grid FILE is required");
const runs = Number(arg("runs") ?? 200);
const names = (arg("strategies") ?? Object.keys(STRATEGIES).join(",")).split(",").map((s) => s.trim());
const grid = JSON.parse(readFileSync(gridFile, "utf8")) as { base?: Overrides; vary: Record<string, unknown[]> };

/** Every combination of the varied values, as [path, value] lists. */
function combinations(vary: Record<string, unknown[]>): [string, unknown][][] {
  return Object.entries(vary).reduce<[string, unknown][][]>(
    (acc, [path, values]) => acc.flatMap((combo) => values.map((v) => [...combo, [path, v] as [string, unknown]])),
    [[]],
  );
}

const results = combinations(grid.vary).map((combo) => {
  const overrides = combine(grid.base ?? {}, ...combo.map(([p, v]) => overrideAt(p, v)));
  const data = applyOverrides(gameData, overrides);
  const rows: RunRow[] = [];
  for (const name of names) for (let seed = 1; seed <= runs; seed++) rows.push(runOnce(name, STRATEGIES[name]!, seed, data).run);
  const targets = checkTargets(rows, data);
  const sums = summarize(rows, data);
  const label = combo.map(([p, v]) => `${p.split(".").slice(-2).join(".")}=${v}`).join(" ");
  const weakest = Math.min(...CONTENDERS.map((n) => sums.find((s) => s.strategy === n)?.strong ?? 0));
  process.stdout.write(".");
  return { label, passed: targets.filter((t) => t.pass).length, weakest, targets, sums };
});

results.sort((a, b) => b.passed - a.passed || b.weakest - a.weakest);
console.log(`\n${results.length} combinations, seeds 1 to ${runs}. Best first.`);
for (const r of results) {
  const med = r.sums.map((s) => `${s.strategy} ${Math.round(s.median / 1000)}k/${(s.bankrupt_rate * 100).toFixed(0)}%/${(s.strong * 100).toFixed(0)}%`).join("  ");
  console.log(`\n${r.passed}/6 passed  ${r.label}\n  median/bankrupt/strong: ${med}`);
  for (const t of r.targets) if (!t.pass) console.log(`  ${t.pass === null ? "n/a " : "FAIL"} ${t.id}: ${t.detail}`);
}
