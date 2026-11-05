import { applyDecision } from "./decisions";
import { addEntry } from "./ledger";
import { defaultChance, quarterlyInterest } from "./loans";
import type { Rng } from "./rng";
import type { GameData } from "./tuning";
import type { Decision, GameState, Quarter } from "./types";

/** NetWorth = Cash + Loans + Bonds + Ventures - Deposits. Bonds and ventures arrive in week 2. */
export function netWorth(state: GameState): number {
  return state.house.cash + loanBook(state) - state.house.deposits;
}

export function loanBook(state: GameState): number {
  return state.loans.filter((l) => l.status === "active").reduce((sum, l) => sum + l.principal, 0);
}

/**
 * Resolves one quarter:
 * 1. apply decisions, 2. roll defaults, 3. collect interest from survivors,
 * 4. repay loans that reached their term, 5. advance the calendar.
 * Throws if a decision is invalid; callers should check with applyDecision first.
 */
export function endTurn(state: GameState, decisions: Decision[], rng: Rng, data: GameData): GameState {
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
