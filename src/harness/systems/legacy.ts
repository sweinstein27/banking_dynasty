// What each harness strategy does with the legacy system (B3): which ambition it sets the house each
// era, and whether it petitions for titles.
//
// - Each strategy prefers the ambition kinds that suit its play, in order; if none is offered it
//   takes the first offered. Choosing is free, so it goes early.
// - cautious and cautious_no_family behave the same (T7 still measures education alone).
// - Every strategy but aggressive and idle petitions for the next title when it qualifies and the
//   fee is at most 10% of free cash, asking the first sovereign (Austria, Bavaria, Prussia) that
//   would hear it. Petitions take a clerk's time, so they go late, after the strategy's own wants.
// - idle does nothing.
import { freeCash } from "../../sim/reserves";
import { checkChooseAmbition, checkPetitionTitle, offeredAmbitions, titleDef, titleRank, type AmbitionKind } from "../../sim/systems/legacy";
import type { GameData } from "../../sim/tuning";
import type { Decision, GameState } from "../../sim/types";
import type { Maker, SystemMakers } from "../common";

/** Each strategy's ambition kinds, most wanted first. */
export const AMBITION_TASTE: Record<string, AmbitionKind[]> = {
  cautious: ["standing", "trained_heir", "alliance", "title"],
  cautious_no_family: ["standing", "trained_heir", "alliance", "title"],
  aggressive: ["net_worth", "first_house"],
  bond_heavy: ["title", "net_worth", "alliance", "state_loan"],
  venture_heavy: ["railway", "net_worth", "first_house"],
  investor: ["net_worth", "railway", "title"],
};

/** Strategies that petition for titles. */
const PETITIONERS: ReadonlySet<string> = new Set(["cautious", "cautious_no_family", "bond_heavy", "venture_heavy", "investor"]);

/** The ambition `name` would choose now, or null (none on offer, or the strategy chooses none). */
export function pickAmbition(name: string, state: GameState, data: GameData): string | null {
  const taste = AMBITION_TASTE[name];
  if (!taste) return null;
  const offered = offeredAmbitions(state, data);
  const best = [...offered].sort((a, b) => rank(taste, a.kind) - rank(taste, b.kind))[0];
  return best?.id ?? null;
}

const rank = (taste: AmbitionKind[], kind: AmbitionKind) => {
  const i = taste.indexOf(kind);
  return i < 0 ? taste.length : i;
};

/** Makers for strategy `name`: `early` ones go before its other wants, `late` ones after. */
export function legacyMakers(name: string, state: GameState, data: GameData): SystemMakers {
  const early: Maker[] = [];
  const late: Maker[] = [];
  if (!data.legacy.enabled) return { early, late };
  const pick = pickAmbition(name, state, data);
  if (pick) {
    early.push((s) => {
      const d: Decision = { kind: "choose_ambition", ambition: pick };
      return checkChooseAmbition(s, d, data) ? null : d;
    });
  }
  if (PETITIONERS.has(name)) {
    late.push((s) => {
      const rankWanted = titleRank(s) + 1;
      const t = titleDef(rankWanted, data);
      if (!t || t.fee > freeCash(s) * 0.1) return null;
      for (const g of data.legacy.grantors) {
        const d: Decision = { kind: "petition_title", rank: rankWanted, grantor: g.state };
        if (!checkPetitionTitle(s, d, data)) return d;
      }
      return null;
    });
  }
  return { early, late };
}
