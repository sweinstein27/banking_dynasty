// Terminal play mode. Usage: npm run play -- [--seed N] [--turns N]
import { createInterface } from "node:readline";
import { gameData } from "../src/data";
import { newGame } from "../src/sim/init";
import { runOver } from "../src/sim/actions";
import { POOL_NAMES, POOLS, poolLeft, poolSize } from "../src/sim/capacity";
import { bondBook, bondValue, quarterlyCoupon } from "../src/sim/bonds";
import { bondOffers, lendOffers, loanSaleOffers, ventureOffers } from "../src/sim/offers";
import { fileLines, KIND_WORDS, type BookFile } from "../src/sim/systems/credit";
import { chronicle, dateOfTurn } from "../src/sim/chronicle";
import { borrowingRoom, debtBook, inCrisis, lenders, lendingTerms } from "../src/sim/crisis";
import { courtCost, houseRanking, opinionWord } from "../src/sim/houses";
import {
  advisors,
  ADVISOR_TITLES,
  buildCost,
  checkBuild,
  desksTaken,
  FACILITY_IDS,
  hasFacility,
  nextRoom,
  roomData,
  skillOf,
  STAFF_ROLES,
  traitOf,
  upkeepBill,
  wageBill,
  warningKnown,
  type BuildDecision,
} from "../src/sim/systems/counting";
import { ageIn, effectiveStat, headOf, heirsOf, investCost, livingSpouse, reputationGain, STATS } from "../src/sim/family";
import { checkMarriage, marriageable, matchMoney } from "../src/sim/marriages";
import { traitById, traitWords } from "../src/sim/traits";
import { applyDecision } from "../src/sim/decisions";
import { depositLevel } from "../src/sim/deposits";
import { checkAnswerLetter, describeOption, unansweredLetters } from "../src/sim/letters";
import { checkAnswerFamilyLetter, familyOptions, letterWords, loyaltyOf, loyaltyWord, studyData, studyOf } from "../src/sim/systems/people";
import { freeCash } from "../src/sim/reserves";
import { createRng } from "../src/sim/rng";
import { endTurn, loanBook, netWorth } from "../src/sim/turn";
import type { ArrangeMarriageDecision, Decision, GameState, LedgerEntry, Person } from "../src/sim/types";
import { quartersLeft, ventureBook, venturePayout } from "../src/sim/ventures";
import { describeSystemDecision } from "../src/sim/decisions";
import { askMarkets, askVentureCommit, marketsLine, printMarketHoldings } from "./markets-menu";

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
  console.log(`Cash ${fl(house.cash)}  Loans ${fl(loanBook(s))}  Bonds ${fl(bondBook(s))}  Ventures ${fl(ventureBook(s))}  ${marketsLine(s)}  Deposits ${fl(house.deposits)}  Borrowings ${fl(debtBook(s))}  Net worth ${fl(netWorth(s))}`);
  console.log(`Reserve ${fl(house.reserve)}  Free cash ${fl(freeCash(s))}  Reputation ${house.reputation}, drawing deposits of ${fl(depositLevel(house.reputation, tuning))}`);
  console.log(`Sentiment ${world.sentiment}  Base rate ${pct(world.base_rate)}  Wages and upkeep ${fl(wageBill(s, gameData) + upkeepBill(s, gameData))} a quarter`);
  console.log(`Left this quarter: ${POOLS.map((p) => `${POOL_NAMES[p]} ${poolLeft(s, p, tuning)}/${poolSize(s, p, tuning)}`).join(", ")}`);
  if (s.panic_warning && warningKnown(s, gameData)) console.log(`WARNING: panic expected in ${s.panic_warning.turns_left} quarter(s).`);
}

function printHoldings(s: GameState) {
  const active = s.loans.filter((l) => l.status === "active");
  const bonds = s.bonds.filter((b) => b.status === "active");
  const markets = Object.keys(s.markets.shares).length + Object.keys(s.markets.goods).length + s.ventures.filter((v) => v.status === "active" || v.status === "listed").length;
  if (!active.length && !bonds.length && !markets) return console.log("No active loans, bonds, ventures, shares or goods.");
  printMarketHoldings(s);
  for (const b of bonds) {
    const name = gameData.states.find((st) => st.id === b.issuer_state)?.name ?? b.issuer_state;
    console.log(`  Bond #${b.id} ${name}: ${fl(b.face_value)} face at ${b.price}, worth ${fl(bondValue(b))}, coupon ${fl(quarterlyCoupon(b))}/qtr`);
  }
  for (const l of active) {
    const left = l.term_quarters - (s.world.turn - l.start_turn);
    console.log(`  #${l.id} ${l.borrower_name}, ${KIND_WORDS[l.kind]}: ${fl(l.principal)} at ${pct(l.rate)}, ${left} qtr left`);
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

const fileText = (f: BookFile | null, turn: number) => fileLines(f, turn, gameData).map((l) => `      ${l}`);

function printRequests(preview: GameState): ReturnType<typeof lendOffers> {
  const offers = lendOffers(preview, gameData);
  if (!offers.length) console.log("No one is asking for a loan this quarter.");
  offers.forEach((o, i) => {
    const op = preview.counting.opinions.find((x) => x.borrower === o.borrower_id);
    console.log(`  ${i + 1}) ${o.name}, ${o.trade}, ${o.years_in_trade} years in trade: ${KIND_WORDS[o.kind]} for ${o.term_quarters} qtr, up to ${fl(o.amount)} at up to ${pct(o.max_rate)}; repaid ${o.repaid}, defaulted ${o.defaulted} with us`);
    console.log(`      ${o.talk_text}`);
    for (const line of fileText(o.file, preview.world.turn)) console.log(line);
    if (op) console.log(`      Analyst's opinion: ${op.verdict}`);
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
  const info = gameData.credit.info;
  console.log(`A correspondent's report (${fl(info.report_cost)}) shows turnover, profit, debts and payment record.`);
  console.log(`A full inquiry (${fl(info.inquiry_cost)}) adds collateral, the true profit and a partner's private remarks.`);
  const asking = printRequests(preview).map((o) => ({ id: o.borrower_id, name: o.name }));
  const owing = loanSaleOffers(preview, gameData)
    .filter((l) => !asking.some((a) => a.id === l.borrower_id))
    .map((l) => ({ id: l.borrower_id, name: l.name }))
    .filter((x, i, all) => all.findIndex((y) => y.id === x.id) === i);
  owing.forEach((x, i) => {
    console.log(`  ${asking.length + i + 1}) ${x.name} (owes the house)`);
    for (const line of fileText(preview.borrowers.find((b) => b.id === x.id)!.file, preview.world.turn)) console.log(line);
  });
  const all = [...asking, ...owing];
  if (!all.length) return null;
  const who = all[Number(await ask(`Borrower (1-${all.length}): `)) - 1];
  if (!who) return console.log("Unknown borrower."), null;
  const tier = (await ask("[r] Report  [i] Full inquiry: "))?.trim();
  if (tier === "r") return { kind: "report", borrower: who.id };
  if (tier === "i") return { kind: "inquire", borrower: who.id };
  return null;
}

async function askSellLoan(preview: GameState): Promise<Decision | null> {
  const offers = loanSaleOffers(preview, gameData);
  if (!offers.length) return console.log("No active loans to sell."), null;
  console.log("Another house would buy:");
  offers.forEach((o, i) => {
    console.log(`  ${i + 1}) #${o.loan_id} ${o.name}, ${KIND_WORDS[o.kind]}: ${fl(o.principal)} at ${pct(o.rate)}, ${o.quarters_left} qtr left; they pay ${fl(o.price)}`);
  });
  const o = offers[Number(await ask(`Loan (1-${offers.length}): `)) - 1];
  if (!o) return console.log("Unknown loan."), null;
  return { kind: "sell_loan", loan: o.loan_id };
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
  return askVentureCommit(preview, ask);
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
  console.log("  m) Arrange a marriage (children need a married couple)");
  console.log("  s) Send an heir to study (university, London, the army or the counting house)");
  const pick = (await ask("Choice (e/c/p/n/m/s): "))?.trim();
  if (pick === "m") return askMarriage(preview);
  if (pick === "s") return askStudy(preview);
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

async function askStudy(preview: GameState): Promise<Decision | null> {
  const heirs = heirsOf(preview);
  if (!heirs.length) return console.log("There is no heir to send."), null;
  heirs.forEach((p, i) => console.log(`  ${i + 1}) ${p.name}, aged ${ageIn(p, preview.world.year)}${studyOf(preview, p.id) ? " (away studying)" : ""}`));
  const heir = heirs[Number(await ask(`Heir (1-${heirs.length}): `)) - 1];
  if (!heir) return console.log("Unknown heir."), null;
  const paths = gameData.people.studies;
  paths.forEach((t, i) => {
    const gains = Object.entries(t.gains).map(([k, v]) => `${k} +${v}`).join(", ");
    const extra = [t.trait ? `perhaps ${(traitById(t.trait, gameData)?.name ?? t.trait).toLowerCase()}` : "", t.contact_opinion ? "a friend in a Frankfurt house" : "", `loyalty +${t.loyalty}`].filter(Boolean).join(", ");
    console.log(`  ${i + 1}) ${t.name}: ages ${t.min_age} to ${t.max_age}, ${t.quarters} quarters, ${t.cost ? fl(t.cost) : "no cost"}; ${gains}; ${extra}`);
  });
  const path = paths[Number(await ask(`Path (1-${paths.length}): `)) - 1];
  return path ? { kind: "send_to_study", heir: heir.id, path: path.id } : (console.log("Unknown path."), null);
}

async function askMarriage(preview: GameState): Promise<Decision | null> {
  const free = marriageable(preview, gameData);
  if (!free.length) return console.log("No one of the line is of age and unmarried."), null;
  free.forEach((p, i) => console.log(`  ${i + 1}) ${p.name}, aged ${ageIn(p, preview.world.year)}`));
  const member = free[Number(await ask(`Who (1-${free.length}): `)) - 1];
  if (!member) return console.log("Unknown person."), null;
  const options: ArrangeMarriageDecision[] = [
    ...preview.houses.filter((h) => h.failed_turn === null).flatMap((h) => [
      { kind: "arrange_marriage", member: member.id, with: h.id, form: "in" } as const,
      ...(member.is_head ? [] : [{ kind: "arrange_marriage", member: member.id, with: h.id, form: "out" } as const]),
    ]),
    { kind: "arrange_marriage", member: member.id, with: "merchant", form: "in" },
  ];
  options.forEach((d, i) => {
    const h = preview.houses.find((x) => x.id === d.with);
    const what = d.with === "merchant" ? "a merchant family" : d.form === "in" ? `a son or daughter of ${h!.name} joins` : `marry into ${h!.name}`;
    const n = matchMoney(preview, d, gameData);
    const refused = checkMarriage(preview, d, gameData);
    console.log(`  ${i + 1}) ${what}: ${n > 0 ? `dowry +${fl(n)}` : `costs ${fl(-n)}`}${refused ? ` (refused: ${refused})` : ""}`);
  });
  return options[Number(await ask(`Match (1-${options.length}): `)) - 1] ?? (console.log("Unknown match."), null);
}

function printFamily(s: GameState) {
  const year = s.world.year;
  const head = headOf(s);
  const stats = (p: Person) => STATS.map((k) => `${k} ${effectiveStat(p, k, gameData)}`).join(", ");
  const traits = (p: Person) => (p.traits.length ? `, ${traitWords(p, gameData)}` : "");
  if (head) console.log(`Head: ${head.name}${traits(head)}, aged ${ageIn(head, year)}, ${stats(head)}`);
  const married = (p: Person) => {
    const sp = livingSpouse(s, p);
    return sp ? `, married to ${sp.name}` : "";
  };
  if (head && married(head)) console.log(`  ${married(head).slice(2)}`);
  const loyal = (p: Person) => `, ${loyaltyWord(s, p, gameData)} (${loyaltyOf(s, p, gameData)})`;
  const away = (p: Person) => {
    const st = studyOf(s, p.id);
    return st ? `, away: ${studyData(st.path, gameData)?.name.toLowerCase()} until ${(({ year, quarter }) => `${year} Q${quarter}`)(dateOfTurn(st.until - 1, tuning))}` : "";
  };
  const wife = head && livingSpouse(s, head);
  if (wife) console.log(`  ${wife.name}${loyal(wife)}`);
  for (const f of s.agendas.feuds) console.log(`  Feud: ${s.people.find((p) => p.id === f.person)?.name} against ${s.people.find((p) => p.id === f.head)?.name}`);
  heirsOf(s).forEach((p, i) => console.log(`  Heir ${i + 1}) ${p.name}${traits(p)}, aged ${ageIn(p, year)}, ${stats(p)}${married(p)}${loyal(p)}${away(p)}${s.house.designated_heir === p.id ? "  [named heir]" : ""}`));
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
  // Family letters (B2): they name the person writing.
  for (const letter of preview.agendas.letters.filter((l) => l.answer === null)) {
    const w = letterWords(preview, letter, gameData);
    console.log(`\n--- A family letter: ${w.title} ---\n  ${w.text}\n  (Answering uses no action. Left unanswered: ${letter.kind === "leaving" ? "forbid it" : "refuse"}.)`);
    const options = familyOptions(letter, gameData);
    options.forEach((o, i) => {
      const refused = checkAnswerFamilyLetter(preview, { kind: "answer_family_letter", letter: letter.id, option: o.id }, gameData);
      console.log(`  [${i + 1}] ${o.label}${o.cost > 0 ? `: costs ${fl(o.cost)}` : ""}${refused ? ` (not open: ${refused})` : ""}`);
    });
    for (;;) {
      const pick = await ask(`Response (1-${options.length}): `);
      if (pick === null) return null;
      const o = options[Number(pick) - 1];
      if (!o) continue;
      const d: Decision = { kind: "answer_family_letter", letter: letter.id, option: o.id };
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
  const pick = (await ask(`Court a house for ${fl(courtCost(preview, gameData))} and the head's time (1-${trading.length}), or Enter to go back: `))?.trim();
  const h = trading[Number(pick) - 1];
  return h ? { kind: "court_house", house: h.id } : null;
}

/** The counting house: staff, rooms and facilities, the council, and the choice to hire, dismiss, build or ask an analyst. */
function printHouse(s: GameState) {
  const c = s.counting;
  const turn = s.world.turn;
  const room = roomData(c.room, gameData);
  const building = c.room_building ? `, ${roomData(c.room_building.size, gameData).name.toLowerCase()} being built` : "";
  console.log(`\n--- The counting house ---\n${room.name}: ${desksTaken(s, gameData)} of ${room.desks} desks taken next quarter${building}.`);
  for (const m of c.staff) {
    const role = gameData.counting.roles[m.role];
    const when = m.start_turn > turn ? ", starts next quarter" : m.leaving ? ", leaving at the end of the quarter" : "";
    console.log(`  #${m.id} ${m.name}, ${role.name.toLowerCase()}, skill ${skillOf(m, turn, gameData)}, ${traitOf(m.trait, gameData)?.name.toLowerCase() ?? m.trait}, ${fl(role.wage)}/qtr${when}`);
  }
  if (!c.staff.length) console.log("  No staff.");
  const facilities = FACILITY_IDS.filter((id) => c.facilities.some((f) => f.id === id)).map((id) => `${gameData.counting.facilities[id].name}${hasFacility(s, id) ? "" : " (being built)"}`);
  console.log(`Facilities: ${facilities.length ? facilities.join(", ") : "none"}.`);
  console.log(`Wages ${fl(wageBill(s, gameData))} and upkeep ${fl(upkeepBill(s, gameData))} a quarter.`);
  const council = advisors(s, gameData);
  const seats = (Object.keys(ADVISOR_TITLES) as (keyof typeof ADVISOR_TITLES)[]).map((r) => `${ADVISOR_TITLES[r]}: ${council[r]?.name ?? "none"}`);
  console.log(`The council: ${seats.join("; ")}.`);
}

async function askHouse(preview: GameState): Promise<Decision | null> {
  printHouse(preview);
  const pick = (await ask("[h] Hire  [d] Dismiss  [b] Build  [a] Ask an analyst about a borrower, or Enter to go back: "))?.trim();
  if (pick === "h") {
    STAFF_ROLES.forEach((r, i) => {
      const role = gameData.counting.roles[r];
      console.log(`  ${i + 1}) ${role.name}, ${fl(role.wage)}/qtr: ${role.description}`);
    });
    const role = STAFF_ROLES[Number(await ask(`Post (1-${STAFF_ROLES.length}): `)) - 1];
    if (!role) return console.log("Unknown post."), null;
    const list = preview.counting.candidates[role];
    if (!list.length) return console.log("No one is looking for that post this quarter."), null;
    list.forEach((c, i) => {
      const t = traitOf(c.trait, gameData);
      console.log(`  ${i + 1}) ${c.name}, skill ${c.skill}, ${t ? `${t.name.toLowerCase()}: ${t.description}` : c.trait}`);
    });
    const i = Number(await ask(`Candidate (1-${list.length}): `)) - 1;
    return list[i] ? { kind: "hire", role, candidate: i } : (console.log("Unknown candidate."), null);
  }
  if (pick === "d") {
    const id = Number(await ask("Staff number to dismiss: "));
    return { kind: "dismiss", staff: id };
  }
  if (pick === "b") {
    const choices: BuildDecision["facility"][] = ["counting_room", ...FACILITY_IDS];
    choices.forEach((f, i) => {
      const cost = buildCost(preview, f, gameData);
      const name = f === "counting_room" ? (nextRoom(preview.counting.room, gameData)?.name ?? "A larger counting room") : gameData.counting.facilities[f].name;
      const upkeep = f === "counting_room" ? nextRoom(preview.counting.room, gameData)?.upkeep : gameData.counting.facilities[f].upkeep;
      const what = f === "counting_room" ? `${nextRoom(preview.counting.room, gameData)?.desks ?? "no more"} desks` : gameData.counting.facilities[f].description;
      const refused = checkBuild(preview, { kind: "build", facility: f }, gameData);
      console.log(`  ${i + 1}) ${name}: ${cost === null ? "" : `${fl(cost)}, upkeep ${fl(upkeep ?? 0)}/qtr. `}${what}${refused ? `  [${refused}]` : ""}`);
    });
    const f = choices[Number(await ask(`Build (1-${choices.length}): `)) - 1];
    return f ? { kind: "build", facility: f } : (console.log("Unknown facility."), null);
  }
  if (pick === "a") {
    const offers = printRequests(preview);
    if (!offers.length) return null;
    const o = offers[Number(await ask(`Borrower (1-${offers.length}): `)) - 1];
    return o ? { kind: "consult_analyst", borrower: o.borrower_id } : (console.log("Unknown borrower."), null);
  }
  return null;
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
      const choice = (await ask("[1] Lend  [2] Report or inquiry  [s] Sell a loan  [3] Buy bonds  [4] Back venture  [5] Set reserve  [6] View holdings  [7] End turn  [8] Crisis measures  [9] Invest in family  [h] Houses  [c] Counting house  [m] Markets  [q] Quit: "))?.trim();
      if (choice === null || choice === undefined || choice === "q") return;
      if (choice === "1" || choice === "2" || choice === "s" || choice === "3" || choice === "4" || choice === "5" || choice === "8" || choice === "9") {
        const askFor = { "1": askLend, "2": askReport, s: askSellLoan, "3": askBond, "4": askVenture, "5": askReserve, "8": askCrisis, "9": askFamily }[choice];
        const d = await askFor(preview);
        if (!d) continue;
        const r = applyDecision(preview, d, gameData);
        if (!r.ok) console.log(`Refused: ${r.reason}`);
        else {
          queued.push(d);
          preview = r.state;
          if (d.kind === "lend") console.log("Loan agreed.");
          else if (d.kind === "report" || d.kind === "inquire") {
            console.log(d.kind === "report" ? "Report received." : "Inquiry made.");
            for (const line of fileText(preview.borrowers.find((b) => b.id === d.borrower)!.file, preview.world.turn)) console.log(line);
          }
          else if (d.kind === "sell_loan") console.log("Loan sold.");
          else if (d.kind === "buy_bond") console.log("Bonds bought.");
          else if (d.kind === "invest_venture") console.log("Venture backed; its first call is paid.");
          else if (d.kind === "set_reserve") console.log(`Reserve set to ${fl(d.amount)}`);
          else if (d.kind === "invest_family") console.log("Money spent on the family.");
          else if (d.kind === "designate_heir") console.log("Heir named.");
          else if (d.kind === "arrange_marriage") console.log("The match is made.");
          else if (d.kind === "send_to_study") console.log("Sent away to study; the fees are paid.");
          else console.log("Crisis measure taken.");
        }
      } else if (choice === "c") {
        const d = await askHouse(preview);
        if (!d) continue;
        const r = applyDecision(preview, d, gameData);
        if (!r.ok) console.log(`Refused: ${r.reason}`);
        else {
          queued.push(d);
          preview = r.state;
          if (d.kind === "consult_analyst") {
            const op = preview.counting.opinions.at(-1)!;
            const who = preview.counting.staff.find((m) => m.id === op.analyst)?.name ?? "The analyst";
            const name = preview.borrowers.find((b) => b.id === op.borrower)?.name ?? "the borrower";
            console.log(`${who} reads the books of ${name} and calls them ${op.verdict}.`);
          } else if (d.kind === "hire") console.log("Hired, to start next quarter.");
          else if (d.kind === "dismiss") console.log("Dismissed.");
          else console.log("Building begins; it opens next quarter.");
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
      } else if (choice === "m") {
        const d = await askMarkets(preview, ask);
        if (!d) continue;
        const r = applyDecision(preview, d, gameData);
        if (!r.ok) console.log(`Refused: ${r.reason}`);
        else {
          queued.push(d);
          preview = r.state;
          console.log(`Done: ${describeSystemDecision(d, state, gameData) ?? d.kind}.`);
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
