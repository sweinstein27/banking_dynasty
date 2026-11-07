// Field names follow the data model in docs/spec.md so save files line up with it.
import type { CountingCategory, CountingDecision, CountingState } from "./systems/counting";
import type { Band, BookFile, Books, CreditCategory, CreditDecision, CreditState } from "./systems/credit";
import type { MarketsAccount, MarketsCategory, MarketsDecision, MarketsState } from "./systems/markets";
import type { FinanceCategory, FinanceDecision, FinanceState, FinanceAccount } from "./systems/finance";
import type { PeopleCategory, PeopleDecision, PeopleState } from "./systems/people";
import type { EuropeCategory, EuropeDecision, EuropeState, EuropeAccount } from "./systems/europe";
import type { ProgressCategory, ProgressDecision, ProgressState } from "./systems/progress";

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
  /** The heir the head has named to take over, or null to leave it to the automatic choice. */
  designated_heir: number | null;
}

export type HouseStatus = "solvent" | "bankrupt";

export type LoanStatus = "active" | "repaid" | "defaulted" | "sold" | "called";

/** A member of the family. Field names follow the spec's person table. Stats run from 1 to 10. */
/**
 * "line": born to the house (or the cousin), so an heir while living and not head. "spouse": married
 * in; never an heir and never head. "left": married out into another house; no longer an heir.
 */
export type FamilyRole = "line" | "spouse" | "left";

export interface Person {
  id: number;
  house_id: number;
  name: string;
  gender: "m" | "f";
  role: FamilyRole;
  /** Husband or wife (a person id), living or dead; null if never married. */
  spouse: number | null;
  /** Mother and father (person ids), if they are in the family records. */
  parents: number[];
  /** Where a spouse came from: another house's id, "merchant" for a family outside the bourse, or null. Also the house an heir married into. */
  origin: string | null;
  /** Maiden name or family name before marriage, for the records. Null if unchanged. */
  born: string | null;
  birth_year: number;
  death_year: number | null;
  is_head: boolean;
  /** Venture success. */
  acumen: number;
  /** Spotting bad borrowers. */
  prudence: number;
  /** Access to state bonds. */
  connections: number;
  /** Trait ids, from data/traits.json. */
  traits: string[];
  /** An untrained head's stats count lower until this turn. Null when not inexperienced. */
  inexperienced_until: number | null;
}

export interface YearEnd {
  year: number;
  net_worth: number;
  reputation: number;
}

/** A change of head of house, for the news and the family chronicle. */
export interface Succession {
  turn: number;
  /** The head who died. */
  from: number;
  to: number;
  trained: boolean;
  /** The new head was the heir the old one had named. */
  named: boolean;
  /** The eldest living heir, if the new head was not them; null when the eldest took over. */
  passed_over: number | null;
}

/** A merchant house that borrows from the player. Quality is hidden: the player reads its books (milestone A1). */
export interface Borrower {
  id: number;
  name: string;
  trade: string;
  /** True soundness, 0 (worst) to 1 (best). Never shown to the player; defaults come from it. */
  quality: number;
  /** What the market believes. Sets the highest rate the borrower will pay and what other houses pay for its loans; falls after a default. */
  market_quality: number;
  /** The borrower's real books, changing each quarter. Never shown whole: the player sees them through a BookFile. */
  books: Books;
  /** The latest report or inquiry the house bought, or null. */
  file: BookFile | null;
  repaid: number;
  defaulted: number;
  last_default_turn: number | null;
  /** Asks for no loan before this turn (after a default, or after the house called a loan in). */
  away_until: number | null;
}

/** Bills of exchange (a quarter or two), commercial credit (one to three years), mortgages and long credit (five to ten years). */
export type LoanKind = "bill" | "commercial" | "mortgage";

/** A borrower asking the house for a loan this quarter. */
export interface LoanRequest {
  borrower_id: number;
  kind: LoanKind;
  term_quarters: number;
  /** Most the borrower will take, in whole gulden. */
  amount: number;
  /** Highest annual rate the borrower will pay. */
  max_rate: number;
  /** What the bourse says of the borrower this quarter (free, sometimes wrong). */
  talk: Band;
}

export interface Loan {
  id: number;
  borrower_id: number;
  borrower_name: string;
  kind: LoanKind;
  /** Principal still owed. Mortgages repay part of it each quarter. */
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
export type LedgerAccount = "cash" | "loans" | "bonds" | "ventures" | "deposits" | "borrowings" | MarketsAccount | FinanceAccount | EuropeAccount;

/** Ledger categories: the core ones, then each system's own. */
export type LedgerCategory = CoreCategory | CreditCategory | CountingCategory | MarketsCategory | FinanceCategory | PeopleCategory | EuropeCategory | ProgressCategory;

export type CoreCategory = "deposit_inflow" | "deposit_interest" | "event" | "courting" | "dowry" | "report" | "family" | "borrowing" | "debt_interest" | "debt_repayment" | "loan_called" | "opening" | "loan_out" | "interest" | "default" | "repayment"
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

/**
 * "active": building or running, not listed, counted at cost. "listed": floated on the bourse; the
 * stake is now shares (state.markets), though calls may still come in. "paid_out": a short venture
 * that paid its return. "forfeited" is not a status: a forfeited stake stays active, smaller, with
 * no more calls.
 */
export type VentureStatus = "active" | "paid_out" | "failed" | "sold" | "listed";

/** Building pays calls and risks failure; running earns (great works earn from their first open section). */
export type VenturePhase = "building" | "running";

/** Capital backing one venture. Field names follow the spec's venture table, plus timing and the build (A3). */
export interface Venture {
  id: number;
  /** Id from data/ventures.json. */
  type: string;
  /** Whole gulden of the house's paid-in stake still held (reduced by a sale or a forfeit). */
  invested: number;
  expected_return: number;
  failure_risk: number;
  unlock_year: number;
  start_turn: number;
  /** Quarters of the build, overruns included. */
  term_quarters: number;
  status: VentureStatus;
  phase: VenturePhase;
  /** Whole gulden the house promised, overruns included. */
  committed: number;
  /** Whole gulden paid in so far, before any sale or forfeit. */
  called: number;
  /** Calls planned (overruns add more) and calls paid. */
  calls: number;
  calls_paid: number;
  /** True once a call went unpaid: no further calls. */
  calls_stopped: boolean;
  /** Sections of a great work open and earning (out of the type's sections). */
  sections_open: number;
  /** The last four quarters' earnings on the house's stake, oldest first. */
  earnings: number[];
  /** Turn it began running, or null while building with nothing open. */
  run_start_turn: number | null;
  /** The company it floated as, once listed. */
  company: string | null;
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
  | "letter"
  | "reputation"
  | "warning"
  | "crisis"
  | "family"
  | "houses"
  | "markets"
  | "europe";

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

/** Another Frankfurt house. Its books are not modelled: only its wealth, reputation and opinion of the player. */
export interface OtherHouse {
  id: string;
  name: string;
  surname: string;
  temperament: "cautious" | "bold";
  head: { name: string; birth_year: number };
  /** Who takes over when the head dies. */
  heir: { name: string; birth_year: number };
  wealth: number;
  start_wealth: number;
  /** 0 to 100. */
  reputation: number;
  /** Opinion of the player's house, -100 to 100. */
  opinion: number;
  /** Where opinion drifts back to. */
  baseline: number;
  /** The turn it closed its doors, or null while it trades. */
  failed_turn: number | null;
}

/** A marriage arranged by the player: who married whom, and how. */
export interface Marriage {
  turn: number;
  /** The member of the line who married. */
  member: number;
  /** The spouse who joined the house, or null when the member married out. */
  spouse: number | null;
  /** The other house's id, or "merchant". */
  house: string;
  form: "in" | "out" | "merchant";
  /** Dowry received (positive) or paid (negative). */
  dowry: number;
}

/** A letter on the desk: an event's question, answered during the quarter after it fired. */
export interface Letter {
  /** The event that sent it. At most one letter per event is open at a time. */
  event: string;
  /** The turn at whose end it arrived. */
  turn: number;
  /** The chosen response's id, or null while unanswered. Its certain effects have already applied. */
  answer: string | null;
}

/** A letter settled at End Turn, for the news and the chronicle. */
export interface LetterOutcome {
  /** The turn whose end settled it. */
  turn: number;
  event: string;
  option: string;
  /** No answer was given, so the event's default response was taken. */
  by_default: boolean;
  /** Whether the response's chance came up; null if it had none. */
  chance: boolean | null;
}

/** An event scheduled by a follow_up effect, to fire at the end of `turn`. */
export interface ScheduledEvent {
  id: string;
  turn: number;
}

/** "slow" pays a share of what depositors ask this quarter; "suspended" pays nothing. */
export type WithdrawalPolicy = "normal" | "slow" | "suspended";

export type DebtStatus = "active" | "repaid";

/** Money borrowed by the house. Interest is paid each quarter; the principal falls due at the end of the term. */
export interface Debt {
  id: number;
  /** The lender's name. */
  lender: string;
  /** The lending house's id. */
  house: string;
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
  /** The family, living and dead, in order of joining the house (the founding head first). */
  people: Person[];
  successions: Succession[];
  /** The books at the end of each year, for the chronicle (and later the year-end report). */
  year_ends: YearEnd[];
  /** This quarter's loan requests, drawn at the end of the previous turn. */
  requests: LoanRequest[];
  ledger: LedgerEntry[];
  next_ledger_id: number;
  /** Every quarter's news, oldest first. */
  news: NewsItem[];
  /** Events that have fired, in order. The spec's event.fired_turn. */
  fired_events: FiredEvent[];
  /** Each system's own state (src/sim/systems/). */
  credit: CreditState;
  counting: CountingState;
  markets: MarketsState;
  finance: FinanceState;
  /** B2: personalities, loyalty and feuds (the family itself is `people`). */
  agendas: PeopleState;
  europe: EuropeState;
  progress: ProgressState;
  /** Marriages arranged, oldest first. A house with any marriage tie is an ally. */
  marriages: Marriage[];
  /** The other Frankfurt houses, failed ones included. */
  houses: OtherHouse[];
  /** Letters awaiting an answer this quarter. */
  letters: Letter[];
  /** Every letter settled, oldest first. */
  letter_outcomes: LetterOutcome[];
  /** Follow-up events waiting for their quarter. */
  scheduled_events: ScheduledEvent[];
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

/** Buy a correspondent's report on a borrower who is asking for a loan or owes the house: turnover, profit, debts and payment record. */
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
  /** Id of the house that lends. */
  house: string;
  /** Whole gulden. */
  amount: number;
}

/**
 * Arrange a marriage for a member of the line (head or heir) with no living spouse. `with` is a
 * house id or "merchant". "in": the spouse joins this house; "out": the heir joins the other house.
 * One action.
 */
export interface ArrangeMarriageDecision {
  kind: "arrange_marriage";
  member: number;
  with: string;
  form: "in" | "out";
}

/** Court another house: dinners, gifts, a box at the opera. One action. */
export interface CourtHouseDecision {
  kind: "court_house";
  house: string;
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

/** Invest in the family: educate one heir in one stat, give to charity, or act as a patron. */
/** Name the heir who will take over when the head dies. */
export interface DesignateHeirDecision {
  kind: "designate_heir";
  heir: number;
}

/** Answer a letter on the desk. Uses none of the quarter's actions. */
export interface AnswerLetterDecision {
  kind: "answer_letter";
  event: string;
  option: string;
}

export type InvestFamilyDecision =
  | { kind: "invest_family"; form: "educate"; heir: number; stat: "acumen" | "prudence" | "connections" }
  | { kind: "invest_family"; form: "charity" }
  | { kind: "invest_family"; form: "patronage" };

export type CrisisDecision = BorrowDecision | PaySlowlyDecision | SuspendDecision | CallLoanDecision;

/** Decisions handled in src/sim/decisions.ts itself. */
export type CoreDecision = LendDecision | ReportDecision | SetReserveDecision | BuyBondDecision | InvestVentureDecision | InvestFamilyDecision | DesignateHeirDecision | AnswerLetterDecision | CourtHouseDecision | ArrangeMarriageDecision | CrisisDecision;

/** Every decision: the core ones, then each system's own (src/sim/systems/). */
export type Decision = CoreDecision | CreditDecision | CountingDecision | MarketsDecision | FinanceDecision | PeopleDecision | EuropeDecision | ProgressDecision;
