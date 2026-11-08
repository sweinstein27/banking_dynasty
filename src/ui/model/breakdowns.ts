// Where each number on the top bar comes from. Pure functions of the game state, built only from
// the ledger and the sim's own functions, so a breakdown can never disagree with the books.
// No React and no DOM here: tests/ui-breakdowns.test.ts checks every sum against the sim.
import { bondBook, bondValue, reputationGate } from "../../sim/bonds";
import { upkeepBill, wageBill } from "../../sim/systems/counting";
import { dateOfTurn } from "../../sim/chronicle";
import { debtBook, debtInterest } from "../../sim/crisis";
import { depositInflow, depositInterest, depositLevel } from "../../sim/deposits";
import { fl } from "../../sim/format";
import { bondOffers } from "../../sim/offers";
import { freeCash } from "../../sim/reserves";
import { withdrawalDemand } from "../../sim/sentiment";
import { marketsBook } from "../../sim/systems/markets";
import { europeBook } from "../../sim/systems/europe";
import { financeBook } from "../../sim/systems/finance";
import { legacyBook } from "../../sim/systems/legacy";
import { politicsBook } from "../../sim/systems/politics";
import { rivalsBook } from "../../sim/systems/rivals";
import { warBook } from "../../sim/systems/war";
import type { GameData } from "../../sim/tuning";
import { loanBook, netWorth } from "../../sim/turn";
import type { GameState, LedgerAccount, LedgerEntry, Quarter, Sentiment } from "../../sim/types";
import { ventureBook } from "../../sim/ventures";

export type BreakdownId = "cash" | "worth" | "reputation" | "deposits" | "upkeep" | "market" | "date";

/** One line of a breakdown. `amount` is set on lines that take part in a sum. */
export interface Line {
  label: string;
  /** What the line shows on the right: an amount in fl., or words. */
  value: string;
  amount?: number;
  /** A glossary card the label links to. */
  term?: string;
  tone?: "good" | "bad" | "warn";
}

export interface Section {
  heading: string;
  lines: Line[];
  /** When present, the lines' amounts add up to this line's amount. */
  total?: Line;
}

export interface Breakdown {
  id: BreakdownId;
  title: string;
  /** One sentence on what the number is. */
  summary: string;
  /** The glossary card that explains the number in full. */
  term?: string;
  sections: Section[];
}

/** Ledger categories in words. System categories not listed here fall back to their id. */
const CATEGORY: Record<string, string> = {
  opening: "Opening books",
  deposit_inflow: "New deposits",
  deposit_interest: "Interest credited to depositors",
  withdrawal: "Withdrawals",
  loan_out: "Loans made",
  interest: "Interest from borrowers",
  repayment: "Loans repaid",
  default: "Loans defaulted",
  loan_called: "Loans called in",
  report: "Reports on borrowers",
  bond_purchase: "Bonds bought",
  coupon: "Bond coupons",
  revaluation: "Bonds marked to market",
  bond_default: "Bonds defaulted",
  venture_in: "Ventures backed",
  venture_payout: "Venture payouts",
  venture_failure: "Ventures failed",
  forced_sale: "Forced sales",
  borrowing: "Borrowed from houses",
  debt_interest: "Interest on borrowings",
  debt_repayment: "Borrowings repaid",
  family: "Family (tutors, charity, patronage)",
  courting: "Courting houses",
  dowry: "Dowries",
  event: "Events and letters",
};

export const categoryLabel = (c: string) => CATEGORY[c] ?? c.replace(/_/g, " ");

const MOOD_WORD: Record<Sentiment, string> = { calm: "Fair", uneasy: "Changeable", panic: "Stormy" };
export const moodWord = (s: Sentiment) => MOOD_WORD[s];

const SEASONS = ["Winter", "Spring", "Summer", "Autumn"];
const season = (d: { year: number; quarter: Quarter }) => `${SEASONS[d.quarter - 1]} ${d.year}`;
const signed = (n: number) => (n > 0 ? `+${fl(n)}` : fl(n));

/** Liabilities count against net worth; every other account counts for it. */
const LIABILITIES: LedgerAccount[] = ["deposits", "borrowings"];
export const worthSign = (a: LedgerAccount) => (LIABILITIES.includes(a) ? -1 : 1);

/** The quarter just played: base's turn minus one. Zero before the first quarter ends. */
export const lastTurn = (base: GameState) => base.world.turn - 1;

/** Entries written while the last quarter resolved (and the decisions taken in it). Before the first quarter ends: the opening books. */
export function lastQuarterEntries(base: GameState): LedgerEntry[] {
  const t = lastTurn(base);
  return t === 0 ? base.ledger.filter((e) => e.category === "opening") : base.ledger.filter((e) => e.turn === t && e.category !== "opening");
}

/** Entries from decisions queued this quarter: in the preview, not yet in the base. */
export function queuedEntries(base: GameState, preview: GameState): LedgerEntry[] {
  return preview.ledger.filter((e) => e.id >= base.next_ledger_id);
}

/** Sums entries by category, in the order categories first appear, dropping those that net to nothing. */
function byCategory(entries: LedgerEntry[], weight: (e: LedgerEntry) => number = () => 1): Line[] {
  const sums = new Map<string, number>();
  for (const e of entries) sums.set(e.category, (sums.get(e.category) ?? 0) + e.amount * weight(e));
  return [...sums].filter(([, n]) => n !== 0).map(([c, n]) => ({ label: categoryLabel(c), value: signed(n), amount: n, tone: n < 0 ? "bad" : "good" }));
}

/** Net worth when the last quarter began, rebuilt from that quarter's entries. */
export function worthBefore(base: GameState): number {
  if (lastTurn(base) === 0) return 0;
  return netWorth(base) - lastQuarterEntries(base).reduce((s, e) => s + worthSign(e.account) * e.amount, 0);
}

/** An account's balance before the entries given, and its flows, as a section that adds up. */
function flowSection(heading: string, startLabel: string, endLabel: string, end: number, entries: LedgerEntry[]): Section {
  const lines = byCategory(entries);
  const start = end - lines.reduce((s, l) => s + l.amount!, 0);
  return {
    heading,
    lines: [{ label: startLabel, value: fl(start), amount: start }, ...lines],
    total: { label: endLabel, value: fl(end), amount: end },
  };
}

function lastQuarterName(base: GameState, data: GameData): string {
  const t = lastTurn(base);
  return t === 0 ? "The opening books" : `Last quarter, ${season(dateOfTurn(t, data.tuning))}`;
}

/** Upkeep a quarter: what the house's obligations, staff and rooms cost it each quarter at today's balances. */
export function upkeepLines(state: GameState, data: GameData): Line[] {
  const lines: Line[] = [
    { label: "Interest owed to depositors", value: fl(depositInterest(state.house.deposits, data.tuning)), amount: depositInterest(state.house.deposits, data.tuning), term: "deposit_interest" },
  ];
  for (const d of state.debts.filter((x) => x.status === "active")) {
    const n = debtInterest(d);
    lines.push({ label: `Interest to ${d.lender}`, value: fl(n), amount: n, term: "borrowings" });
  }
  const wages = wageBill(state, data);
  if (wages > 0) lines.push({ label: "Wages for the staff", value: fl(wages), amount: wages, term: "counting_house" });
  const rooms = upkeepBill(state, data);
  if (rooms > 0) lines.push({ label: "Upkeep of the rooms", value: fl(rooms), amount: rooms, term: "counting_house" });
  return lines;
}

export const upkeepTotal = (state: GameState, data: GameData) => upkeepLines(state, data).reduce((s, l) => s + l.amount!, 0);

export const quartersInRun = (data: GameData) => {
  const { start, end } = data.tuning;
  return (end.year - start.year) * 4 + (end.quarter - start.quarter) + 1;
};

/** The breakdown behind one readout. `base` is the state at the start of the quarter; `preview` has the queued decisions applied. */
export function breakdown(id: BreakdownId, base: GameState, preview: GameState, data: GameData): Breakdown {
  const { tuning } = data;
  const last = lastQuarterEntries(base);
  const queued = queuedEntries(base, preview);
  const queuedSection = (account: LedgerAccount, startLabel: string, end: number): Section[] => {
    const own = queued.filter((e) => e.account === account);
    return own.length ? [flowSection("This quarter's orders so far", startLabel, "Now", end, own)] : [];
  };

  switch (id) {
    case "cash": {
      const lastCash = last.filter((e) => e.account === "cash");
      return {
        id, title: "Cash", term: "cash",
        summary: "Gulden in the strongroom. Loans, bonds and ventures are paid from it, and so are depositors who withdraw.",
        sections: [
          flowSection(lastQuarterName(base, data), "At the start", "At the end", base.house.cash, lastCash),
          ...queuedSection("cash", "At the start of this quarter", preview.house.cash),
          {
            heading: "What can be spent",
            lines: [
              { label: "Reserve kept back", value: fl(preview.house.reserve), term: "reserve" },
              { label: "Free cash above the reserve", value: fl(freeCash(preview)), term: "free_cash" },
            ],
          },
        ],
      };
    }

    case "worth": {
      const now = netWorth(preview);
      const parts: Line[] = [
        { label: "Cash", value: fl(preview.house.cash), amount: preview.house.cash, term: "cash" },
        { label: "Loans to merchants", value: fl(loanBook(preview)), amount: loanBook(preview), term: "loans" },
        { label: "State bonds, at today's price", value: fl(bondBook(preview)), amount: bondBook(preview), term: "bonds" },
        { label: "Ventures, at cost", value: fl(ventureBook(preview)), amount: ventureBook(preview), term: "ventures" },
      ];
      const market = marketsBook(preview);
      if (market !== 0) parts.push({ label: "Market holdings", value: fl(market), amount: market });
      // Wave 2 and 3 books: shown when they hold anything, so the lines always add up to net worth.
      const books: [string, number, string?][] = [
        ["High finance: credit to houses, assets, caution money", financeBook(preview), "high_finance"],
        ["Branches and bills abroad", europeBook(preview), "branch"],
        ["Rivals", rivalsBook(preview)],
        ["Politics", politicsBook(preview)],
        ["War", warBook(preview)],
        ["Legacy", legacyBook(preview)],
      ];
      for (const [label, n, term] of books) if (n !== 0) parts.push(term ? { label, value: fl(n), amount: n, term } : { label, value: fl(n), amount: n });
      parts.push(
        { label: "Less deposits owed", value: fl(-preview.house.deposits || 0), amount: -preview.house.deposits || 0, term: "deposits" },
        { label: "Less borrowings", value: fl(-debtBook(preview) || 0), amount: -debtBook(preview) || 0, term: "borrowings" },
      );
      const sections: Section[] = [{ heading: "What the house owns, less what it owes", lines: parts, total: { label: "Net worth", value: fl(now), amount: now } }];
      if (lastTurn(base) > 0) {
        const before = worthBefore(base);
        sections.push({
          heading: `${lastQuarterName(base, data)}: what changed it`,
          lines: [{ label: "At the start", value: fl(before), amount: before }, ...byCategory(last, (e) => worthSign(e.account))],
          total: { label: "At the end", value: fl(netWorth(base)), amount: netWorth(base) },
        });
      }
      const q = byCategory(queued, (e) => worthSign(e.account));
      if (q.length) {
        sections.push({
          heading: "This quarter's orders so far",
          lines: [{ label: "At the start of this quarter", value: fl(netWorth(base)), amount: netWorth(base) }, ...q],
          total: { label: "Now", value: fl(now), amount: now },
        });
      }
      const years = preview.year_ends.slice(-4);
      if (years.length) sections.push({ heading: "At recent year ends", lines: years.map((y) => ({ label: `End of ${y.year}`, value: fl(y.net_worth) })) });
      return { id, title: "Net worth", term: "net_worth", summary: "The score: everything the house owns less everything it owes. The arrow compares the end of last quarter with its start.", sections };
    }

    case "reputation": {
      const rep = preview.house.reputation;
      const offers = bondOffers(preview, data);
      const sections: Section[] = [
        {
          heading: "What it does now",
          lines: [
            { label: "Deposits it draws in calm years", value: fl(depositLevel(rep, tuning)), term: "deposits" },
            {
              label: `Withdrawals asked at today's mood (${MOOD_WORD[preview.world.sentiment].toLowerCase()})`,
              value: fl(withdrawalDemand(preview.house.deposits, preview.world.sentiment, tuning, rep)),
              term: "withdrawals",
            },
          ],
        },
        {
          heading: "States that will sell you bonds",
          lines: data.states.map((s) => {
            const o = offers.find((x) => x.id === s.id);
            const gate = reputationGate(preview, s, data);
            return { label: s.name, value: o?.blocked ? `No: ${o.blocked}` : `Yes, from ${gate}`, tone: o?.blocked ? "bad" : "good", term: "bond_gate" };
          }),
        },
      ];
      const changes: Line[] = [];
      if (rep !== base.house.reputation) changes.push({ label: "This quarter's orders so far", value: `${rep - base.house.reputation > 0 ? "+" : ""}${rep - base.house.reputation}` });
      for (const y of preview.year_ends.slice(-4).reverse()) changes.push({ label: `End of ${y.year}`, value: String(y.reputation) });
      if (changes.length) sections.push({ heading: "Its history", lines: changes });
      return { id, title: `Reputation: ${rep} of 100`, term: "reputation", summary: "The house's good name on the bourse, from 0 to 100.", sections };
    }

    case "deposits": {
      const d = preview.house.deposits;
      const policy = preview.withdrawal_policy;
      const asked = withdrawalDemand(d, preview.world.sentiment, tuning, preview.house.reputation);
      return {
        id, title: "Deposits", term: "deposits",
        summary: "Money depositors keep with the house. The house owes it back on demand, and pays interest on it.",
        sections: [
          flowSection(lastQuarterName(base, data), "Owed at the start", "Owed at the end", base.house.deposits, last.filter((e) => e.account === "deposits")),
          ...queuedSection("deposits", "Owed at the start of this quarter", d),
          {
            heading: "When this quarter ends",
            lines: [
              {
                label: "Depositors will ask for",
                value: fl(asked) + (policy === "slow" ? ", paid only in part" : policy === "suspended" ? ", paid nothing (suspended)" : ""),
                term: "withdrawals",
                tone: asked > 0 ? "warn" : undefined,
              },
              { label: "Interest credited to them", value: fl(depositInterest(d, tuning)), term: "deposit_interest" },
              { label: "New deposits, if the market is fair", value: fl(depositInflow(preview, tuning)), term: "deposits" },
              { label: "The level your reputation draws", value: fl(depositLevel(preview.house.reputation, tuning)), term: "reputation" },
            ],
          },
        ],
      };
    }

    case "upkeep": {
      const total = upkeepTotal(preview, data);
      return {
        id, title: "Upkeep a quarter", term: "upkeep",
        summary: "What the house's obligations cost each quarter at today's balances. Interest to depositors is added to what you owe them rather than paid in cash.",
        sections: [
          { heading: "Each quarter", lines: upkeepLines(preview, data), total: { label: "Upkeep a quarter", value: fl(total), amount: total } },
          { heading: "Still to come", lines: [{ label: "Staff wages and the upkeep of rooms", value: "with the counting house", term: "counting_house" }] },
        ],
      };
    }

    case "market": {
      const s = preview.world.sentiment;
      const lines: Line[] = [
        { label: "The mood", value: MOOD_WORD[s], tone: s === "calm" ? "good" : s === "uneasy" ? "warn" : "bad", term: "market_mood" },
      ];
      if (preview.panic_warning) {
        const n = preview.panic_warning.turns_left;
        lines.push({ label: "Panic warning", value: n === 1 ? "panic next quarter" : `panic in ${n} quarters`, tone: "bad", term: "panic" });
      }
      lines.push(
        { label: "Base interest rate", value: `${(preview.world.base_rate * 100).toFixed(1)}% a year`, term: "base_rate" },
        { label: "Chance of loan defaults", value: s === "calm" ? "the base chance" : `${tuning.sentiment_multiplier[s]} times the base chance`, term: "default" },
        { label: "Depositors withdraw", value: `${(tuning.sentiment.withdrawal_share[s] * 100).toFixed(0)}% a quarter, before reputation`, term: "withdrawals" },
      );
      const prices = bondOffers(preview, data).filter((o) => !preview.defaulted_states.includes(o.id));
      return {
        id, title: `The market: ${MOOD_WORD[s]}`, term: "market_mood",
        summary: "The bourse's mood. It scales every risk in the game: defaults, withdrawals and the price of bonds.",
        sections: [
          { heading: "Today", lines },
          { heading: "State bond prices at this mood", lines: prices.map((o) => ({ label: o.name, value: `${o.price} per fl. of face`, term: "bonds" })) },
          ...(preview.bonds.some((b) => b.status === "active")
            ? [{ heading: "Your bonds at today's price", lines: [{ label: "Book value", value: fl(preview.bonds.filter((b) => b.status === "active").reduce((n, b) => n + bondValue(b), 0)) }] }]
            : []),
        ],
      };
    }

    case "date": {
      const total = quartersInRun(data);
      const left = Math.max(0, total - preview.world.turn + 1);
      const toYearEnd = 4 - preview.world.quarter;
      return {
        id, title: season(preview.world), term: "quarter",
        summary: "Each turn is one quarter of a year. The run ends after the last quarter of 1850.",
        sections: [{
          heading: "The calendar",
          lines: [
            { label: "This quarter", value: `${preview.world.turn} of ${total}` },
            { label: "Year end", value: toYearEnd === 0 ? "when this quarter ends" : `after ${toYearEnd} more quarter${toYearEnd === 1 ? "" : "s"}`, term: "year_end" },
            { label: "Quarters left, this one included", value: String(left) },
          ],
        }],
      };
    }
  }
}
