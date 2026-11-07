// What the Bourse's merchants page shows: each request with the house's file on the borrower, the
// analyst's opinion and why each credit decision can or cannot be taken now. Built only from the
// sim's own functions; no quality number ever leaves here (tests/ui-credit.test.ts checks).
import { checkFile, checkSellLoan, fileCost, KIND_WORDS, saleDiscount, type BookFile } from "../../sim/systems/credit";
import { checkConsult, type Verdict } from "../../sim/systems/counting";
import { checkCapacity } from "../../sim/capacity";
import { fl } from "../../sim/format";
import { lendOffers, loanSaleOffers, type LendOffer, type LoanSaleOffer } from "../../sim/offers";
import type { GameData } from "../../sim/tuning";
import type { GameState } from "../../sim/types";
import type { Line, Section } from "./breakdowns";

/** One line of a document: a label and what it says. */
export interface DocLine {
  label: string;
  value: string;
  term?: string;
}

/** A report or inquiry as a document: its heading, its age and its lines. */
export interface FileDoc {
  title: string;
  age: string;
  /** True once the file is old enough to buy again. */
  stale: boolean;
  lines: DocLine[];
  /** The partner's remark, for an inquiry. */
  remark: string | null;
}

export function ageWords(quarters: number): string {
  return quarters === 0 ? "bought this quarter" : quarters === 1 ? "1 quarter old" : `${quarters} quarters old`;
}

/** A file on a borrower's books, as the house bought it. */
export function fileDoc(f: BookFile, turn: number, data: GameData): FileDoc {
  const inquiry = f.tier === "inquiry";
  const lines: DocLine[] = [
    { label: "Turnover a year", value: fl(f.turnover) },
    { label: "Profit a year, as the books show it", value: fl(f.profit) },
    { label: "Debts to other lenders", value: fl(f.debts) },
    { label: "Late payments", value: `${f.late_payments} in ${f.record_quarters} quarters`, term: "payment_record" },
  ];
  if (inquiry) {
    lines.push({ label: "Collateral", value: fl(f.collateral ?? 0), term: "collateral" });
    lines.push({ label: "True profit a year", value: fl(f.true_profit ?? 0) });
  }
  return {
    title: inquiry ? "Full inquiry" : "Correspondent's report",
    age: ageWords(turn - f.turn),
    stale: turn - f.turn >= data.credit.info.stale_quarters,
    lines,
    remark: inquiry && f.remark ? data.credit.remarks[f.remark] : null,
  };
}

export const VERDICT_WORDS: Record<Verdict, string> = {
  sound: "Sound: the books bear out a safe loan.",
  doubtful: "Doubtful: there is something in the books I do not like.",
  unsound: "Unsound: I would not lend to this house.",
};

/** The analyst's written opinion on a borrower this quarter, or null if none was asked for. */
export function opinionOn(state: GameState, borrower: number): { verdict: Verdict; analyst: string; words: string } | null {
  const o = state.counting.opinions.find((x) => x.borrower === borrower && x.turn === state.world.turn);
  if (!o) return null;
  const who = state.counting.staff.find((m) => m.id === o.analyst)?.name ?? "An analyst";
  return { verdict: o.verdict, analyst: who, words: VERDICT_WORDS[o.verdict] };
}

/** A credit action on one borrower: its label, price and why it is refused now (null if it can go ahead). */
export interface CreditAction {
  kind: "lend" | "report" | "inquire" | "consult_analyst";
  label: string;
  blocked: string | null;
}

export interface MerchantRow {
  offer: LendOffer;
  /** "Bill of exchange, 4 quarters". */
  request: string;
  doc: FileDoc | null;
  opinion: ReturnType<typeof opinionOn>;
  actions: CreditAction[];
}

/** Every request this quarter with what the house knows and can do about it. */
export function merchantRows(state: GameState, data: GameData): MerchantRow[] {
  const reportCost = fileCost(state, "report", data);
  const inquiryCost = fileCost(state, "inquiry", data);
  return lendOffers(state, data).map((o) => {
    const kind = KIND_WORDS[o.kind];
    return {
      offer: o,
      request: `${kind[0]!.toUpperCase()}${kind.slice(1)}, ${o.term_quarters} quarters`,
      doc: o.file ? fileDoc(o.file, state.world.turn, data) : null,
      opinion: opinionOn(state, o.borrower_id),
      actions: [
        { kind: "lend", label: "Lend", blocked: checkCapacity(state, "lend", data.tuning) },
        { kind: "report", label: `Buy a report, ${fl(reportCost)}`, blocked: checkFile(state, o.borrower_id, "report", data) },
        { kind: "inquire", label: `Buy an inquiry, ${fl(inquiryCost)}`, blocked: checkFile(state, o.borrower_id, "inquiry", data) },
        { kind: "consult_analyst", label: "Ask an analyst", blocked: checkConsult(state, { kind: "consult_analyst", borrower: o.borrower_id }, data) },
      ],
    };
  });
}

/** Where a loan's sale price comes from: principal less each part of the discount. The lines add up to the price. */
export function salePriceSection(state: GameState, sale: LoanSaleOffer, data: GameData): Section {
  const loan = state.loans.find((l) => l.id === sale.loan_id)!;
  const c = data.credit.sale;
  const b = state.borrowers.find((x) => x.id === loan.borrower_id);
  const mq = b ? b.market_quality : loan.quality;
  const years = sale.quarters_left / 4;
  const parts: [string, number][] = [
    ["Any buyer's margin", c.base],
    ["The bourse's doubts about the borrower", c.per_risk * (1 - mq)],
    [`${years} years left to run`, c.per_year_left * years],
    ["The market's mood", c.mood[state.world.sentiment]],
  ];
  const discount = saleDiscount(loan, state, data);
  const raw = parts.reduce((s, [, x]) => s + x, 0);
  // When the discount is capped, scale the parts down to the cap so they still add up.
  const scale = raw > 0 ? discount / raw : 0;
  const lines: Line[] = [{ label: "Principal owed", value: fl(loan.principal), amount: loan.principal }];
  let taken = 0;
  parts.forEach(([label, x], i) => {
    const n = i === parts.length - 1 ? loan.principal - sale.price - taken : Math.round(loan.principal * x * scale);
    taken += n;
    if (n !== 0) lines.push({ label, value: fl(-n), amount: -n, tone: n > 0 ? "bad" : "good", term: i === 0 ? "sell_loan" : i === 3 ? "market_mood" : undefined });
  });
  return { heading: "What another house pays", lines, total: { label: "Sale price today", value: fl(sale.price), amount: sale.price } };
}

/** Loans the house could sell, each with its discount in fl. and as a share. */
export function loansHeld(state: GameState, data: GameData): (LoanSaleOffer & { discount: number; share: number; blocked: string | null })[] {
  return loanSaleOffers(state, data).map((s) => ({
    ...s,
    discount: s.principal - s.price,
    share: s.principal > 0 ? (s.principal - s.price) / s.principal : 0,
    blocked: checkSellLoan(state, { kind: "sell_loan", loan: s.loan_id }, data),
  }));
}
