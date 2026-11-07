// Lending to other houses. In an uneasy or panicking market a house that has lost wealth may ask
// the player for credit, naming the most it can pay. The player names the rate: a fair price earns
// gratitude (opinion, which sets what the houses lend back in a crisis), a hard one is remembered.
// While the loan runs the house is less likely to fail; if it fails anyway, the claim recovers a
// share from its estate.
import type { DecisionResult } from "../actions";
import { checkCapacity, useCapacity } from "../capacity";
import { fl } from "../format";
import { changeOpinion, tradingHouses } from "../houses";
import { addEntry } from "../ledger";
import { freeCash } from "../reserves";
import type { Rng } from "../rng";
import { cloneState } from "../state";
import type { GameData } from "../tuning";
import type { GameState, OtherHouse } from "../types";
import { clamp, financeNews, nextId, pct, roundTo } from "./common";
import type { HouseLoan, HouseRequest, LendHouseDecision } from "./types";

/** Requests open this quarter. */
export function openHouseRequests(state: GameState): HouseRequest[] {
  return state.finance.house_requests.filter((r) => r.open_turn === state.world.turn);
}

export const activeHouseLoans = (state: GameState) => state.finance.house_loans.filter((l) => l.status === "active");

export function houseLoanBook(state: GameState): number {
  return activeHouseLoans(state).reduce((s, l) => s + l.principal, 0);
}

/** Opinion change for lending at `rate`. */
export function gratitude(rate: number, data: GameData): number {
  return (data.finance.house_loans.gratitude.find((g) => rate <= g.up_to + 1e-9) ?? data.finance.house_loans.gratitude.at(-1)!).opinion;
}

/** How a house's failure chance in a panic is scaled: lower while it owes the player. */
export function rescueFactor(state: GameState, houseId: string, data: GameData): number {
  return activeHouseLoans(state).some((l) => l.house === houseId) ? data.finance.house_loans.rescue_factor : 1;
}

export function checkLendHouse(state: GameState, d: LendHouseDecision, data: GameData): string | null {
  const r = openHouseRequests(state).find((x) => x.id === d.request);
  if (!r) return `No request ${d.request} is open this quarter`;
  const h = state.houses.find((x) => x.id === r.house);
  if (!h || h.failed_turn !== null) return `${h?.name ?? r.house} has failed`;
  const noAction = checkCapacity(state, "lend_house", data.tuning);
  if (noAction) return noAction;
  const t = data.finance.house_loans;
  if (!(d.rate >= t.min_rate)) return `The rate must be at least ${pct(t.min_rate)}`;
  if (d.rate > r.max_rate + 1e-9) return `${h.name} can pay at most ${pct(r.max_rate)}`;
  if (r.amount > freeCash(state)) return `Not enough cash above the reserve (asked ${fl(r.amount)}, free ${fl(freeCash(state))})`;
  return null;
}

/** Lends to a house: the cash goes out now; its opinion moves with the price. Returns a new state. */
export function lendHouse(state: GameState, d: LendHouseDecision, data: GameData): DecisionResult {
  const reason = checkLendHouse(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const r = next.finance.house_requests.find((x) => x.id === d.request)!;
  const h = next.houses.find((x) => x.id === r.house)!;
  const loan: HouseLoan = {
    id: nextId(next), house: h.id, principal: r.amount, rate: d.rate,
    start_turn: next.world.turn, due_turn: next.world.turn + r.term_quarters, status: "active",
  };
  next.finance.house_loans.push(loan);
  next.finance.house_requests = next.finance.house_requests.filter((x) => x.id !== r.id);
  next.house.cash -= r.amount;
  const note = `Credit to ${h.name} at ${pct(d.rate)}`;
  addEntry(next, "cash", "house_loan_out", -r.amount, note);
  addEntry(next, "house_loans", "house_loan_out", r.amount, note);
  changeOpinion(next, h.id, gratitude(d.rate, data), data.tuning);
  useCapacity(next, "lend_house", data.tuning);
  return { ok: true, state: next };
}

/**
 * Each quarter: interest on loans to houses (from the borrowing house's wealth), and repayment of
 * those due, which pleases the borrower. Draws nothing. Mutates `state`.
 */
export function serviceHouseLoans(state: GameState, data: GameData): void {
  for (const l of activeHouseLoans(state)) {
    const h = state.houses.find((x) => x.id === l.house)!;
    if (l.start_turn >= state.world.turn) continue;
    const interest = Math.round((l.principal * l.rate) / 4);
    state.house.cash += interest;
    h.wealth = Math.max(0, h.wealth - interest);
    addEntry(state, "cash", "house_loan_interest", interest, `Interest from ${h.name}`);
    if (state.world.turn >= l.due_turn) {
      state.house.cash += l.principal;
      const note = `${h.name} repays its credit`;
      addEntry(state, "cash", "house_loan_repaid", l.principal, note);
      addEntry(state, "house_loans", "house_loan_repaid", -l.principal, note);
      l.status = "repaid";
      changeOpinion(state, h.id, data.finance.house_loans.repaid_opinion, data.tuning);
      financeNews(state, `${h.name} has repaid ${fl(l.principal)} with thanks.`, undefined, "houses");
    }
  }
}

/** A failed house's debts to the player: the estate pays a share now; the rest is lost. Mutates `state`. */
export function settleFailedHouseLoans(state: GameState, h: OtherHouse, data: GameData): void {
  const share = data.finance.house_loans.recovery[state.world.sentiment];
  for (const l of activeHouseLoans(state).filter((x) => x.house === h.id)) {
    const back = Math.round(l.principal * share);
    const lost = l.principal - back;
    l.status = "failed";
    state.house.cash += back;
    addEntry(state, "cash", "house_loan_recovery", back, `Recovered from the estate of ${h.name}`);
    addEntry(state, "house_loans", "house_loan_recovery", -back, `Recovered from the estate of ${h.name}`);
    addEntry(state, "house_loans", "house_loan_loss", -lost, `Credit to ${h.name} lost in its failure`);
    financeNews(state, `${h.name} owed the house ${fl(l.principal)}; its estate pays ${fl(back)}`, undefined, "houses");
  }
}

/**
 * New requests for next quarter, in an uneasy or panicking market: each house still trading that
 * thinks well enough of the player and owes it nothing rolls once, more likely the more wealth it
 * has lost (and for a bold house). At most one request a quarter. Mutates `state`.
 */
export function drawHouseRequests(state: GameState, rng: Rng, data: GameData): void {
  const t = data.finance.house_loans;
  const mood = state.world.sentiment;
  if (mood === "calm") return;
  for (const h of tradingHouses(state)) {
    if (h.opinion < t.min_opinion || activeHouseLoans(state).some((l) => l.house === h.id)) continue;
    const distress = clamp(((h.start_wealth - h.wealth) / Math.max(1, h.start_wealth)) * t.distress_scale, 0, 1);
    const chance = t.base_chance * Math.max(distress, t.mood_floor[mood]) * t.temperament_factor[h.temperament];
    if (rng.next() >= chance) continue;
    const amount = Math.max(t.min_amount, roundTo(h.wealth * t.share_of_wealth, 1000));
    const max_rate = Math.round((t.max_rate.base + t.max_rate.urgency * t.urgency[mood] + (h.opinion < 0 ? t.max_rate.dislike : 0)) * 10000) / 10000;
    state.finance.house_requests.push({ id: nextId(state), house: h.id, amount, max_rate, term_quarters: t.term_quarters, open_turn: state.world.turn + 1 });
    financeNews(state, `${h.name} asks, quietly, for ${fl(amount)} of credit for a year, and will pay up to ${pct(max_rate)}.`, "A house asks for credit", "houses");
    return;
  }
}
