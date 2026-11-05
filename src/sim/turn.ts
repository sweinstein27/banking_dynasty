import { runOver } from "./actions";
import { bondBook, markBonds, resolveBonds } from "./bonds";
import { applyDecision } from "./decisions";
import { addEntry } from "./ledger";
import { resolveWithdrawals } from "./liquidity";
import { quarterNews } from "./news";
import { defaultChance, quarterlyInterest } from "./loans";
import type { Rng } from "./rng";
import { nextSentiment } from "./sentiment";
import type { GameData } from "./tuning";
import type { Decision, GameState, Quarter } from "./types";
import { resolveVentures, ventureBook } from "./ventures";

/** NetWorth = Cash + Loans + Bonds + Ventures - Deposits. Ventures count at cost until they resolve. */
export function netWorth(state: GameState): number {
  return state.house.cash + loanBook(state) + bondBook(state) + ventureBook(state) - state.house.deposits;
}

export function loanBook(state: GameState): number {
  return state.loans.filter((l) => l.status === "active").reduce((sum, l) => sum + l.principal, 0);
}

/**
 * Resolves one quarter:
 * 1. apply decisions, 2. roll defaults, 3. collect interest from survivors,
 * 4. repay loans that reached their term, 5. roll bond defaults and pay coupons,
 * 6. resolve ventures that reach their term, 7. depositors withdraw for the current mood, with
 * forced sales if cash runs short (bankruptcy if even that fails), 8. roll next quarter's mood,
 * 9. mark bonds to that mood's prices, 10. write the quarter's news, 11. advance the calendar.
 * Throws if the run is over (bankrupt, or past tuning.end), or if a decision is invalid (check with applyDecision first).
 */
export function endTurn(state: GameState, decisions: Decision[], rng: Rng, data: GameData): GameState {
  const over = runOver(state, data.tuning);
  if (over === "bankrupt") throw new Error("The house is bankrupt; the run has ended");
  if (over === "finished") throw new Error("The run is over; the last quarter has been played");
  let next = state;
  for (const d of decisions) {
    const result = applyDecision(next, d, data);
    if (!result.ok) throw new Error(`Invalid decision: ${result.reason}`);
    next = result.state;
  }
  next = structuredClone(next);
  const { world, house } = next;

  for (const loan of next.loans) {
    if (loan.status !== "active") continue;

    if (rng.next() < defaultChance(loan.quality, world.sentiment, data.tuning)) {
      loan.status = "defaulted";
      addEntry(next, "loans", "default", -loan.principal, `Loan #${loan.id}: ${loan.borrower_name} defaulted`);
      continue;
    }

    const interest = quarterlyInterest(loan);
    house.cash += interest;
    addEntry(next, "cash", "interest", interest, `Loan #${loan.id}: interest from ${loan.borrower_name}`);

    const quartersElapsed = world.turn - loan.start_turn + 1;
    if (quartersElapsed >= loan.term_quarters) {
      loan.status = "repaid";
      house.cash += loan.principal;
      const note = `Loan #${loan.id}: ${loan.borrower_name} repaid`;
      addEntry(next, "cash", "repayment", loan.principal, note);
      addEntry(next, "loans", "repayment", -loan.principal, note);
    }
  }

  resolveBonds(next, rng, data);
  resolveVentures(next, rng, data);
  resolveWithdrawals(next, data.tuning);
  world.sentiment = nextSentiment(world.sentiment, rng.next(), data.tuning);
  markBonds(next, data);
  next.news.push(...quarterNews(state, next, data));

  next.actions_this_turn = 0;
  world.turn += 1;
  if (world.quarter === 4) {
    world.quarter = 1;
    world.year += 1;
  } else {
    world.quarter = (world.quarter + 1) as Quarter;
  }
  return next;
}
