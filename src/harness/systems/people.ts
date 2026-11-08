// What each harness strategy does with the people system (B2): how it answers family letters,
// and whether it sends heirs to study.
//
// - cautious and cautious_no_family answer family letters the same way (so T7 still measures
//   education alone): they grant requests other than ventures that cost at most 10% of free cash,
//   buy off a member who means to leave, and pay claims and a feud's terms when they cost at most
//   25% of free cash. Only cautious sends its successor to the counting house at 14 (free).
// - aggressive grants ventures and leaves everything else to the defaults (refuse, forbid).
// - bond_heavy, venture_heavy and investor refuse requests but buy off leavers and pay claims.
// - idle leaves every letter to its default.
import { successor } from "../../sim/family";
import { freeCash } from "../../sim/reserves";
import { checkAnswerFamilyLetter, checkSendToStudy, familyOptions, studyOf, type FamilyLetter } from "../../sim/systems/people";
import type { GameData } from "../../sim/tuning";
import type { Decision, GameState } from "../../sim/types";
import type { Maker, SystemMakers } from "../common";

type Style = "generous" | "firm" | "steady" | "silent";

const STYLES: Record<string, Style> = {
  cautious: "generous",
  cautious_no_family: "generous",
  aggressive: "firm",
  bond_heavy: "steady",
  venture_heavy: "steady",
  investor: "steady",
  idle: "silent",
};

/** The response a style gives a letter, or null to leave it to the default. */
function choose(style: Style, letter: FamilyLetter, s: GameState, data: GameData): string | null {
  const cost = (id: string) => familyOptions(letter, data).find((o) => o.id === id)?.cost ?? 0;
  const free = freeCash(s);
  switch (style) {
    case "silent":
      return null;
    case "firm":
      return letter.kind === "request" && letter.agenda === "venture" ? "grant" : null;
    case "steady":
    case "generous": {
      if (letter.kind === "request") return style === "generous" && letter.agenda !== "venture" && cost("grant") <= free * 0.1 ? "grant" : null;
      if (letter.kind === "leaving") return "buy_off";
      return cost("pay") <= free * 0.25 ? "pay" : null;
    }
  }
}

/** Makers for strategy `name`: `early` ones go before its other wants, `late` ones after. */
export function peopleMakers(name: string, state: GameState, data: GameData): SystemMakers {
  const style = STYLES[name] ?? "silent";
  const early: Maker[] = state.agendas.letters.map((letter) => (s: GameState): Decision | null => {
    const option = choose(style, letter, s, data);
    if (!option) return null;
    const d: Decision = { kind: "answer_family_letter", letter: letter.id, option };
    return checkAnswerFamilyLetter(s, d, data) ? null : d;
  });
  const late: Maker[] = [];
  if (name === "cautious") {
    late.push((s) => {
      const heir = successor(s, data);
      if (!heir || studyOf(s, heir.id)) return null;
      const d: Decision = { kind: "send_to_study", heir: heir.id, path: "counting_house" };
      return checkSendToStudy(s, d, data) ? null : d;
    });
  }
  return { early, late };
}
