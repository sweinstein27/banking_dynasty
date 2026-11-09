// What each harness strategy does with politics (C2). Politics letters are answered by each
// strategy's usual letter style (src/harness/common.ts); these makers only take office and, where
// a strategy plays courts, seek one and lend to it.
//
// - cautious and cautious_no_family (the same, so T7 still measures education alone) stand for the
//   Senate when a seat falls vacant, and in a panic, short of cash for depositors, ask the Senate's
//   assurance.
// - bond_heavy stands for the Senate and then the Diet. venture_heavy and investor stand for the
//   Senate only. aggressive and idle do nothing political.
// - No strategy plays courts (measured on 1,000 seeds, docs/notes/C2-politics.md): aggressive,
//   buying influence and taking a court, lent little (its cash is all at work) and spent about
//   16,500 fl. a run on gifts, and went bankrupt in 47% of runs against 33%; bond_heavy never had
//   15% of free cash for a request and was dismissed. The court makers stay for later use.
import { applyDecision } from "../../sim/decisions";
import { headOf } from "../../sim/family";
import { freeCash } from "../../sim/reserves";
import { withdrawalDemand } from "../../sim/sentiment";
import { eligibleMembers, openCourtRequests, openVacancy, type OfficeId } from "../../sim/systems/politics";
import type { GameData } from "../../sim/tuning";
import type { Decision, GameState } from "../../sim/types";
import type { Maker, SystemMakers } from "../common";

interface Play {
  offices: OfficeId[];
  assurance: boolean;
  /** How the strategy picks a court to seek, if it seeks one. */
  court: "bonds" | "grandest" | null;
  /** Lends to a court request of at most this share of free cash (0: never). */
  lend_share: number;
  /** Buys influence until a court will take the house. */
  cultivate: boolean;
}

const NONE: Play = { offices: [], assurance: false, court: null, lend_share: 0, cultivate: false };
const PLAYS: Record<string, Play> = {
  cautious: { ...NONE, offices: ["senate"], assurance: true },
  cautious_no_family: { ...NONE, offices: ["senate"], assurance: true },
  bond_heavy: { ...NONE, offices: ["senate", "diet"] },
  aggressive: NONE,
  venture_heavy: { ...NONE, offices: ["senate"] },
  investor: { ...NONE, offices: ["senate"] },
};

/** The decision if the sim would accept it now, else null. */
const ifAccepted = (s: GameState, d: Decision, data: GameData): Decision | null => (applyDecision(s, d, data).ok ? d : null);

/** Stands the head for `office` if eligible, else the eldest eligible member. */
function standFor(office: OfficeId, data: GameData): Maker {
  return (s) => {
    if (!openVacancy(s, office) || openVacancy(s, office)!.candidate !== null) return null;
    const members = eligibleMembers(s, office, data);
    const who = members.find((p) => p.id === headOf(s)?.id) ?? [...members].sort((a, b) => a.birth_year - b.birth_year)[0];
    return who ? ifAccepted(s, { kind: "stand_for_office", office, member: who.id }, data) : null;
  };
}

/** Courts in the order the strategy would seek them. */
function courtsWanted(s: GameState, how: "bonds" | "grandest", data: GameData): string[] {
  const list = data.politics.courts.list;
  if (how === "grandest") return [...list].sort((a, b) => b.min_reputation - a.min_reputation).map((c) => c.id);
  const held = (stateId: string) => s.bonds.filter((b) => b.status === "active" && b.issuer_state === stateId).reduce((sum, b) => sum + b.face_value, 0);
  const own = list.filter((c) => c.state && held(c.state) > 0).sort((a, b) => held(b.state!) - held(a.state!)).map((c) => c.id);
  // Then any court that will have it, grandest first.
  return [...own, ...courtsWanted(s, "grandest", data).filter((id) => !own.includes(id))];
}

function seekCourt(how: "bonds" | "grandest", data: GameData): Maker {
  return (s) => {
    if (s.politics.courts.length) return null;
    for (const court of courtsWanted(s, how, data)) {
      const d = ifAccepted(s, { kind: "seek_court", court }, data);
      if (d) return d;
    }
    return null;
  };
}

/** Lends to the first open court request of at most `share` of free cash. */
function lendToCourts(share: number, data: GameData): Maker {
  return (s) => {
    const r = openCourtRequests(s).find((x) => x.amount <= share * freeCash(s));
    return r ? ifAccepted(s, { kind: "lend_court", request: r.id }, data) : null;
  };
}

/** Buys influence while no court would yet take the house on influence alone. */
function cultivate(data: GameData): Maker {
  return (s) => {
    if (s.politics.courts.length) return null;
    const need = Math.min(...data.politics.courts.list.filter((c) => !s.politics.dismissed.includes(c.id) && s.house.reputation >= c.min_reputation).map((c) => c.min_influence));
    return Number.isFinite(need) && s.politics.influence < need ? ifAccepted(s, { kind: "cultivate_influence" }, data) : null;
  };
}

function assurance(data: GameData): Maker {
  return (s) => {
    if (s.world.sentiment !== "panic") return null;
    const short = s.house.cash < withdrawalDemand(s.house.deposits, s.world.sentiment, data.tuning, s.house.reputation);
    return short ? ifAccepted(s, { kind: "senate_assurance" }, data) : null;
  };
}

/** Makers for strategy `name`: `early` ones go before its other wants, `late` ones after. */
export function politicsMakers(name: string, _state: GameState, data: GameData): SystemMakers {
  const play = PLAYS[name] ?? NONE;
  const early: Maker[] = play.offices.map((o) => standFor(o, data));
  if (play.assurance) early.push(assurance(data));
  const late: Maker[] = [];
  if (play.court) {
    if (play.cultivate) late.push(cultivate(data));
    late.push(seekCourt(play.court, data));
  }
  // A court's request comes first: refusing it costs favour, and the clerks are busy by the end of the list.
  if (play.lend_share > 0) early.push(lendToCourts(play.lend_share, data));
  return { early, late };
}
