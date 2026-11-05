// Searches seeds for the panic golden run. Usage: npm run find-panic-seed -- [--max N] [--turns N]
// Prints how many seeds qualify and the five richest; pick one and set PANIC_SEED in tests/strategies.ts.
import { aggressiveDecisions, panicCoverage, play } from "../tests/strategies";

function argValue(name: string): number | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : undefined;
}

const max = argValue("max") ?? 3000;
const turns = argValue("turns") ?? 20;
const hits: { seed: number; score: number }[] = [];
let panics = 0;
let bankrupt = 0;
for (let seed = 1; seed <= max; seed++) {
  const result = play(aggressiveDecisions, seed, turns);
  const { ok, checks, score } = panicCoverage(result, turns);
  if (checks.panic) panics++;
  if (checks.panic && result.state.house.status === "bankrupt") bankrupt++;
  if (ok) hits.push({ seed, score });
}
hits.sort((a, b) => b.score - a.score || a.seed - b.seed);
console.log(`Seeds 1 to ${max}, ${turns} turns: ${panics} reach a panic, ${bankrupt} of those go bankrupt, ${hits.length} qualify.`);
for (const h of hits.slice(0, 5)) console.log(`  seed ${h.seed}: score ${h.score}`);
