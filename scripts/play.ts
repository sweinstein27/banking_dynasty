// Terminal play mode. Usage: npm run play -- [--seed N] [--turns N]
import { createInterface } from "node:readline";
import { gameData } from "../src/data";
import { newGame } from "../src/sim/init";
import { actionsLeft, runOver } from "../src/sim/actions";
import { bondBook, bondValue, quarterlyCoupon } from "../src/sim/bonds";
import { bondOffers, lendOffers, ventureOffers } from "../src/sim/offers";
import { chronicle } from "../src/sim/chronicle";
import { borrowingRoom, debtBook, inCrisis, lenders, lendingTerms } from "../src/sim/crisis";
import { houseRanking, opinionWord } from "../src/sim/houses";
import { ageIn, effectiveStat, headOf, heirsOf, investCost, reputationGain, STATS } from "../src/sim/family";
import { traitWords } from "../src/sim/traits";
import { applyDecision } from "../src/sim/decisions";
import { depositLevel } from "../src/sim/deposits";
import { checkAnswerLetter, describeOption, unansweredLetters } from "../src/sim/letters";
import { freeCash } from "../src/sim/reserves";
import { createRng } from "../src/sim/rng";
import { endTurn, loanBook, netWorth } from "../src/sim/turn";
import type { Decision, GameState, LedgerEntry, Person } from "../src/sim/types";
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
  console.log(`Cash ${fl(house.cash)}  Loans ${fl(loanBook(s))}  Bonds ${fl(bondBook(s))}  Ventures ${fl(ventureBook(s))}  Deposits ${fl(house.deposits)}  Borrowings ${fl(debtBook(s))}  Net worth ${fl(netWorth(s))}`);
  console.log(`Reserve ${fl(house.reserve)}  Free cash ${fl(freeCash(s))}  Reputation ${house.reputation}, drawing deposits of ${fl(depositLevel(house.reputation, tuning))}`);
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

async function askCrisis(preview: GameState): Promise<Decision | null> {
  if (!inCrisis(preview)) return console.log("Crisis measures are only open while the market is uneasy, panicking, or under a panic warning."), null;
  const c = tuning.crisis;
  console.log(`  b) Borrow from another house, due in ${c.lending.term_quarters} qtr (room ${fl(borrowingRoom(preview, tuning))} in all, reputation -${c.lending.reputation_cost})`);
  console.log(`  s) Pay depositors slowly this quarter (${pct(c.pay_slowly.share)} of what they ask, reputation -${c.pay_slowly.reputation_cost})`);
  console.log(`  x) Suspend withdrawals this quarter (reputation -${c.suspend.reputation_cost}, every house's opinion -${c.suspend.opinion_cost})`);
  console.log(`  c) Call a loan in (recover ${pct(c.call_loan.recovery)} now, the borrower stays away ${c.call_loan.absence_quarters} qtr)`);
  const pick = (await ask("Measure (b/s/x/c): "))?.trim();
  if (pick === "b") {
    const terms = lenders(preview, tuning);
    terms.forEach((t, i) => console.log(`    ${i + 1}) ${t.house.name}: ${t.refused ?? `${pct(t.rate)}, up to ${fl(t.room)}`}`));
    const t = terms[Number(await ask(`House (1-${terms.length}): `)) - 1];
    if (!t) return console.log("Unknown house."), null;
    return { kind: "borrow", house: t.house.id, amount: Number(await ask("Amount in gulden: ")) };
  }
  if (pick === "s") return { kind: "pay_slowly" };
  if (pick === "x") return { kind: "suspend" };
  if (pick === "c") {
    printHoldings(preview);
    return { kind: "call_loan", loan: Number(await ask("Loan number: ")) };
  }
  return console.log("Unknown measure."), null;
}

async function askFamily(preview: GameState): Promise<Decision | null> {
  const inv = tuning.family.invest;
  printFamily(preview);
  console.log(`  e) Educate an heir (${fl(investCost("educate", preview, gameData))}, one stat +${inv.educate.gain})`);
  console.log(`  c) Charity (${fl(investCost("charity", preview, gameData))}, reputation +${reputationGain(inv.charity.reputation, preview, gameData)})`);
  console.log(`  p) Patronage (${fl(investCost("patronage", preview, gameData))}, head's connections +${inv.patronage.connections}, reputation +${reputationGain(inv.patronage.reputation, preview, gameData)})`);
  console.log(`  n) Name an heir to take over (passing over the eldest costs ${tuning.family.succession.passed_over_reputation} reputation)`);
  const pick = (await ask("Choice (e/c/p/n): "))?.trim();
  if (pick === "n") {
    const heirs = heirsOf(preview);
    const heir = heirs[Number(await ask(`Heir (1-${heirs.length}): `)) - 1];
    return heir ? { kind: "designate_heir", heir: heir.id } : (console.log("Unknown heir."), null);
  }
  if (pick === "c") return { kind: "invest_family", form: "charity" };
  if (pick === "p") return { kind: "invest_family", form: "patronage" };
  if (pick !== "e") return console.log("Unknown form."), null;
  const heirs = heirsOf(preview);
  const heir = heirs[Number(await ask(`Heir (1-${heirs.length}): `)) - 1];
  if (!heir) return console.log("Unknown heir."), null;
  const stat = STATS[Number(await ask("Stat: 1) acumen 2) prudence 3) connections: ")) - 1];
  if (!stat) return console.log("Unknown stat."), null;
  return { kind: "invest_family", form: "educate", heir: heir.id, stat };
}

function printFamily(s: GameState) {
  const year = s.world.year;
  const head = headOf(s);
  const stats = (p: Person) => STATS.map((k) => `${k} ${effectiveStat(p, k, gameData)}`).join(", ");
  const traits = (p: Person) => (p.traits.length ? `, ${traitWords(p, gameData)}` : "");
  if (head) console.log(`Head: ${head.name}${traits(head)}, aged ${ageIn(head, year)}, ${stats(head)}`);
  heirsOf(s).forEach((p, i) => console.log(`  Heir ${i + 1}) ${p.name}${traits(p)}, aged ${ageIn(p, year)}, ${stats(p)}${s.house.designated_heir === p.id ? "  [named heir]" : ""}`));
}

async function askReserve(preview: GameState): Promise<Decision> {
  console.log(`Current reserve: ${fl(preview.house.reserve)} Lending cannot take cash below it; withdrawals draw on it first.`);
  const amount = Number(await ask("New reserve in gulden: "));
  return { kind: "set_reserve", amount };
}

/** Each unanswered letter in turn: shows the responses with cost and odds, and takes one. Null means quit. */
async function askLetters(preview: GameState): Promise<{ decisions: Decision[]; preview: GameState } | null> {
  const decisions: Decision[] = [];
  for (const letter of unansweredLetters(preview)) {
    const ev = gameData.events.find((e) => e.id === letter.event)!;
    console.log(`\n--- A letter: ${ev.title} ---\n  ${ev.text}\n  (Answering uses no action.)`);
    ev.options!.forEach((o, i) => {
      const d = describeOption(o, gameData);
      const refused = checkAnswerLetter(preview, { kind: "answer_letter", event: ev.id, option: o.id }, gameData);
      const parts = [d.cost > 0 ? `costs ${fl(d.cost)}` : "no cost", ...d.effects, ...(d.odds ? [d.odds] : [])];
      console.log(`  [${i + 1}] ${o.label}: ${parts.join("; ")}${refused ? ` (not open: ${refused})` : ""}`);
    });
    for (;;) {
      const pick = await ask(`Response (1-${ev.options!.length}): `);
      if (pick === null) return null;
      const o = ev.options![Number(pick) - 1];
      if (!o) continue;
      const d: Decision = { kind: "answer_letter", event: ev.id, option: o.id };
      const r = applyDecision(preview, d, gameData);
      if (!r.ok) {
        console.log(`Refused: ${r.reason}`);
        continue;
      }
      decisions.push(d);
      preview = r.state;
      break;
    }
  }
  return { decisions, preview };
}

/** The houses of Frankfurt: the standing, each house's opinion and terms, and the choice to court one. */
async function askHouses(preview: GameState): Promise<Decision | null> {
  console.log("\n--- The Bourse ---");
  houseRanking(preview, netWorth(preview)).forEach((r, i) => console.log(`  ${i + 1}. ${r.name}${r.player ? " (yours)" : ""}: ${fl(Math.round(r.worth / 1000) * 1000)}`));
  const trading = preview.houses.filter((h) => h.failed_turn === null);
  trading.forEach((h, i) => {
    const t = lendingTerms(preview, h, tuning);
    console.log(`  [${i + 1}] ${h.name} (${h.temperament}), ${h.head.name} ${ageIn(h.head, preview.world.year)}, reputation ${h.reputation}, opinion ${opinionWord(h.opinion)} (${h.opinion}); ${t.refused ? `would not lend: ${t.refused}` : `would lend at ${pct(t.rate)}, up to ${fl(t.room)}`}`);
  });
  for (const h of preview.houses.filter((x) => x.failed_turn !== null)) console.log(`  ${h.name}: failed`);
  const pick = (await ask(`Court a house for ${fl(tuning.houses.court.cost)} and one action (1-${trading.length}), or Enter to go back: `))?.trim();
  const h = trading[Number(pick) - 1];
  return h ? { kind: "court_house", house: h.id } : null;
}

async function main() {
  console.log(`Banking Dynasty, terminal mode. Seed ${seed}.`);
  let state = newGame(gameData, rng);

  while (state.world.turn <= maxTurns && !runOver(state, tuning)) {
    const queued: Decision[] = [];
    let preview = state;
    let ended = false;

    const answered = await askLetters(preview);
    if (!answered) return;
    queued.push(...answered.decisions);
    preview = answered.preview;

    while (!ended) {
      printStatus(preview);
      const choice = (await ask("[1] Lend  [2] Report  [3] Buy bonds  [4] Back venture  [5] Set reserve  [6] View holdings  [7] End turn  [8] Crisis measures  [9] Invest in family  [h] Houses  [q] Quit: "))?.trim();
      if (choice === null || choice === undefined || choice === "q") return;
      if (choice === "1" || choice === "2" || choice === "3" || choice === "4" || choice === "5" || choice === "8" || choice === "9") {
        const askFor = { "1": askLend, "2": askReport, "3": askBond, "4": askVenture, "5": askReserve, "8": askCrisis, "9": askFamily }[choice];
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
          else if (d.kind === "set_reserve") console.log(`Reserve set to ${fl(d.amount)}`);
          else if (d.kind === "invest_family") console.log("Money spent on the family.");
          else if (d.kind === "designate_heir") console.log("Heir named.");
          else console.log("Crisis measure taken.");
        }
      } else if (choice === "h") {
        const d = await askHouses(preview);
        if (!d) continue;
        const r = applyDecision(preview, d, gameData);
        if (!r.ok) console.log(`Refused: ${r.reason}`);
        else {
          queued.push(d);
          preview = r.state;
          console.log("The house is courted.");
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
      console.log(`${state.house.name} could not meet its obligations, even after selling its assets. The run is over.`);
      printStatus(state);
      printChronicle(state);
      return;
    }
  }

  printStatus(state);
  console.log(`\nFinished ${state.world.turn - 1} turns. Final net worth ${fl(netWorth(state))}`);
  printChronicle(state);
}

function printChronicle(s: GameState) {
  console.log("\n--- The chronicle of the house ---\n");
  console.log(chronicle(s, gameData).join("\n\n"));
}

main().finally(() => rl.close());
