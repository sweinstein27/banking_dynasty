import { cloneState } from "./state";
import { runOver } from "./actions";
import { bondBook, markBonds, resolveBonds } from "./bonds";
import { applyDecision } from "./decisions";
import { addEntry } from "./ledger";
import { resolveWithdrawals } from "./liquidity";
import { drawRequests, recordDefault, recordRepayment } from "./borrowers";
import { debtBook, serviceDebts } from "./crisis";
import { resolveDeposits } from "./deposits";
import { resolveEvents } from "./events";
import { headEffects, resolveFamily } from "./family";
import { resolveHouses } from "./houses";
import { settleLetters } from "./letters";
import { quarterNews } from "./news";
import { defaultChance, quarterlyInterest } from "./loans";
import type { Rng } from "./rng";
import { moodWithWarnings, nextSentiment } from "./sentiment";
import type { GameData } from "./tuning";
import type { Decision, GameState, Quarter } from "./types";
import { resolveCounting } from "./systems/counting";
import { resolveCredit } from "./systems/credit";
import { markMarkets, marketsBook, resolveMarkets } from "./systems/markets";
import { resolveVentures, ventureBook } from "./ventures";

/** NetWorth = Cash + Loans + Bonds + Ventures + market holdings - Deposits - Borrowings. Ventures count at cost until they resolve. */
export function netWorth(state: GameState): number {
  return state.house.cash + loanBook(state) + bondBook(state) + ventureBook(state) + marketsBook(state) - state.house.deposits - debtBook(state);
}

export function loanBook(state: GameState): number {
  return state.loans.filter((l) => l.status === "active").reduce((sum, l) => sum + l.principal, 0);
}

/**
 * Resolves one quarter:
 * 1. apply decisions, then settle the quarter's letters (unanswered ones take their default response;
 * chances are rolled), 2. roll defaults, 3. collect interest from survivors,
 * 4. repay loans that reached their term, 5. roll bond defaults and pay coupons,
 * 6. resolve ventures that reach their term, 7. pay interest on debts and repay those due, then
 * depositors withdraw for the current mood (less if paying slowly, nothing if suspended), with
 * forced sales if cash runs short (bankruptcy if even that fails), then interest is credited to
 * depositors and, in a calm market, reputation draws new deposits; then the other houses' quarter
 * (wealth, their heads' deaths, failures in a panic, whose depositors partly come here), 8. roll next quarter's mood
 * (a roll into panic starts a warning countdown instead; a running countdown overrides the roll),
 * 9. fire events for next quarter (they can override the mood; those with responses leave letters), then the family's quarter (the
 * head may die and an heir succeed; at year end a child may be born), 10. mark bonds to that mood's
 * prices and each state's risk, then the markets (harvest, shocks, listings, prices), 11. draw next quarter's loan requests, 12. write the quarter's
 * news, 13. at year end, record the year's net worth, 14. advance the calendar.
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
  next = cloneState(next);
  const { world, house } = next;
  settleLetters(next, rng, data);

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

  resolveCredit(next, rng, data);
  resolveBonds(next, rng, data);
  resolveVentures(next, rng, data);
  resolveMarkets(next, rng, data);
  serviceDebts(next, data.tuning);
  resolveCounting(next, rng, data);
  resolveWithdrawals(next, data.tuning, headEffects(next, data).withdrawals);
  resolveDeposits(next, data.tuning);
  resolveHouses(next, rng, data);
  const rolled = nextSentiment(world.sentiment, rng.next(), data.tuning);
  world.sentiment = moodWithWarnings(next, rolled, rng, data.tuning);
  resolveEvents(next, rng, data);
  resolveFamily(next, rng, data);
  markBonds(next, data);
  markMarkets(next, data);
  next.requests = drawRequests(next, data, rng);
  next.news.push(...quarterNews(state, next, data));

  if (world.quarter === 4) next.year_ends.push({ year: world.year, net_worth: netWorth(next), reputation: house.reputation });

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
