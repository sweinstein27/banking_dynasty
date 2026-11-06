import { ageIn, STATS } from "./family";
import { fl } from "./format";
import type { GameData } from "./tuning";
import type { GameState, LedgerEntry, NewsItem, NewsKind } from "./types";


/**
 * The news for the quarter that turned `before` into `after`, read from that quarter's ledger
 * entries and from what changed. `after` must still be on the same turn number (call before the
 * calendar advances). Draws no random numbers.
 */
export function quarterNews(before: GameState, after: GameState, data: GameData): NewsItem[] {
  const turn = after.world.turn;
  const entries = after.ledger.filter((e) => e.turn === turn && e.id >= before.next_ledger_id);
  const news: NewsItem[] = [];
  const add = (kind: NewsKind, text: string) => news.push({ turn, kind, text });
  const sum = (list: LedgerEntry[]) => list.reduce((s, e) => s + e.amount, 0);

  for (const f of after.fired_events.slice(before.fired_events.length)) {
    const ev = data.events.find((e) => e.id === f.id);
    if (ev) news.push({ turn, kind: "event", title: ev.title, text: ev.text });
  }

  for (const loan of after.loans) {
    if (loan.status !== "defaulted" || before.loans.find((l) => l.id === loan.id)?.status === "defaulted") continue;
    add("loan_default", `${loan.borrower_name} defaulted, losing the full principal of ${fl(loan.principal)}`);
  }

  for (const id of after.defaulted_states) {
    if (before.defaulted_states.includes(id)) continue;
    const name = data.states.find((s) => s.id === id)?.name ?? id;
    const lost = -sum(entries.filter((e) => e.category === "bond_default" && after.bonds.some(
      (b) => b.issuer_state === id && e.note.startsWith(`Bond #${b.id}:`))));
    add("bond_default", `The ${name} has defaulted on its bonds. Holdings worth ${fl(lost)} are written off.`);
  }

  for (const v of after.ventures) {
    const was = before.ventures.find((b) => b.id === v.id);
    if (!was || was.status === v.status) continue;
    const name = data.ventures.find((t) => t.id === v.type)?.name ?? v.type;
    if (v.status === "paid_out") {
      const payout = sum(entries.filter((e) => e.account === "cash" && e.category === "venture_payout" && e.note.startsWith(`Venture #${v.id}:`)));
      add("venture_paid_out", `Venture #${v.id} (${name}) succeeded, turning a stake of ${fl(was.invested)} into ${fl(payout)}`);
    } else if (v.status === "failed") {
      add("venture_failed", `Venture #${v.id} (${name}) failed. The stake of ${fl(was.invested)} is lost.`);
    }
  }

  const withdrawn = -sum(entries.filter((e) => e.account === "deposits" && e.category === "withdrawal"));
  if (withdrawn > 0) {
    const mood = before.world.sentiment;
    const run = mood === "panic" ? " A run on the bank." : "";
    add("withdrawal", `Depositors withdrew ${fl(withdrawn)} (${mood}).${run}`);
  }

  if (after.withdrawal_policy === "slow") add("crisis", "You paid depositors only part of what they asked. They will be back, and the bourse noticed.");
  if (after.withdrawal_policy === "suspended") add("crisis", "You suspended withdrawals. Depositors were turned away at the door, and the whole bourse is talking.");
  for (const e of entries.filter((x) => x.account === "borrowings" && x.category === "borrowing")) {
    const debt = after.debts.find((d) => e.note.startsWith(`Debt #${d.id}:`))!;
    add("crisis", `You borrowed ${fl(e.amount)} from ${debt.lender} at ${(debt.rate * 100).toFixed(1)}%, due in ${debt.term_quarters} quarters.`);
  }
  for (const e of entries.filter((x) => x.account === "borrowings" && x.category === "debt_repayment")) {
    const debt = after.debts.find((d) => e.note.startsWith(`Debt #${d.id}:`))!;
    add("crisis", `You repaid ${fl(-e.amount)} to ${debt.lender}.`);
  }
  for (const loan of after.loans) {
    if (loan.status !== "called" || before.loans.find((l) => l.id === loan.id)?.status === "called") continue;
    const back = entries.find((e) => e.account === "cash" && e.category === "loan_called" && e.note.startsWith(`Loan #${loan.id}:`))?.amount ?? 0;
    add("crisis", `You called in ${loan.borrower_name}'s loan of ${fl(loan.principal)} and recovered ${fl(back)} They will not ask again for a while.`);
  }

  const sales = entries.filter((e) => e.account === "cash" && e.category === "forced_sale");
  if (sales.length) {
    const lost = -sum(entries.filter((e) => e.account !== "cash" && e.category === "forced_sale")) - sum(sales);
    add("forced_sale", `Assets were sold at a discount to pay depositors: ${sales.length} sale(s) raised ${fl(sum(sales))}, losing ${fl(lost)} of book value.`);
  }

  if (before.house.status !== "bankrupt" && after.house.status === "bankrupt") {
    add("bankruptcy", `${after.house.name} could not meet its obligations, even after selling its assets. The house is bankrupt.`);
  }

  const rep = after.house.reputation - before.house.reputation;
  if (rep !== 0) {
    add("reputation", `The house's reputation ${rep > 0 ? "rises" : "falls"} to ${after.house.reputation} (was ${before.house.reputation}).`);
  }

  for (const sc of after.successions.slice(before.successions.length)) {
    const dead = after.people.find((p) => p.id === sc.from)!;
    const heir = after.people.find((p) => p.id === sc.to)!;
    const year = after.world.year;
    const cousin = !before.people.some((p) => p.id === heir.id);
    const who = cousin
      ? `With no heir left, a distant cousin, ${heir.name}, aged ${ageIn(heir, year)}, comes to take over.`
      : `${heir.name}, aged ${ageIn(heir, year)}, takes over the house${sc.named ? `, as ${dead.name} had named` : ""}.`;
    const elder = after.people.find((p) => p.id === sc.passed_over);
    const passed = elder ? ` The elder ${elder.name} is passed over, and the bourse mutters.` : "";
    const how = sc.trained ? "" : " Untrained and unready, the new head will need time, and the bourse knows it.";
    add("family", `${dead.name} has died, aged ${ageIn(dead, year)}. ${who}${passed}${how}`);
  }
  const namedNow = after.house.designated_heir;
  if (namedNow !== null && namedNow !== before.house.designated_heir) {
    const head = after.people.find((p) => p.is_head && p.death_year === null);
    const heir = after.people.find((p) => p.id === namedNow);
    if (head && heir) add("family", `${head.name} names ${heir.name} as heir to the house.`);
  }
  // Stats that rose this quarter (education, or an event), for living people already in the house.
  for (const p of after.people) {
    const was = before.people.find((x) => x.id === p.id);
    if (!was || p.death_year !== null) continue;
    for (const stat of STATS) {
      if (p[stat] > was[stat]) add("family", `${p.name} gains in ${stat}: now ${p[stat]} (was ${was[stat]}).`);
    }
  }
  for (const p of after.people) {
    const was = before.people.find((x) => x.id === p.id);
    if (!was || p.death_year !== null) continue;
    for (const id of p.traits.filter((t) => !was.traits.includes(t))) {
      const trait = data.traits.find((t) => t.id === id);
      if (!trait) continue;
      const schooled = trait.virtue_for !== undefined && p[trait.virtue_for] >= data.tuning.family.traits.virtue_stat;
      add("family", schooled
        ? `${p.name} comes of age, and the years of schooling show: ${trait.name.toLowerCase()}. ${trait.description}`
        : `${p.name} comes of age and proves ${trait.name.toLowerCase()}. ${trait.description}`);
    }
  }
  for (const p of after.people.slice(before.people.length)) {
    if (after.successions.some((sc) => sc.to === p.id && !before.successions.includes(sc))) continue;
    const trait = data.traits.find((t) => t.id === p.traits[0]);
    add("family", `A child, ${p.name}, is born to the house.${trait ? ` The nurse already calls the child ${trait.name.toLowerCase()}.` : ""}`);
  }

  if (after.panic_warning) {
    const signs = data.tuning.sentiment.warning_signs;
    const sign = signs.length ? `${signs[turn % signs.length]} ` : "";
    const n = after.panic_warning.turns_left;
    add("warning", `${sign}Warning: a panic is coming ${n === 1 ? "next quarter" : `in ${n} quarters`}.`);
  }

  if (after.world.sentiment !== before.world.sentiment) {
    add("mood", `Market sentiment turns ${after.world.sentiment} (was ${before.world.sentiment}).`);
  }
  return news;
}
