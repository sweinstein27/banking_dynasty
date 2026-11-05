// Terminal play mode. Usage: npm run play -- [--seed N] [--turns N]
import { createInterface } from "node:readline";
import { gameData } from "../src/data";
import { newGame } from "../src/sim/init";
import { lend } from "../src/sim/loans";
import { createRng } from "../src/sim/rng";
import { endTurn, loanBook, netWorth } from "../src/sim/turn";
import type { Decision, GameState, LedgerEntry, TierName } from "../src/sim/types";

function argValue(name: string): number | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : undefined;
}

const seed = argValue("seed") ?? Date.now() % 1_000_000;
const maxTurns = argValue("turns") ?? 8;
const tuning = gameData.tuning;
const rng = createRng(seed);

// Line reader that also works with piped input.
const rl = createInterface({ input: process.stdin });
const lines: string[] = [];
const waiters: ((line: string | null) => void)[] = [];
let closed = false;
rl.on("line", (line) => {
  if (!waiters.length) return void lines.push(line);
  if (!process.stdin.isTTY) process.stdout.write(line + "\n");
  waiters.shift()!(line);
});
rl.on("close", () => {
  closed = true;
  while (waiters.length) waiters.shift()!(null);
});

function ask(prompt: string): Promise<string | null> {
  process.stdout.write(prompt);
  if (lines.length) {
    const line = lines.shift()!;
    if (!process.stdin.isTTY) process.stdout.write(line + "\n");
    return Promise.resolve(line);
  }
  if (closed) return Promise.resolve(null);
  return new Promise((resolve) => waiters.push(resolve));
}

const fl = (n: number) => `${n.toLocaleString("en-US")} fl.`;
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

function printStatus(s: GameState, queued: Decision[]) {
  const { world, house } = s;
  console.log(`\n=== ${house.name}, ${house.city}. ${world.year} Q${world.quarter} (turn ${world.turn}) ===`);
  console.log(`Cash ${fl(house.cash)}  Loans ${fl(loanBook(s))}  Deposits ${fl(house.deposits)}  Net worth ${fl(netWorth(s))}`);
  console.log(`Sentiment ${world.sentiment}  Base rate ${pct(world.base_rate)}  Actions left ${tuning.loans.actions_per_turn - queued.length}`);
}

function printLoans(s: GameState) {
  const active = s.loans.filter((l) => l.status === "active");
  if (!active.length) return console.log("No active loans.");
  for (const l of active) {
    const left = l.term_quarters - (s.world.turn - l.start_turn);
    console.log(`  #${l.id} ${l.borrower_name}: ${fl(l.principal)} at ${pct(l.rate)}, q=${l.quality}, ${left} qtr left`);
  }
}

function printLedger(entries: LedgerEntry[]) {
  console.log("\n--- Ledger ---");
  if (!entries.length) return console.log("  (no entries)");
  for (const e of entries) {
    const amt = (e.amount >= 0 ? "+" : "") + e.amount.toLocaleString("en-US");
    console.log(`  ${e.account.padEnd(8)} ${e.category.padEnd(9)} ${amt.padStart(10)}  ${e.note}`);
  }
}

async function askLend(preview: GameState): Promise<Decision | null> {
  const tierNames = Object.keys(tuning.loans.tiers) as TierName[];
  console.log("Borrower tiers:");
  tierNames.forEach((t, i) => {
    const tier = tuning.loans.tiers[t];
    console.log(`  ${i + 1}) ${t}: quality ${tier.quality}, pays up to ${pct(tier.max_rate)}`);
  });
  const tierIn = await ask("Tier (1-3): ");
  const tier = tierNames[Number(tierIn) - 1] ?? (tierNames.find((t) => t === tierIn?.trim()) as TierName | undefined);
  if (!tier) return console.log("Unknown tier."), null;
  const amount = Number(await ask(`Amount in gulden (cash ${fl(preview.house.cash)}): `));
  const rate = Number(await ask("Annual rate in % (e.g. 8): ")) / 100;
  return { kind: "lend", amount, rate, tier };
}

async function main() {
  console.log(`Banking Dynasty, terminal mode. Seed ${seed}.`);
  let state = newGame(gameData);

  while (state.world.turn <= maxTurns) {
    const queued: Decision[] = [];
    let preview = state;
    let ended = false;

    while (!ended) {
      printStatus(preview, queued);
      const choice = (await ask("[1] Lend  [2] View loans  [3] End turn  [q] Quit: "))?.trim();
      if (choice === null || choice === undefined || choice === "q") return;
      if (choice === "1") {
        const d = await askLend(preview);
        if (!d) continue;
        const r = lend(preview, d, gameData);
        if (!r.ok) console.log(`Refused: ${r.reason}`);
        else {
          queued.push(d);
          preview = r.state;
          console.log("Loan agreed.");
        }
      } else if (choice === "2") printLoans(preview);
      else if (choice === "3") ended = true;
    }

    const turn = state.world.turn;
    state = endTurn(state, queued, rng, gameData);
    printLedger(state.ledger.filter((e) => e.turn === turn && e.category !== "opening"));
  }

  printStatus(state, []);
  console.log(`\nFinished ${maxTurns} turns. Final net worth ${fl(netWorth(state))}`);
}

main().finally(() => rl.close());
