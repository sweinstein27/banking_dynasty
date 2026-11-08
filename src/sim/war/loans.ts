// War loans: while a campaign mobilizes or fights, its states (and in 1848 the Central Power) ask
// the Frankfurt houses for loans. The house lends at par, takes interest each quarter, and is repaid
// at the end of the term unless the borrower fails (a roll weighed by the fortunes of its war).
import type { DecisionResult } from "../actions";
import { reputationGate } from "../bonds";
import { checkCapacity, useCapacity } from "../capacity";
import { connectionsBonus, headStat } from "../family";
import { fl } from "../format";
import { addEntry } from "../ledger";
import { amountToSell } from "../liquidity";
import { freeCash } from "../reserves";
import type { Rng } from "../rng";
import { cloneState } from "../state";
import type { GameData, Tuning } from "../tuning";
import type { GameState } from "../types";
import { isPhase, stateName } from "./campaigns";
import type { CampaignData, OfferData, SubscribeWarLoanDecision, WarLoan } from "./types";

/** Smallest amount the house may lend on an offer. */
export const MIN_WAR_LOAN = 1000;

export interface OpenOffer {
  offer: OfferData;
  campaign: CampaignData;
  /** Lent on this offer so far (repaid loans included), fl. */
  lent: number;
  /** What the house may still lend on it, fl. */
  room: number;
}

const lentOn = (state: GameState, offerId: string) => state.war.loans.filter((l) => l.offer === offerId).reduce((s, l) => s + l.principal, 0);

/** Offers open this quarter: their campaign is in one of their phases and the borrower has not defaulted. */
export function openOffers(state: GameState, data: GameData): OpenOffer[] {
  const out: OpenOffer[] = [];
  for (const campaign of data.war.campaigns) {
    const stage = state.war.campaigns[campaign.id]?.stage;
    if (!stage || !isPhase(stage)) continue;
    for (const offer of campaign.offers) {
      if (!offer.phases.includes(stage) || state.defaulted_states.includes(offer.borrower)) continue;
      const lent = lentOn(state, offer.id);
      out.push({ offer, campaign, lent, room: Math.max(0, offer.max - lent) });
    }
  }
  return out;
}

/** Reputation a borrower asks of the house: a state's bond gate, or the borrower's own less the head's Connections. */
export function warLoanGate(state: GameState, borrower: string, data: GameData): number {
  const issuer = data.states.find((s) => s.id === borrower);
  if (issuer) return reputationGate(state, issuer, data);
  const b = data.war.borrowers.find((x) => x.id === borrower);
  return (b?.min_reputation ?? 0) - connectionsBonus(headStat(state, "connections", data), data.tuning);
}

export function checkSubscribe(state: GameState, d: SubscribeWarLoanDecision, data: GameData): string | null {
  const open = openOffers(state, data).find((o) => o.offer.id === d.offer);
  if (!open) return `No war loan "${d.offer}" is open this quarter`;
  const noAction = checkCapacity(state, "subscribe_war_loan", data.tuning);
  if (noAction) return noAction;
  const name = stateName(data, open.offer.borrower);
  const gate = warLoanGate(state, open.offer.borrower, data);
  if (state.house.reputation < gate) return `${name} will only borrow from houses of reputation ${gate} or more (yours is ${state.house.reputation})`;
  if (!Number.isInteger(d.amount)) return "The amount must be whole gulden";
  if (d.amount < MIN_WAR_LOAN) return `The amount must be at least ${fl(MIN_WAR_LOAN)}`;
  if (d.amount > open.room) return `${name} asks no more than ${fl(open.room)} more of the house`;
  if (d.amount > freeCash(state)) return `Not enough cash above the reserve (free ${fl(freeCash(state))})`;
  return null;
}

/** Lends on a war loan. Returns a new state; the input is not changed. */
export function subscribeWarLoan(state: GameState, d: SubscribeWarLoanDecision, data: GameData): DecisionResult {
  const reason = checkSubscribe(state, d, data);
  if (reason) return { ok: false, reason };
  const { offer, campaign } = openOffers(state, data).find((o) => o.offer.id === d.offer)!;
  const next = cloneState(state);
  const loan: WarLoan = {
    id: next.war.next_id++,
    campaign: campaign.id,
    offer: offer.id,
    borrower: offer.borrower,
    principal: d.amount,
    rate: offer.rate,
    start_turn: next.world.turn,
    due_turn: next.world.turn + offer.term_quarters - 1,
    status: "active",
  };
  next.war.loans.push(loan);
  next.house.cash -= d.amount;
  const note = `War loan #${loan.id}: ${fl(d.amount)} to ${stateName(data, offer.borrower)} at ${(offer.rate * 100).toFixed(1)}% for ${offer.term_quarters} quarters`;
  addEntry(next, "cash", "war_loan", -d.amount, note);
  addEntry(next, "war_loans", "war_loan", d.amount, note);
  if (!next.war.lent_on.includes(offer.id)) {
    next.war.lent_on.push(offer.id);
    if (offer.repression) next.house.reputation = Math.max(0, Math.min(100, next.house.reputation - offer.repression));
  }
  useCapacity(next, "subscribe_war_loan", data.tuning);
  return { ok: true, state: next };
}

/** Principal of the house's active war loans, whole gulden. */
export function warLoansBook(state: GameState): number {
  return (state.war?.loans ?? []).filter((l) => l.status === "active").reduce((s, l) => s + l.principal, 0);
}

/** Chance a war loan's borrower fails at the end of its term: the offer's chance, raised by each step of bad fortune. */
export function failChance(state: GameState, loan: WarLoan, data: GameData): number {
  const offer = data.war.campaigns.find((c) => c.id === loan.campaign)?.offers.find((o) => o.id === loan.offer);
  if (!offer) return 0;
  const fortune = state.war.campaigns[loan.campaign]?.fortune[loan.borrower] ?? 0;
  return Math.min(1, offer.default_chance * (1 + data.war.fortune.default_weight * Math.max(0, fortune)));
}

function fail(state: GameState, loan: WarLoan, recovery: number, why: string): void {
  const back = Math.round(loan.principal * recovery);
  const note = `War loan #${loan.id}: ${why}${back ? `, ${fl(back)} recovered` : ""}`;
  addEntry(state, "war_loans", "war_default", -loan.principal, note);
  if (back) {
    state.house.cash += back;
    addEntry(state, "cash", "war_default", back, note);
  }
  loan.status = "defaulted";
  state.news.push({ turn: state.world.turn, kind: "europe", title: "A war loan fails", text: `${note}.` });
}

/**
 * The quarter's war loans: a loan whose borrower has defaulted on its bonds is lost; the rest pay
 * a quarter's interest; those due are repaid, or fail on one roll each (in loan order). Mutates `state`.
 */
export function serviceWarLoans(state: GameState, rng: Rng, data: GameData): void {
  const turn = state.world.turn;
  for (const loan of state.war.loans) {
    if (loan.status !== "active") continue;
    const name = stateName(data, loan.borrower);
    if (state.defaulted_states.includes(loan.borrower)) {
      fail(state, loan, 0, `${name} has defaulted`);
      continue;
    }
    const interest = Math.round((loan.principal * loan.rate) / 4);
    if (interest > 0) {
      state.house.cash += interest;
      addEntry(state, "cash", "war_interest", interest, `War loan #${loan.id}: interest from ${name}`);
    }
    if (loan.due_turn > turn) continue;
    const offer = data.war.campaigns.find((c) => c.id === loan.campaign)?.offers.find((o) => o.id === loan.offer);
    if (rng.next() < failChance(state, loan, data)) {
      fail(state, loan, offer?.recovery ?? 0, `${name} cannot repay`);
      continue;
    }
    state.house.cash += loan.principal;
    const note = `War loan #${loan.id}: ${name} repays ${fl(loan.principal)}`;
    addEntry(state, "cash", "war_repaid", loan.principal, note);
    addEntry(state, "war_loans", "war_repaid", -loan.principal, note);
    loan.status = "repaid";
  }
}

/**
 * Forced sales: sells war loans (oldest first) at the loan discount until `needed` is raised.
 * Only the slice needed is sold. Returns the cash raised. Mutates `state`.
 */
export function raiseFromWar(state: GameState, needed: number, tuning: Tuning, purpose: string): number {
  let raised = 0;
  const ratio = 1 - tuning.forced_sale.loan_discount;
  for (const loan of state.war?.loans ?? []) {
    if (raised >= needed) break;
    if (loan.status !== "active") continue;
    const slice = amountToSell(needed - raised, loan.principal, ratio);
    const price = Math.round(slice * ratio);
    loan.principal -= slice;
    if (loan.principal === 0) loan.status = "sold";
    state.house.cash += price;
    raised += price;
    const note = `War loan #${loan.id} (${loan.borrower}): ${fl(slice)} sold at a discount ${purpose}`;
    addEntry(state, "cash", "forced_sale", price, note);
    addEntry(state, "war_loans", "forced_sale", -slice, note);
  }
  return raised;
}
