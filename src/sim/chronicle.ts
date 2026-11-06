// The family chronicle: an end-of-run story told from the ledger and the family records.
// Built only from what the game recorded, so it never invents a fact the run did not produce.
import { runOver } from "./actions";
import { ageIn } from "./family";
import { fl } from "./format";
import type { GameData, Tuning } from "./tuning";
import { netWorth } from "./turn";
import { traitWords } from "./traits";
import type { GameState, LedgerEntry, Person, Quarter } from "./types";

/** The calendar date of a turn: turn 1 is the start quarter. */
export function dateOfTurn(turn: number, tuning: Tuning): { year: number; quarter: Quarter } {
  const index = tuning.start.year * 4 + (tuning.start.quarter - 1) + (turn - 1);
  return { year: Math.floor(index / 4), quarter: ((index % 4) + 1) as Quarter };
}

const yearOf = (turn: number, tuning: Tuning) => dateOfTurn(turn, tuning).year;

/** "Weber's", but "Brenner Brothers'". */
const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** Ends a sentence: amounts already end in "fl.", so they take no second full stop. */
const sentence = (text: string) => (text.endsWith(".") ? text : `${text}.`);

/** Joins names as "a", "a and b", or "a, b and c". */
function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The entry with the most negative amount, if any. */
function worst(entries: LedgerEntry[]): LedgerEntry | undefined {
  return entries.reduce<LedgerEntry | undefined>((w, e) => (!w || e.amount < w.amount ? e : w), undefined);
}

/**
 * The chronicle of a run, as paragraphs: the founding, the heads of house, the history lived
 * through, the worst blows and best strokes, net worth at each decade, and how it ended.
 */
export function chronicle(state: GameState, data: GameData): string[] {
  const t = data.tuning;
  const { house, people, ledger } = state;
  const paragraphs: string[] = [];
  // ", prudent and aloof" after a name, or nothing for someone without traits.
  const described = (p: Person) => (p.traits.length ? `, ${traitWords(p, data)}` : "");

  // The founding.
  const founder = people[0]!;
  const opening = (account: string) => ledger.find((e) => e.category === "opening" && e.account === account)?.amount ?? 0;
  paragraphs.push(
    `In ${t.start.year}, ${founder.name}${described(founder)}, aged ${ageIn(founder, t.start.year)}, opened the books of ${house.name} in ${house.city} with ${fl(opening("cash"))} in cash and ${fl(opening("deposits"))} owed to depositors.`,
  );

  // The heads of house.
  if (state.successions.length) {
    const lines = state.successions.map((sc) => {
      const year = yearOf(sc.turn, t);
      const dead = people.find((p) => p.id === sc.from)!;
      const heir = people.find((p) => p.id === sc.to)!;
      return `In ${year} ${dead.name} died, aged ${ageIn(dead, year)}, and ${heir.name}${described(heir)}${heir.traits.length ? "," : ""} took over at ${ageIn(heir, year)}${sc.trained ? "" : ", untrained and unready"}.`;
    });
    paragraphs.push(lines.join(" "));
  } else {
    paragraphs.push(`${founder.name} led the house to the end.`);
  }

  // The history it lived through.
  const lived = state.fired_events
    .map((f) => data.events.find((e) => e.id === f.id))
    .filter((e) => e?.historical)
    .map((e) => `${e!.title} (${e!.year})`);
  // Headlines are kept as written: they are not noun phrases, and they carry proper names.
  if (lived.length) paragraphs.push(`The house lived through the news of ${lived.length === 1 ? "one great event" : "these years"}: ${lived.join("; ")}.`);

  // Blows and strokes of fortune.
  const blows: string[] = [];
  const bad = worst(ledger.filter((e) => e.account === "loans" && e.category === "default"));
  if (bad) {
    const loan = state.loans.find((l) => bad.note.startsWith(`Loan #${l.id}:`));
    blows.push(sentence(`The worst default was ${loan ? possessive(loan.borrower_name) : "a borrower's"}, in ${yearOf(bad.turn, t)}, which cost ${fl(-bad.amount)}`));
  }
  const run = worst(ledger.filter((e) => e.account === "deposits" && e.category === "withdrawal"));
  if (run && run.amount < 0) blows.push(`The heaviest withdrawals came in ${yearOf(run.turn, t)}, when depositors took ${fl(-run.amount)} in a single quarter.`);
  const sold = ledger.filter((e) => e.account === "cash" && e.category === "forced_sale");
  if (sold.length) blows.push(`Assets were sold at a discount in ${sold.length} sale${sold.length === 1 ? "" : "s"} to stay afloat.`);
  const suspended = state.news.filter((n) => n.kind === "crisis" && n.text.startsWith("You suspended")).length;
  if (suspended) blows.push(`The house suspended withdrawals ${suspended === 1 ? "once" : `${suspended} times`}.`);
  const borrowed = ledger.filter((e) => e.account === "borrowings" && e.category === "borrowing");
  if (borrowed.length) blows.push(`It borrowed from ${t.crisis.rival.name} ${borrowed.length === 1 ? "once" : `${borrowed.length} times`}.`);
  const best = ledger
    .filter((e) => e.account === "cash" && e.category === "venture_payout")
    .reduce<LedgerEntry | undefined>((b, e) => (!b || e.amount > b.amount ? e : b), undefined);
  if (best) {
    const v = state.ventures.find((x) => best.note.startsWith(`Venture #${x.id}:`));
    const vname = data.ventures.find((x) => x.id === v?.type)?.name ?? "a venture";
    blows.push(`Its best stroke was the ${vname} venture, which paid out ${fl(best.amount)} in ${yearOf(best.turn, t)}.`);
  }
  if (blows.length) paragraphs.push(blows.join(" "));

  // Net worth at each decade.
  const decades = state.year_ends.filter((y) => y.year % 10 === 0 || y.year === t.start.year);
  if (decades.length) paragraphs.push(`Net worth at the close of ${list(decades.map((y) => `${y.year}: ${fl(y.net_worth)}`))}`);

  // The end.
  const over = runOver(state, t);
  const head = people.find((p) => p.is_head && p.death_year === null);
  const last = dateOfTurn(state.world.turn - 1, t);
  if (over === "bankrupt") {
    paragraphs.push(sentence(`In ${last.year} the house could not meet its obligations, even after selling its assets, and closed its doors, worth ${fl(netWorth(state))}`));
  } else {
    const who = head ? `, led by ${head.name}, aged ${ageIn(head, last.year)}` : "";
    paragraphs.push(sentence(`${over === "finished" ? `By the end of ${last.year}` : `At ${last.year} Q${last.quarter}`} the house was worth ${fl(netWorth(state))}${who}`));
  }
  return paragraphs;
}
