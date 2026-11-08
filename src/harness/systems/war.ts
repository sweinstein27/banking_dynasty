// What each harness strategy does with war loans (C3). Aggressive lends a share of free cash to the
// open war loan of the soundest borrower, repression or not; bond_heavy lends a smaller share, only
// to sound states (risk at most WAR_PLAY.sound_risk) and never to put down a rising. Aggressive lends last
// in the quarter, with what its other deals leave; bond_heavy first, after its bids for state loans.
// Both lend only where their reputation is enough. The rest stay out.
import { stateRisk } from "../../sim/bonds";
import { MIN_WAR_LOAN, openOffers, warLoanGate, type OpenOffer } from "../../sim/war/loans";
import type { GameData } from "../../sim/tuning";
import type { Decision, GameState } from "../../sim/types";
import { shareOfFree, type Maker, type SystemMakers } from "../common";

export const WAR_PLAY = { aggressive: 0.1, bond_heavy: 0.08, sound_risk: 0.25 };

/** A borrower's risk now: a state's, or 1 for a borrower that is not a state (the Central Power). */
function riskOf(s: GameState, o: OpenOffer, data: GameData): number {
  const issuer = data.states.find((x) => x.id === o.offer.borrower);
  return issuer ? stateRisk(s, issuer) : 1;
}

function lendMaker(share: number, ok: (s: GameState, o: OpenOffer) => boolean, data: GameData): Maker {
  return (s): Decision | null => {
    const best = openOffers(s, data)
      .filter((o) => o.room >= MIN_WAR_LOAN && s.house.reputation >= warLoanGate(s, o.offer.borrower, data) && ok(s, o))
      .sort((a, b) => riskOf(s, a, data) - riskOf(s, b, data) || a.offer.id.localeCompare(b.offer.id))[0];
    if (!best) return null;
    const amount = Math.min(best.room, shareOfFree(s, share));
    return amount >= MIN_WAR_LOAN ? { kind: "subscribe_war_loan", offer: best.offer.id, amount } : null;
  };
}

/** Makers for strategy `name`: `early` ones go before its other wants, `late` ones after. */
export function warMakers(name: string, _state: GameState, data: GameData): SystemMakers {
  // Aggressive lends with what is left once its own deals and its bids for state loans (finance's makers come first) are done.
  if (name === "aggressive") return { early: [], late: [lendMaker(WAR_PLAY.aggressive, () => true, data)] };
  if (name === "bond_heavy")
    return { early: [lendMaker(WAR_PLAY.bond_heavy, (s, o) => !o.offer.repression && riskOf(s, o, data) <= WAR_PLAY.sound_risk, data)], late: [] };
  return { early: [], late: [] };
}
