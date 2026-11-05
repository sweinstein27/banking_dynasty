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
  /** A bankrupt house cannot play another turn: the run is over. */
  status: HouseStatus;
}

export type HouseStatus = "solvent" | "bankrupt";

export type LoanStatus = "active" | "repaid" | "defaulted" | "sold";

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
export type LedgerAccount = "cash" | "loans" | "bonds" | "ventures" | "deposits";

export type LedgerCategory = "opening" | "loan_out" | "interest" | "default" | "repayment"
  | "withdrawal"
  | "forced_sale"
  | "bond_purchase"
  | "coupon"
  | "revaluation"
  | "bond_default"
  | "venture_in"
  | "venture_payout"
  | "venture_failure";

export type BondStatus = "active" | "defaulted" | "sold";

/** One purchase of a state's bonds. Several purchases of the same state are separate holdings. */
export interface Bond {
  id: number;
  /** Id from data/states.json. */
  issuer_state: string;
  /** Whole gulden. Coupons are paid on this. */
  face_value: number;
  /** Annual coupon on face value. */
  coupon: number;
  /** Market price per gulden of face value at the last mark; book value is face_value * price. */
  price: number;
  risk: number;
  purchase_turn: number;
  status: BondStatus;
}

export type VentureStatus = "active" | "paid_out" | "failed" | "sold";

/** Capital backing one venture. Field names follow the spec's venture table, plus timing. */
export interface Venture {
  id: number;
  /** Id from data/ventures.json. */
  type: string;
  /** Whole gulden still at stake (reduced if part is sold to meet withdrawals). */
  invested: number;
  expected_return: number;
  failure_risk: number;
  unlock_year: number;
  start_turn: number;
  term_quarters: number;
  status: VentureStatus;
}

export interface LedgerEntry {
  id: number;
  turn: number;
  account: LedgerAccount;
  category: LedgerCategory;
  /** Whole gulden. Positive increases the account balance. */
  amount: number;
  note: string;
}

export type NewsKind =
  | "loan_default"
  | "bond_default"
  | "venture_paid_out"
  | "venture_failed"
  | "withdrawal"
  | "forced_sale"
  | "bankruptcy"
  | "mood";

/** One message for the News panel, written when a quarter resolves. */
export interface NewsItem {
  /** The turn whose resolution produced it. */
  turn: number;
  kind: NewsKind;
  text: string;
}

export interface GameState {
  world: WorldState;
  house: House;
  loans: Loan[];
  bonds: Bond[];
  /** States that have defaulted. They pay nothing more and sell no new bonds. */
  defaulted_states: string[];
  ventures: Venture[];
  ledger: LedgerEntry[];
  next_ledger_id: number;
  /** Every quarter's news, oldest first. */
  news: NewsItem[];
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

export interface BuyBondDecision {
  kind: "buy_bond";
  /** Id from data/states.json. */
  state: string;
  /** Face value in whole gulden. The cost is face value times the current price. */
  face_value: number;
}

export interface InvestVentureDecision {
  kind: "invest_venture";
  /** Id from data/ventures.json. */
  venture: string;
  /** Whole gulden. */
  amount: number;
}

export type Decision = LendDecision | SetReserveDecision | BuyBondDecision | InvestVentureDecision;
