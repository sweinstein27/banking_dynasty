// What the Family panel's people pages show: loyalty with its sums, family letters with every
// answer's cost, effect and the sim's refusal, education paths per heir, and feuds. Built only from
// B2's exported functions (src/sim/systems/people.ts); tests/ui-wave3-screens.test.ts checks them.
import { dateOfTurn } from "../../sim/chronicle";
import { ageIn, heirsOf } from "../../sim/family";
import { fl } from "../../sim/format";
import { DEFAULT_OPTION, checkAnswerFamilyLetter, checkSendToStudy, familyOptions, hasLoyalty, letterWords, loyaltyOf, loyaltyWord, splitTerms, studyData, studyOf, type FamilyLetter, type Feud, type StudyData } from "../../sim/systems/people";
import { traitById } from "../../sim/traits";
import type { GameData } from "../../sim/tuning";
import type { GameState, Person } from "../../sim/types";
import type { Section } from "./breakdowns";
import { capacityNote } from "./capacity";

const pctOf = (r: number) => `${Math.round(r * 100)}%`;
const when = (turn: number, data: GameData) => {
  const d = dateOfTurn(turn, data.tuning);
  return `${d.year} Q${d.quarter}`;
};
const nameOf = (state: GameState, id: number) => state.people.find((p) => p.id === id)?.name ?? "someone";

// ---------------------------------------------------------------- loyalty

export interface LoyaltyView {
  value: number;
  word: string;
  tone: "good" | "bad" | "warn" | undefined;
  sections: Section[];
}

/** A person's loyalty in a word, with the card behind it. Null for anyone without a loyalty (the head, the dead, those married out). */
export function loyaltyView(state: GameState, p: Person, data: GameData): LoyaltyView | null {
  if (!hasLoyalty(state, p)) return null;
  const l = data.people.loyalty;
  const value = loyaltyOf(state, p, data);
  const word = loyaltyWord(state, p, data);
  const stored = state.agendas.loyalty[p.id] !== undefined;
  return {
    value,
    word,
    tone: word === "loyal" ? "good" : word === "disloyal" ? "bad" : word === "restless" ? "warn" : undefined,
    sections: [
      {
        heading: `${p.name}: ${value} of ${l.max}`,
        lines: [
          { label: stored ? "Where it stands now" : `Starting value for ${p.role === "spouse" ? "a spouse" : "an heir"}`, value: String(value) },
          { label: "Loyal at", value: `${l.loyal} or more` },
          { label: "Disloyal at", value: `${l.disloyal} or less` },
          { label: "Drifts each year toward", value: `${l.drift_to}, by ${l.drift_per_year}` },
        ],
      },
      {
        heading: "What moves it",
        lines: [
          { label: "A request granted", value: `+${l.grant}`, tone: "good" },
          { label: "A request refused", value: `-${l.refuse}`, tone: "bad" },
          { label: "Passed over when another heir is named", value: `-${l.passed_over_by_naming}`, tone: "bad" },
          { label: "After a claim is paid", value: `set to ${l.after_claim_paid}` },
        ],
      },
      {
        heading: "What it does",
        lines: [
          { label: "A loyal heir passed over accepts it", value: "no reputation lost" },
          { label: "A grown heir not loyal at a succession", value: "may lay a claim" },
          { label: "A disloyal or feuding member", value: "may ask to leave" },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------- family letters

export interface LetterOptionView {
  id: string;
  label: string;
  cost: number;
  /** What follows, certain and uncertain, in words. */
  effect: string;
  blocked: string | null;
  isDefault: boolean;
}

export interface FamilyLetterView {
  letter: FamilyLetter;
  from: string;
  title: string;
  text: string;
  arrived: string;
  options: LetterOptionView[];
  /** The answer given, in words, or null. */
  answered: string | null;
}

/** What an answer does: its certain effects now and any chance at End Turn. */
export function optionEffect(state: GameState, letter: FamilyLetter, option: string, data: GameData): string {
  const p = data.people;
  const l = p.loyalty;
  const who = nameOf(state, letter.person);
  switch (letter.kind) {
    case "request": {
      const a = data.people.agendas.find((x) => x.id === letter.agenda);
      if (option === "refuse") return `${who}'s loyalty -${l.refuse}.`;
      const what =
        a?.id === "venture" ? `${pctOf(a.chance ?? 0)} chance it pays ${fl(a.payout ?? 0)} at End Turn.`
        : a?.id === "charity" ? `Reputation up by about ${a.reputation ?? 0}, with the head's traits.`
        : a?.id === "match" ? "The marriage is arranged now; it takes the head's time."
        : a?.id === "desk" ? `${who} joins the counting house as a clerk next quarter, paid the usual wage.`
        : a?.id === "allowance" ? "Paid now." : "";
      return `${what} ${who}'s loyalty +${l.grant}.`.trim();
    }
    case "leaving": {
      const t = splitTerms(state, data);
      const leave = `${who} founds a house of their own, taking ${fl(t.capital)} of capital and ${fl(t.deposits)} of deposits; ${pctOf(p.split.feud_chance)} chance of a feud.`;
      if (option === "buy_off") return `${who} stays. Loyalty +${p.split.buy_off_loyalty}.`;
      if (option === "let_go") return leave;
      return `${pctOf(p.split.forbid_stay)} chance ${who} obeys (loyalty -${p.split.forbid_loyalty}); otherwise ${leave.charAt(0).toLowerCase()}${leave.slice(1)}`;
    }
    case "claim":
      if (option === "pay") return `${who}'s loyalty is set to ${l.after_claim_paid}.`;
      if (option === "law") return `${pctOf(p.claims.law_win)} chance the court finds for the house (reputation -${p.claims.law_reputation}, ${who}'s loyalty -${p.claims.law_loyalty}); otherwise the house pays half the claim.`;
      return `${who}'s loyalty -${l.refuse}, and a feud begins: reputation -${p.feuds.reputation_per_quarter} a quarter while the head lives, up to ${p.feuds.max_quarters} quarters.`;
    case "reconcile":
      if (option === "pay") return `The feud ends. ${who}'s loyalty +${l.grant}.`;
      return "The feud goes on.";
  }
}

export function familyLetterViews(state: GameState, data: GameData): FamilyLetterView[] {
  return state.agendas.letters.map((letter) => {
    const words = letterWords(state, letter, data);
    const opts = familyOptions(letter, data);
    return {
      letter,
      from: nameOf(state, letter.person),
      title: words.title,
      text: words.text,
      arrived: when(letter.turn, data),
      options: opts.map((o) => ({
        id: o.id,
        label: o.label,
        cost: o.cost,
        effect: optionEffect(state, letter, o.id, data),
        blocked: letter.answer === null ? checkAnswerFamilyLetter(state, { kind: "answer_family_letter", letter: letter.id, option: o.id }, data) : null,
        isDefault: DEFAULT_OPTION[letter.kind] === o.id,
      })),
      answered: letter.answer === null ? null : opts.find((o) => o.id === letter.answer)?.label ?? letter.answer,
    };
  });
}

export const unansweredFamilyLetters = (state: GameState) => state.agendas.letters.filter((l) => l.answer === null).length;

/** This quarter's and recent family doings, from the people log. */
export function familyLog(state: GameState) {
  return [...state.agendas.log].reverse();
}

// ---------------------------------------------------------------- education

export interface PathView {
  path: StudyData;
  /** "Prudence +2, Connections +1; 25% chance of Shrewd". */
  gains: string;
  blocked: string | null;
}

export interface HeirStudyView {
  heir: Person;
  age: number;
  /** Away: the path and the quarter they return. */
  away: { path: string; returns: string } | null;
  done: string[];
  paths: PathView[];
}

const STAT_WORD: Record<string, string> = { acumen: "Acumen", prudence: "Prudence", connections: "Connections" };

export function gainsWords(path: StudyData, data: GameData): string {
  const stats = Object.entries(path.gains).map(([k, v]) => `${STAT_WORD[k] ?? k} +${v}`);
  if (path.trait) stats.push(`${pctOf(path.trait_chance ?? 0)} chance of ${traitById(path.trait, data)?.name ?? path.trait}`);
  if (path.contact_opinion) stats.push(`a Frankfurt house +${path.contact_opinion} opinion`);
  if (path.loyalty) stats.push(`loyalty ${path.loyalty > 0 ? "+" : ""}${path.loyalty}`);
  return stats.join(", ");
}

export function studyViews(state: GameState, data: GameData): HeirStudyView[] {
  return heirsOf(state).map((heir) => {
    const s = studyOf(state, heir.id);
    return {
      heir,
      age: ageIn(heir, state.world.year),
      away: s ? { path: studyData(s.path, data)?.name ?? s.path, returns: when(s.until, data) } : null,
      done: (state.agendas.studied[heir.id] ?? []).map((id) => studyData(id, data)?.name ?? id),
      paths: data.people.studies.map((path) => ({
        path,
        gains: gainsWords(path, data),
        blocked: checkSendToStudy(state, { kind: "send_to_study", heir: heir.id, path: path.id }, data),
      })),
    };
  });
}

export const studyTime = (state: GameState, data: GameData) => capacityNote(state, "send_to_study", data);

// ---------------------------------------------------------------- feuds and houses founded

export interface FeudView {
  feud: Feud;
  claimant: string;
  head: string;
  since: string;
  quartersLeft: number;
  perQuarter: number;
}

export function feudViews(state: GameState, data: GameData): FeudView[] {
  const f = data.people.feuds;
  return state.agendas.feuds.map((feud) => ({
    feud,
    claimant: nameOf(state, feud.person),
    head: nameOf(state, feud.head),
    since: when(feud.since, data),
    quartersLeft: Math.max(0, feud.since + f.max_quarters - state.world.turn),
    perQuarter: f.reputation_per_quarter,
  }));
}

export function splitHouses(state: GameState): { person: string; house: string; opinion: number; failed: boolean }[] {
  return Object.entries(state.agendas.splits).map(([pid, hid]) => {
    const h = state.houses.find((x) => x.id === hid);
    return { person: nameOf(state, Number(pid)), house: h?.name ?? hid, opinion: h?.opinion ?? 0, failed: h ? h.failed_turn !== null : false };
  });
}
