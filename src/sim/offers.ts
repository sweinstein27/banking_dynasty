// What each decision can be made with right now, for the terminal and the UI to list.
import { bondPrice, reputationGate, stateRisk } from "./bonds";
import { headEffects, headStat } from "./family";
import { fileStale, quartersLeft, salePrice, yearsInTrade, type Band, type BookFile } from "./systems/credit";
import type { GameData } from "./tuning";
import type { GameState, LoanKind } from "./types";
import { ventureFailureChance } from "./ventures";

/**
 * A loan request as the player may see it: no true quality and no verdict, only what is public,
 * what the bourse says and whatever report or inquiry the house has bought.
 */
export interface LendOffer {
  borrower_id: number;
  name: string;
  trade: string;
  kind: LoanKind;
  term_quarters: number;
  /** Most the borrower will take, in whole gulden. */
  amount: number;
  /** Highest annual rate the borrower will pay. */
  max_rate: number;
  years_in_trade: number;
  /** What the bourse says this quarter (free, sometimes wrong). */
  talk: Band;
  talk_text: string;
  /** The latest report or inquiry bought, as it stood then, or null. */
  file: BookFile | null;
  /** True if there is no file, or it is old enough to buy again. */
  file_stale: boolean;
  repaid: number;
  defaulted: number;
}

/** An active loan the house could sell to another house today. */
export interface LoanSaleOffer {
  loan_id: number;
  borrower_id: number;
  name: string;
  kind: LoanKind;
  principal: number;
  rate: number;
  quarters_left: number;
  /** What another house pays today, in whole gulden. */
  price: number;
}

export interface BondOffer {
  id: string;
  name: string;
  coupon: number;
  risk: number;
  /** Price per gulden of face value at today's mood. */
  price: number;
  /** Why this state will not sell to the house now, or null if it will. */
  blocked: string | null;
}

export interface VentureOffer {
  id: string;
  name: string;
  term_quarters: number;
  expected_return: number;
  /** Failure chance if the venture ended in today's mood. */
  failure_chance: number;
  unlock_year: number;
  /** Why it cannot be backed now, or null if it can. */
  blocked: string | null;
}

/** This quarter's loan requests, in borrower order. */
export function lendOffers(state: GameState, data: GameData): LendOffer[] {
  return state.requests.map((r) => {
    const b = state.borrowers.find((x) => x.id === r.borrower_id)!;
    return {
      borrower_id: b.id,
      name: b.name,
      trade: b.trade,
      kind: r.kind,
      term_quarters: r.term_quarters,
      amount: r.amount,
      max_rate: r.max_rate,
      years_in_trade: yearsInTrade(b, state.world.year),
      talk: r.talk,
      talk_text: data.credit.talk[r.talk],
      file: b.file,
      file_stale: fileStale(b.file, state.world.turn, data),
      repaid: b.repaid,
      defaulted: b.defaulted,
    };
  });
}

/** Active loans and what each would fetch if sold today, oldest first. */
export function loanSaleOffers(state: GameState, data: GameData): LoanSaleOffer[] {
  return state.loans
    .filter((l) => l.status === "active")
    .map((l) => ({
      loan_id: l.id,
      borrower_id: l.borrower_id,
      name: l.borrower_name,
      kind: l.kind,
      principal: l.principal,
      rate: l.rate,
      quarters_left: quartersLeft(l, state.world.turn),
      price: salePrice(l, state, data),
    }));
}

export function bondOffers(state: GameState, data: GameData): BondOffer[] {
  return data.states.map((st) => {
    let blocked: string | null = null;
    if (state.defaulted_states.includes(st.id)) blocked = "Defaulted";
    else if (state.house.reputation < reputationGate(state, st, data)) blocked = `Needs reputation ${reputationGate(state, st, data)}`;
    return {
      id: st.id,
      name: st.name,
      coupon: st.coupon,
      risk: stateRisk(state, st),
      price: bondPrice(stateRisk(state, st), state.world.sentiment, data.tuning),
      blocked,
    };
  });
}

export function ventureOffers(state: GameState, data: GameData): VentureOffer[] {
  return data.ventures.map((v) => ({
    id: v.id,
    name: v.name,
    term_quarters: v.term_quarters,
    expected_return: v.expected_return,
    failure_chance: ventureFailureChance(v.failure_risk, state.world.sentiment, data.tuning, headStat(state, "acumen", data), headEffects(state, data).venture_failure),
    unlock_year: v.unlock_year,
    blocked: state.world.year < v.unlock_year ? `Not before ${v.unlock_year}` : null,
  }));
}
