import { runOver } from "./actions";
import { bondBook, markBonds, resolveBonds } from "./bonds";
import { applyDecision } from "./decisions";
import { addEntry } from "./ledger";
import { resolveWithdrawals } from "./liquidity";
import { drawRequests, recordDefault, recordRepayment } from "./borrowers";
import { debtBook, serviceDebts } from "./crisis";
import { resolveEvents } from "./events";
import { resolveFamily } from "./family";
import { quarterNews } from "./news";
import { defaultChance, quarterlyInterest } from "./loans";
import type { Rng } from "./rng";
import { moodWithWarnings, nextSentiment } from "./sentiment";
import type { GameData } from "./tuning";
import type { Decision, GameState, Quarter } from "./types";
import { resolveVentures, ventureBook } from "./ventures";

/** NetWorth = Cash + Loans + Bonds + Ventures - Deposits - Borrowings. Ventures count at cost until they resolve. */
export function netWorth(state: GameState): number {
  return state.house.cash + loanBook(state) + bondBook(state) + ventureBook(state) - state.house.deposits - debtBook(state);
}

export function loanBook(state: GameState): number {
  return state.loans.filter((l) => l.status === "active").reduce((sum, l) => sum + l.principal, 0);
}

/**
 * Resolves one quarter:
 * 1. apply decisions, 2. roll defaults, 3. collect interest from survivors,
 * 4. repay loans that reached their term, 5. roll bond defaults and pay coupons,
 * 6. resolve ventures that reach their term, 7. pay interest on debts and repay those due, then
 * depositors withdraw for the current mood (less if paying slowly, nothing if suspended), with
 * forced sales if cash runs short (bankruptcy if even that fails), 8. roll next quarter's mood
 * (a roll into panic starts a warning countdown instead; a running countdown overrides the roll),
 * 9. fire events for next quarter (they can override the mood), then the family's quarter (the
 * head may die and an heir succeed; at year end a child may be born), 10. mark bonds to that mood's
 * prices and each state's risk, 11. draw next quarter's loan requests, 12. write the quarter's
 * news, 13. advance the calendar.
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

    if (rng.next() < defaultChance(loan.quality, world.sentiment, data.tuning, next.trade_risk)) {
      recordDefault(next, loan, `Loan #${loan.id}: ${loan.borrower_name} defaulted`, data.tuning);
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
      recordRepayment(next, loan, data.tuning);
    }
  }

  resolveBonds(next, rng, data);
  resolveVentures(next, rng, data);
  serviceDebts(next, data.tuning);
  resolveWithdrawals(next, data.tuning);
  const rolled = nextSentiment(world.sentiment, rng.next(), data.tuning);
  world.sentiment = moodWithWarnings(next, rolled, rng, data.tuning);
  resolveEvents(next, rng, data);
  resolveFamily(next, rng, data);
  markBonds(next, data);
  next.requests = drawRequests(next, data, rng);
  next.news.push(...quarterNews(state, next, data));

  next.actions_this_turn = 0;
  next.withdrawal_policy = "normal";
  world.turn += 1;
  if (world.quarter === 4) {
    world.quarter = 1;
    world.year += 1;
  } else {
    world.quarter = (world.quarter + 1) as Quarter;
  }
  return next;
}
