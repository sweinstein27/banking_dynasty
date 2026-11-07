// What each harness strategy does with the credit system (milestone A1): how it reads a
// borrower's books, which reports and inquiries it buys, and when it sells a loan.
import type { LendOffer } from "../../sim/offers";
import { loanSaleOffers, lendOffers } from "../../sim/offers";
import type { Band, BookFile } from "../../sim/systems/credit";
import type { GameData } from "../../sim/tuning";
import type { GameState } from "../../sim/types";
import type { Maker, SystemMakers } from "../common";

/** What a strategy guesses a band means for soundness. */
const BAND_GUESS: Record<Band, number> = { sound: 0.85, steady: 0.72, stretched: 0.57, doubtful: 0.4 };
/** A strategy's guess before it knows anything. */
const PRIOR = 0.6;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * A strategy's reading of a borrower's soundness, 0 to 1, from what it may see: bourse talk alone
 * counts for little; a report's book margin, debts and late payments count for more; an inquiry's
 * true margin, collateral and partner's remark count for most. It inverts the books' formulas
 * (data/credit.json) as a careful clerk would, without the hidden quality or quirks.
 */
export function readBooks(talk: Band | null, file: BookFile | null, data: GameData): number {
  const c = data.credit.books;
  const fromTalk = talk ? (PRIOR + BAND_GUESS[talk]) / 2 : PRIOR;
  if (!file || file.turnover <= 0) return fromTalk;
  const fromMargin = (profit: number) => 0.5 + (profit / file.turnover - c.margin.base) / c.margin.per_quality;
  const fromDebts = 1 - (file.debts / file.turnover - c.debts.base) / c.debts.per_unsoundness;
  const latePenalty = 0.05 * file.late_payments;
  if (file.tier === "report") {
    // Book profit is flattered by up to dressing * (1 - q); allow for half of it.
    const margin = fromMargin(file.profit) - (c.dressing * 0.5 * 0.4) / c.margin.per_quality;
    return clamp01((margin + fromDebts) / 2 - latePenalty);
  }
  const margin = fromMargin(file.true_profit ?? file.profit);
  const collateral = file.collateral !== null ? (file.collateral / file.turnover - c.collateral.base) / c.collateral.per_quality : PRIOR;
  const remark = file.remark ? BAND_GUESS[file.remark] : PRIOR;
  return clamp01((margin + fromDebts + collateral + 2 * remark) / 5 - latePenalty);
}

/** readBooks for a loan request. */
export const readOffer = (o: LendOffer, data: GameData) => readBooks(o.talk, o.file, data);

/**
 * The request most worth a file: the best rate times amount among those without a fresh file,
 * big enough to pay for one (a bill never is), that the bourse does not already call stretched or doubtful.
 */
function worthAFile(s: GameState, data: GameData, reportFrom: number): LendOffer | undefined {
  return lendOffers(s, data)
    .filter((o) => o.file_stale && (o.talk === "sound" || o.talk === "steady") && o.kind !== "bill" && o.amount >= reportFrom)
    .sort((a, b) => b.max_rate * b.amount - a.max_rate * a.amount || a.borrower_id - b.borrower_id)[0];
}

/** A full inquiry on a mortgage, else a report, on the request most worth a file. */
const investigate =
  (data: GameData, reportFrom: number): Maker =>
  (s) => {
    const o = worthAFile(s, data, reportFrom);
    if (!o) return null;
    return o.kind === "mortgage" ? { kind: "inquire", borrower: o.borrower_id } : { kind: "report", borrower: o.borrower_id };
  };

/** In a worried market, a report on the borrower behind the largest active loan whose file is stale. */
const checkLargestLoan =
  (data: GameData): Maker =>
  (s) => {
    const worried = s.panic_warning !== null || s.world.sentiment !== "calm";
    if (!worried) return null;
    const stale = loanSaleOffers(s, data)
      .filter((l) => {
        const b = s.borrowers.find((x) => x.id === l.borrower_id)!;
        return !b.file || s.world.turn - b.file.turn >= data.credit.info.stale_quarters;
      })
      .sort((a, b) => b.principal - a.principal || a.loan_id - b.loan_id)[0];
    return stale ? { kind: "report", borrower: stale.borrower_id } : null;
  };

/** Sells an active loan whose borrower's file, bought this quarter, reads below `below`. */
const sellWeak =
  (data: GameData, below: number): Maker =>
  (s) => {
    const weak = loanSaleOffers(s, data).find((l) => {
      const b = s.borrowers.find((x) => x.id === l.borrower_id)!;
      return b.file !== null && b.file.turn === s.world.turn && readBooks(null, b.file, data) < below;
    });
    return weak ? { kind: "sell_loan", loan: weak.loan_id } : null;
  };

/** Makers for strategy `name`: `early` ones go before its other wants, `late` ones after. */
export function creditMakers(name: string, _state: GameState, data: GameData): SystemMakers {
  switch (name) {
    case "cautious":
    case "cautious_no_family":
      return { early: [checkLargestLoan(data), sellWeak(data, 0.55), investigate(data, 8000)], late: [] };
    default:
      return { early: [], late: [] };
  }
}
