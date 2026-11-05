// Field names follow the data model in docs/spec.md so save files line up with it.

export type Sentiment = "calm" | "uneasy" | "panic";
export type Quarter = 1 | 2 | 3 | 4;

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

export type LoanStatus = "active" | "repaid" | "defaulted" | "sold" | "called";

/** A member of the family. Field names follow the spec's person table. Stats run from 1 to 10. */
export interface Person {
  id: number;
  house_id: number;
  name: string;
  birth_year: number;
  death_year: number | null;
  is_head: boolean;
  /** Venture success. */
  acumen: number;
  /** Spotting bad borrowers. */
  prudence: number;
  /** Access to state bonds. */
  connections: number;
}

/** A merchant house that borrows from the player. Quality is hidden: the player sees estimateRange. */
export interface Borrower {
  id: number;
  name: string;
  trade: string;
  /** True chance-of-repayment quality, 0 (worst) to 1 (best). Never shown to the player. */
  quality: number;
  /** What the market believes. Sets the highest rate the borrower will pay; falls after a default. */
  market_quality: number;
  /** Fixed draw in [-1, 1] placing the player's estimate around the truth, so it cannot be re-rolled. */
  estimate_noise: number;
  /** A correspondent's report has been bought: the estimate is narrow from now on. */
  reported: boolean;
  repaid: number;
  defaulted: number;
  last_default_turn: number | null;
  /** Asks for no loan before this turn (after a default, or after the house called a loan in). */
  away_until: number | null;
}

/** A borrower asking the house for a loan this quarter. */
export interface LoanRequest {
  borrower_id: number;
  /** Most the borrower will take, in whole gulden. */
  amount: number;
  /** Highest annual rate the borrower will pay. */
  max_rate: number;
}

export interface Loan {
  id: number;
  borrower_id: number;
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
export type LedgerAccount = "cash" | "loans" | "bonds" | "ventures" | "deposits" | "borrowings";

export type LedgerCategory = "event" | "report" | "borrowing" | "debt_interest" | "debt_repayment" | "loan_called" | "opening" | "loan_out" | "interest" | "default" | "repayment"
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
  | "mood"
  | "event"
  | "reputation"
  | "warning"
  | "crisis";

/** One message for the News panel, written when a quarter resolves. */
export interface NewsItem {
  /** The turn whose resolution produced it. */
  turn: number;
  kind: NewsKind;
  /** Headline, for events. */
  title?: string;
  text: string;
}

export interface FiredEvent {
  id: string;
  /** The turn at whose end it fired; it describes the quarter that follows. */
  turn: number;
}

/** "slow" pays a share of what depositors ask this quarter; "suspended" pays nothing. */
export type WithdrawalPolicy = "normal" | "slow" | "suspended";

export type DebtStatus = "active" | "repaid";

/** Money borrowed by the house. Interest is paid each quarter; the principal falls due at the end of the term. */
export interface Debt {
  id: number;
  lender: string;
  principal: number;
  /** Annual rate. */
  rate: number;
  start_turn: number;
  term_quarters: number;
  status: DebtStatus;
}

export interface GameState {
  world: WorldState;
  house: House;
  loans: Loan[];
  bonds: Bond[];
  /** States that have defaulted. They pay nothing more and sell no new bonds. */
  defaulted_states: string[];
  ventures: Venture[];
  borrowers: Borrower[];
  /** The family, living and dead, in order of birth (the founding head first). */
  people: Person[];
  /** This quarter's loan requests, drawn at the end of the previous turn. */
  requests: LoanRequest[];
  ledger: LedgerEntry[];
  next_ledger_id: number;
  /** Every quarter's news, oldest first. */
  news: NewsItem[];
  /** Events that have fired, in order. The spec's event.fired_turn. */
  fired_events: FiredEvent[];
  /** Change to each state's risk caused by events, by state id. Missing means no change. */
  risk_shift: Record<string, number>;
  /** Multiplier on every loan's default chance, set by events. 1 means no change. */
  trade_risk: number;
  /** A panic is coming: the market stays uneasy for `turns_left` more quarters, then panics. */
  panic_warning: { turns_left: number } | null;
  /** Money the house owes, such as emergency loans from the rival house. */
  debts: Debt[];
  /** How depositors are paid this quarter. Reset to "normal" when the turn ends. */
  withdrawal_policy: WithdrawalPolicy;
  /** Decisions taken so far this turn. Reset when the turn ends. */
  actions_this_turn: number;
}

export interface LendDecision {
  kind: "lend";
  /** Borrower id; the borrower must have a request this quarter. */
  borrower: number;
  /** Whole gulden, no more than the request. */
  amount: number;
  /** Annual rate, no more than the request's maximum. */
  rate: number;
}

/** Buy a correspondent's report on a borrower who is asking for a loan: narrows the quality estimate. */
export interface ReportDecision {
  kind: "report";
  borrower: number;
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

/** Crisis response: borrow from the rival house. */
export interface BorrowDecision {
  kind: "borrow";
  /** Whole gulden. */
  amount: number;
}

/** Crisis response: pay depositors only part of what they ask this quarter. */
export interface PaySlowlyDecision {
  kind: "pay_slowly";
}

/** Crisis response: pay depositors nothing this quarter. */
export interface SuspendDecision {
  kind: "suspend";
}

/** Crisis response: call an active loan in early. */
export interface CallLoanDecision {
  kind: "call_loan";
  loan: number;
}

export type CrisisDecision = BorrowDecision | PaySlowlyDecision | SuspendDecision | CallLoanDecision;

export type Decision = LendDecision | ReportDecision | SetReserveDecision | BuyBondDecision | InvestVentureDecision | CrisisDecision;
