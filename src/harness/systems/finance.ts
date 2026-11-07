// What each harness strategy does with high finance (A5): bids for state loans, credit to houses in
// trouble, bargains at auction and insurance lines. Each keeps what it could lose within a share of
// its free cash, so a carry or a claim does not end the run on its own.
import { openLots, bidPrice } from "../../sim/finance/auctions";
import { openContracts } from "../../sim/finance/contracts";
import { openHouseRequests } from "../../sim/finance/houseLoans";
import { exposure, openCoverRequests } from "../../sim/finance/insurance";
import type { LotKind } from "../../sim/finance/types";
import { stateRisk } from "../../sim/bonds";
import { freeCash } from "../../sim/reserves";
import type { GameData } from "../../sim/tuning";
import type { GameState } from "../../sim/types";
import type { Maker, SystemMakers } from "../common";

/**
 * Bids `commission` for the first open loan from a state of risk `max_risk` or less, when free cash
 * would cover `carry` of its size (what a bad placement might leave the house holding).
 */
export function bidForLoans(data: GameData, max_risk: number, commission: number, carry: number): Maker {
  return (s) => {
    const c = openContracts(s).find((x) => {
      const issuer = data.states.find((st) => st.id === x.state);
      return x.player_bid === null && issuer && stateRisk(s, issuer) <= max_risk && freeCash(s) >= x.size * carry;
    });
    return c ? { kind: "bid_contract", contract: c.id, commission } : null;
  };
}

/** Lends to a house in trouble that thinks at least `min_opinion` of the house, at `rate` (or its most), when free cash is `cover` times the loan. */
export function creditHouses(rate: number, min_opinion: number, cover: number): Maker {
  return (s) => {
    const r = openHouseRequests(s).find((x) => (s.houses.find((h) => h.id === x.house)?.opinion ?? -100) >= min_opinion && freeCash(s) >= x.amount * cover);
    return r ? { kind: "lend_house", request: r.id, rate: Math.min(rate, r.max_rate) } : null;
  };
}

/** Bids `bid` of the appraisal for a lot of one of `kinds`, if the price is at most `share` of free cash. */
export function bidAtAuction(bid: number, share: number, kinds: LotKind[]): Maker {
  return (s) => {
    const lot = openLots(s).find((l) => l.player_bid === null && kinds.includes(l.kind) && bidPrice(l, bid) <= share * freeCash(s));
    return lot ? { kind: "bid_lot", lot: lot.id, bid } : null;
  };
}

/** Takes a `line` of a risk of one of `kinds`, keeping total insured value within `cap` times free cash. */
export function underwriteRisks(kinds: ("ship" | "warehouse")[], line: number, cap: number): Maker {
  return (s) => {
    const r = openCoverRequests(s).find((x) => kinds.includes(x.kind) && exposure(s) + x.value * line <= cap * freeCash(s));
    return r ? { kind: "underwrite", request: r.id, line } : null;
  };
}

/** Makers for strategy `name`: `early` ones go before its other wants, `late` ones after. */
export function financeMakers(name: string, _state: GameState, data: GameData): SystemMakers {
  const none: Maker[] = [];
  switch (name) {
    case "cautious":
    case "cautious_no_family":
      // Safe states' loans when it could carry a third; friends' credit at a fair price; warehouses insured in small lines; cheap lots.
      return {
        early: none,
        late: [bidForLoans(data, 0.25, 0.03, 0.3), creditHouses(0.08, 0, 4), underwriteRisks(["warehouse"], 0.25, 0.5), bidAtAuction(0.5, 0.1, ["warehouse", "broker_place", "shares"])],
      };
    case "aggressive":
      // Every loan at a keen price; dear credit to anyone; whole lines on ships and warehouses; bargains of any kind.
      return {
        early: none,
        late: [bidForLoans(data, 1, 0.02, 0.1), creditHouses(0.15, -100, 1.5), underwriteRisks(["ship", "warehouse"], 1, 2), underwriteRisks(["ship", "warehouse"], 1, 2), bidAtAuction(0.6, 0.3, ["warehouse", "ship", "shares", "broker_place"])],
      };
    case "bond_heavy":
      // State loans are its trade: it bids first, for any state it would hold, when it could carry a fifth.
      return { early: [bidForLoans(data, 0.4, 0.025, 0.2)], late: none };
    case "venture_heavy":
      // Ships and warehouses at auction: working assets, like its ventures.
      return { early: none, late: [bidAtAuction(0.55, 0.3, ["ship", "warehouse"])] };
    case "investor":
      // Shares and a broker's place at auction; half lines of insurance.
      return { early: none, late: [bidAtAuction(0.5, 0.2, ["shares", "broker_place"]), underwriteRisks(["ship", "warehouse"], 0.5, 1)] };
    default:
      return { early: none, late: none };
  }
}
