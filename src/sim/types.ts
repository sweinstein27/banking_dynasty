// Field names follow the data model in docs/spec.md so save files line up with it.

export type Sentiment = "calm" | "uneasy" | "panic";
export type Quarter = 1 | 2 | 3 | 4;
export type TierName = "poor" | "fair" | "good";

export interface WorldState {
  turn: number;
  year: number;
  quarter: Quarter;
  base_rate: number;
  sentiment: Sentiment;
}

export interface House {
  id: number;
  name: string;
  city: string;
  cash: number;
  deposits: number;
  reputation: number;
  /** Cash floor set by the player. Spending may not take cash below it; withdrawals may. */
  reserve: number;
}

export type LoanStatus = "active" | "repaid" | "defaulted";

export interface Loan {
  id: number;
  borrower_name: string;
  principal: number;
  /** Annual rate, e.g. 0.08 for 8%. */
  rate: number;
  /** Borrower quality from 0 (worst) to 1 (best). */
  quality: number;
  start_turn: number;
  term_quarters: number;
  status: LoanStatus;
}

/** Which balance an entry moves. Summing entries per account reproduces that balance. */
export type LedgerAccount = "cash" | "loans" | "deposits";

export type LedgerCategory = "opening" | "loan_out" | "interest" | "default" | "repayment" | "withdrawal";

export interface LedgerEntry {
  id: number;
  turn: number;
  account: LedgerAccount;
  category: LedgerCategory;
  /** Whole gulden. Positive increases the account balance. */
  amount: number;
  note: string;
}

export interface GameState {
  world: WorldState;
  house: House;
  loans: Loan[];
  ledger: LedgerEntry[];
  next_ledger_id: number;
  /** Decisions taken so far this turn. Reset when the turn ends. */
  actions_this_turn: number;
}

export interface LendDecision {
  kind: "lend";
  /** Whole gulden. */
  amount: number;
  /** Annual rate. */
  rate: number;
  tier: TierName;
}

export interface SetReserveDecision {
  kind: "set_reserve";
  /** Whole gulden. */
  amount: number;
}

export type Decision = LendDecision | SetReserveDecision;
