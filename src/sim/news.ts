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
