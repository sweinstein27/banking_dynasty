// Terminal play mode. Usage: npm run play -- [--seed N] [--turns N]
import { createInterface } from "node:readline";
import { gameData } from "../src/data";
import { newGame } from "../src/sim/init";
import { actionsLeft } from "../src/sim/actions";
import { bondBook, bondValue, quarterlyCoupon } from "../src/sim/bonds";
import { bondOffers, lendOffers, ventureOffers } from "../src/sim/offers";
import { applyDecision } from "../src/sim/decisions";
import { freeCash } from "../src/sim/reserves";
import { createRng } from "../src/sim/rng";
import { endTurn, loanBook, netWorth } from "../src/sim/turn";
import type { Decision, GameState, LedgerEntry } from "../src/sim/types";
import { quartersLeft, ventureBook, venturePayout } from "../src/sim/ventures";

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

function printStatus(s: GameState) {
  const { world, house } = s;
  console.log(`\n=== ${house.name}, ${house.city}. ${world.year} Q${world.quarter} (turn ${world.turn}) ===`);
  console.log(`Cash ${fl(house.cash)}  Loans ${fl(loanBook(s))}  Bonds ${fl(bondBook(s))}  Ventures ${fl(ventureBook(s))}  Deposits ${fl(house.deposits)}  Net worth ${fl(netWorth(s))}`);
  console.log(`Reserve ${fl(house.reserve)}  Free cash ${fl(freeCash(s))}`);
  console.log(`Sentiment ${world.sentiment}  Base rate ${pct(world.base_rate)}  Actions left ${actionsLeft(s, tuning)}`);
  if (s.panic_warning) console.log(`WARNING: panic expected in ${s.panic_warning.turns_left} quarter(s).`);
}

function printHoldings(s: GameState) {
  const active = s.loans.filter((l) => l.status === "active");
  const bonds = s.bonds.filter((b) => b.status === "active");
  const ventures = s.ventures.filter((v) => v.status === "active");
  if (!active.length && !bonds.length && !ventures.length) return console.log("No active loans, bonds or ventures.");
  for (const v of ventures) {
    const name = gameData.ventures.find((t) => t.id === v.type)?.name ?? v.type;
    console.log(`  Venture #${v.id} ${name}: ${fl(v.invested)} locked, pays ${fl(venturePayout(v))} in ${quartersLeft(s, v)} qtr if it succeeds`);
  }
  for (const b of bonds) {
    const name = gameData.states.find((st) => st.id === b.issuer_state)?.name ?? b.issuer_state;
    console.log(`  Bond #${b.id} ${name}: ${fl(b.face_value)} face at ${b.price}, worth ${fl(bondValue(b))}, coupon ${fl(quarterlyCoupon(b))}/qtr`);
  }
  for (const l of active) {
    const left = l.term_quarters - (s.world.turn - l.start_turn);
    console.log(`  #${l.id} ${l.borrower_name}: ${fl(l.principal)} at ${pct(l.rate)}, ${left} qtr left`);
  }
}

function printLedger(entries: LedgerEntry[]) {
  console.log("\n--- Ledger ---");
  if (!entries.length) return console.log("  (no entries)");
  for (const e of entries) {
    const amt = (e.amount >= 0 ? "+" : "") + e.amount.toLocaleString("en-US");
    console.log(`  ${e.account.padEnd(8)} ${e.category.padEnd(15)} ${amt.padStart(10)}  ${e.note}`);
  }
}

function printRequests(preview: GameState): ReturnType<typeof lendOffers> {
  const offers = lendOffers(preview, gameData);
  if (!offers.length) console.log("No one is asking for a loan this quarter.");
  offers.forEach((o, i) => {
    const est = `quality ${o.estimate.low.toFixed(2)} to ${o.estimate.high.toFixed(2)}${o.reported ? " (report)" : ""}`;
    console.log(`  ${i + 1}) ${o.name}, ${o.trade}: wants up to ${fl(o.amount)}, pays up to ${pct(o.max_rate)}, ${est}, repaid ${o.repaid}, defaulted ${o.defaulted}`);
  });
  return offers;
}

async function askLend(preview: GameState): Promise<Decision | null> {
  const offers = printRequests(preview);
  if (!offers.length) return null;
  const o = offers[Number(await ask(`Borrower (1-${offers.length}): `)) - 1];
  if (!o) return console.log("Unknown borrower."), null;
  const amount = Number(await ask(`Amount in gulden (up to ${fl(o.amount)}, free cash ${fl(freeCash(preview))}): `));
  const rate = Number(await ask(`Annual rate in % (up to ${(o.max_rate * 100).toFixed(1)}): `)) / 100;
  return { kind: "lend", borrower: o.borrower_id, amount, rate };
}

async function askReport(preview: GameState): Promise<Decision | null> {
  console.log(`A correspondent's report costs ${fl(tuning.loans.estimate.report_cost)} and narrows the estimate.`);
  const offers = printRequests(preview);
  if (!offers.length) return null;
  const o = offers[Number(await ask(`Borrower (1-${offers.length}): `)) - 1];
  if (!o) return console.log("Unknown borrower."), null;
  return { kind: "report", borrower: o.borrower_id };
}

async function askBond(preview: GameState): Promise<Decision | null> {
  console.log("States:");
  bondOffers(preview, gameData).forEach((o, i) => {
    console.log(`  ${i + 1}) ${o.name}: coupon ${pct(o.coupon)}, risk ${o.risk}, price ${o.price}${o.blocked ? `  [${o.blocked}]` : ""}`);
  });
  const st = gameData.states[Number(await ask(`State (1-${gameData.states.length}): `)) - 1];
  if (!st) return console.log("Unknown state."), null;
  const face_value = Number(await ask(`Face value in gulden (free cash ${fl(freeCash(preview))}): `));
  return { kind: "buy_bond", state: st.id, face_value };
}

async function askVenture(preview: GameState): Promise<Decision | null> {
  console.log("Ventures:");
  ventureOffers(preview, gameData).forEach((o, i) => {
    const locked = o.blocked ? `  [${o.blocked}]` : "";
    console.log(`  ${i + 1}) ${o.name}: ${o.term_quarters} qtr, returns ${pct(o.expected_return)}, fails ${pct(o.failure_chance)} if it ended now${locked}`);
  });
  const v = gameData.ventures[Number(await ask(`Venture (1-${gameData.ventures.length}): `)) - 1];
  if (!v) return console.log("Unknown venture."), null;
  const amount = Number(await ask(`Amount in gulden (free cash ${fl(freeCash(preview))}): `));
  return { kind: "invest_venture", venture: v.id, amount };
}

async function askReserve(preview: GameState): Promise<Decision> {
  console.log(`Current reserve: ${fl(preview.house.reserve)} Lending cannot take cash below it; withdrawals draw on it first.`);
  const amount = Number(await ask("New reserve in gulden: "));
  return { kind: "set_reserve", amount };
}

async function main() {
  console.log(`Banking Dynasty, terminal mode. Seed ${seed}.`);
  let state = newGame(gameData, rng);

  while (state.world.turn <= maxTurns) {
    const queued: Decision[] = [];
    let preview = state;
    let ended = false;

    while (!ended) {
      printStatus(preview);
      const choice = (await ask("[1] Lend  [2] Report  [3] Buy bonds  [4] Back venture  [5] Set reserve  [6] View holdings  [7] End turn  [q] Quit: "))?.trim();
      if (choice === null || choice === undefined || choice === "q") return;
      if (choice === "1" || choice === "2" || choice === "3" || choice === "4" || choice === "5") {
        const askFor = { "1": askLend, "2": askReport, "3": askBond, "4": askVenture, "5": askReserve }[choice];
        const d = await askFor(preview);
        if (!d) continue;
        const r = applyDecision(preview, d, gameData);
        if (!r.ok) console.log(`Refused: ${r.reason}`);
        else {
          queued.push(d);
          preview = r.state;
          if (d.kind === "lend") console.log("Loan agreed.");
          else if (d.kind === "report") console.log("Report received.");
          else if (d.kind === "buy_bond") console.log("Bonds bought.");
          else if (d.kind === "invest_venture") console.log("Venture backed.");
          else console.log(`Reserve set to ${fl(d.amount)}`);
        }
      } else if (choice === "6") printHoldings(preview);
      else if (choice === "7") ended = true;
    }

    const turn = state.world.turn;
    state = endTurn(state, queued, rng, gameData);
    printLedger(state.ledger.filter((e) => e.turn === turn && e.category !== "opening"));
    const news = state.news.filter((n) => n.turn === turn);
    if (news.length) console.log("\n--- News ---\n" + news.map((n) => `  ${n.title ? `${n.title.toUpperCase()}. ` : ""}${n.text}`).join("\n"));
    if (state.house.status === "bankrupt") {
      console.log("\n*** HOUSE BANKRUPT ***");
      console.log(`${state.house.name} could not pay its depositors, even after selling its assets. The run is over.`);
      printStatus(state);
      return;
    }
  }

  printStatus(state);
  console.log(`\nFinished ${maxTurns} turns. Final net worth ${fl(netWorth(state))}`);
}

main().finally(() => rl.close());
