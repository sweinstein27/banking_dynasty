import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { headOf, heirsOf, succeed } from "../src/sim/family";
import { accountBalance } from "../src/sim/ledger";
import { poolFor } from "../src/sim/capacity";
import { applyDecision } from "../src/sim/decisions";
import {
  answerFamilyLetter,
  changeLoyalty,
  checkPeopleData,
  claimAmount,
  eligibleRequests,
  familyOptions,
  loyaltyOf,
  resolvePeople,
  sendToStudy,
  splitOff,
  splitTerms,
  type FamilyLetter,
  type PeopleData,
} from "../src/sim/systems/people";
import type { GameData } from "../src/sim/tuning";
import type { GameState } from "../src/sim/types";
import { addSpouse, fresh, quiet } from "./helpers";

const P = gameData.people;
/** The quiet test data with the people system switched on and its chances set by the test. */
function data(over: Partial<PeopleData> = {}): GameData {
  return { ...quiet, people: { ...P, enabled: true, ...over } };
}
/** No random letters at all: no requests, no one leaves of their own accord. */
const still = data({ requests: { ...P.requests, chance: 0 }, split: { ...P.split, chance: 0, feud_chance: 0 } });
const NO_RNG = { next: () => 0.5 };

/** A house in 1830: Johann (65) heads it, Friedrich 27, Amalie 24, Carl 20, Margarethe his wife. */
function house(): GameState {
  const s = fresh();
  s.world.year = 1830;
  s.world.quarter = 1;
  return s;
}
const byName = (s: GameState, first: string) => s.people.find((p) => p.name.startsWith(first))!;

function letter(s: GameState, l: Partial<FamilyLetter> & Pick<FamilyLetter, "kind" | "person">): FamilyLetter {
  const full: FamilyLetter = { id: s.agendas.next_letter_id++, agenda: null, turn: s.world.turn, amount: 0, member: null, house: null, answer: null, ...l };
  s.agendas.letters.push(full);
  return full;
}

describe("people data", () => {
  it("is sound", () => {
    expect(checkPeopleData(gameData)).toEqual([]);
  });
});

describe("capacity", () => {
  it("answering a family letter is free; sending to study takes the head's time", () => {
    expect(poolFor("answer_family_letter")).toBeNull();
    expect(poolFor("send_to_study")).toBe("head");
  });
});

describe("loyalty", () => {
  it("starts at 60 for heirs and 70 for the head's spouse, and stays within 0 to 100", () => {
    const s = house();
    expect(loyaltyOf(s, byName(s, "Carl"), still)).toBe(P.loyalty.start_heir);
    expect(loyaltyOf(s, byName(s, "Margarethe"), still)).toBe(P.loyalty.start_spouse);
    changeLoyalty(s, byName(s, "Carl").id, 500, still);
    expect(loyaltyOf(s, byName(s, "Carl"), still)).toBe(100);
    changeLoyalty(s, byName(s, "Carl").id, -500, still);
    expect(loyaltyOf(s, byName(s, "Carl"), still)).toBe(0);
  });

  it("drifts 5 a year toward 50, and not past it", () => {
    const s = house();
    s.world.quarter = 4;
    s.agendas.loyalty[byName(s, "Carl").id] = 10;
    s.agendas.loyalty[byName(s, "Amalie").id] = 52;
    resolvePeople(s, NO_RNG, still);
    expect(s.agendas.loyalty[byName(s, "Carl").id]).toBe(15);
    expect(s.agendas.loyalty[byName(s, "Amalie").id]).toBe(50);
  });

  it("naming a younger heir costs the older adult heirs 10", () => {
    const s = house();
    s.house.designated_heir = byName(s, "Carl").id;
    resolvePeople(s, NO_RNG, still);
    expect(loyaltyOf(s, byName(s, "Friedrich"), still)).toBe(50);
    expect(loyaltyOf(s, byName(s, "Amalie"), still)).toBe(50);
    expect(loyaltyOf(s, byName(s, "Carl"), still)).toBe(60);
    resolvePeople(s, NO_RNG, still); // only once per naming
    expect(loyaltyOf(s, byName(s, "Friedrich"), still)).toBe(50);
  });
});

describe("requests", () => {
  it("come from members with the agenda's trait, and the head's spouse asks for a match", () => {
    const s = house();
    byName(s, "Carl").traits = ["gambler"];
    byName(s, "Amalie").traits = ["pious"];
    const list = eligibleRequests(s, still).map((x) => `${x.person.name.split(" ")[0]}:${x.agenda.id}`);
    expect(list).toContain("Carl:venture");
    expect(list).toContain("Amalie:charity");
    expect(list).toContain("Margarethe:match");
    expect(list).not.toContain("Friedrich:venture");
  });

  it("a request arrives at End Turn when the roll comes up, and the asker then rests", () => {
    const s = house();
    byName(s, "Carl").traits = ["gambler"];
    resolvePeople(s, NO_RNG, data({ requests: { ...P.requests, chance: 1 } }));
    expect(s.agendas.letters).toHaveLength(1);
    const l = s.agendas.letters[0]!;
    expect(l.kind).toBe("request");
    expect(eligibleRequests(s, still).some((x) => x.person.id === l.person)).toBe(false);
  });

  it("granting costs the agenda's price and raises loyalty 15", () => {
    const s = house();
    const carl = byName(s, "Carl");
    const l = letter(s, { kind: "request", person: carl.id, agenda: "allowance" });
    const r = answerFamilyLetter(s, { kind: "answer_family_letter", letter: l.id, option: "grant" }, still);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.house.cash).toBe(s.house.cash - 1000);
    expect(accountBalance(r.state, "cash")).toBe(r.state.house.cash);
    expect(loyaltyOf(r.state, byName(r.state, "Carl"), still)).toBe(75);
  });

  it("with no cash above the reserve only refusing is open, and an unanswered letter is refused at End Turn", () => {
    const s = house();
    s.house.cash = 0;
    const carl = byName(s, "Carl");
    const l = letter(s, { kind: "request", person: carl.id, agenda: "allowance" });
    const r = answerFamilyLetter(s, { kind: "answer_family_letter", letter: l.id, option: "grant" }, still);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/Not enough cash/);
    resolvePeople(s, NO_RNG, still);
    expect(s.agendas.letters).toHaveLength(0);
    expect(loyaltyOf(s, carl, still)).toBe(45);
    expect(s.house.cash).toBe(0);
  });

  it("a granted venture pays its payout when its chance comes up", () => {
    const s = house();
    const carl = byName(s, "Carl");
    const l = letter(s, { kind: "request", person: carl.id, agenda: "venture" });
    const sure = data({ requests: { ...P.requests, chance: 0 }, agendas: P.agendas.map((a) => (a.id === "venture" ? { ...a, chance: 1 } : a)) });
    const r = answerFamilyLetter(s, { kind: "answer_family_letter", letter: l.id, option: "grant" }, sure);
    if (!r.ok) throw new Error(r.reason);
    resolvePeople(r.state, NO_RNG, sure);
    expect(r.state.house.cash).toBe(s.house.cash - 2000 + 5000);
    expect(accountBalance(r.state, "cash")).toBe(r.state.house.cash);
  });

  it("granting a desk makes the member a clerk, who leaves the desk on becoming head", () => {
    const s = house();
    const fried = byName(s, "Friedrich");
    fried.acumen = 7;
    const staff = s.counting.staff.length;
    const l = letter(s, { kind: "request", person: fried.id, agenda: "desk" });
    const r = answerFamilyLetter(s, { kind: "answer_family_letter", letter: l.id, option: "grant" }, still);
    if (!r.ok) throw new Error(r.reason);
    const clerk = r.state.counting.staff.at(-1)!;
    expect(r.state.counting.staff).toHaveLength(staff + 1);
    expect(clerk).toMatchObject({ name: fried.name, role: "clerk", skill: 7, start_turn: s.world.turn + 1 });
    succeed(r.state, still); // Johann dies; Friedrich, the best trained, takes over
    expect(headOf(r.state)!.id).toBe(fried.id);
    resolvePeople(r.state, NO_RNG, still);
    expect(r.state.counting.staff.find((m) => m.id === clerk.id)!.leaving).toBe(true);
  });

  it("granting a match marries the member, as arrange_marriage would", () => {
    const s = house();
    const amalie = byName(s, "Amalie");
    const l = letter(s, { kind: "request", person: byName(s, "Margarethe").id, agenda: "match", member: amalie.id, house: "merchant" });
    const r = answerFamilyLetter(s, { kind: "answer_family_letter", letter: l.id, option: "grant" }, still);
    if (!r.ok) throw new Error(r.reason);
    expect(byName(r.state, "Amalie").spouse).not.toBeNull();
    expect(r.state.marriages).toHaveLength(1);
    expect(loyaltyOf(r.state, byName(r.state, "Margarethe"), still)).toBe(85);
  });
});

describe("an heir splitting off", () => {
  it("founds a rival house with capital and depositors, and the ledger balances", () => {
    const s = house();
    const carl = byName(s, "Carl");
    carl.traits = ["reckless"];
    addSpouse(s, carl.id, 1811);
    s.house.designated_heir = carl.id;
    const { capital, deposits } = splitTerms(s, still);
    expect(capital).toBe(10000); // 10% of 100,000
    expect(deposits).toBe(5000); // 10% of 50,000
    const h = splitOff(s, carl, still);
    expect(s.houses).toContainEqual(h);
    expect(h).toMatchObject({ name: "Carl Adler & Co.", temperament: "bold", wealth: 10000, opinion: P.split.opinion, failed_turn: null });
    expect(carl.role).toBe("left");
    expect(s.people.find((p) => p.spouse === carl.id)!.role).toBe("left");
    expect(s.house.designated_heir).toBeNull();
    expect(heirsOf(s).map((p) => p.name)).not.toContain("Carl Adler");
    expect(s.house.cash).toBe(100000 - 15000);
    expect(s.house.deposits).toBe(45000);
    expect(s.house.reputation).toBe(50 - P.split.reputation);
    expect(accountBalance(s, "cash")).toBe(s.house.cash);
    expect(accountBalance(s, "deposits")).toBe(s.house.deposits);
  });

  it("caps the capital and takes nothing from a house with no cash", () => {
    const s = house();
    s.house.cash = 1_000_000;
    expect(splitTerms(s, still).capital).toBe(P.split.capital_max);
    s.house.cash = -500;
    expect(splitTerms(s, still)).toEqual({ capital: 0, deposits: 0 });
  });

  it("a disloyal adult heir writes at year end; letting them go splits at once", () => {
    const s = house();
    s.world.quarter = 4;
    const carl = byName(s, "Carl");
    s.agendas.loyalty[carl.id] = 20;
    const sure = data({ requests: { ...P.requests, chance: 0 }, split: { ...P.split, chance: 1 } });
    resolvePeople(s, NO_RNG, sure);
    const l = s.agendas.letters.find((x) => x.kind === "leaving")!;
    expect(l.person).toBe(carl.id);
    expect(familyOptions(l, sure).map((o) => o.id)).toEqual(["buy_off", "let_go", "forbid"]);
    const r = answerFamilyLetter(s, { kind: "answer_family_letter", letter: l.id, option: "let_go" }, sure);
    if (!r.ok) throw new Error(r.reason);
    expect(byName(r.state, "Carl").role).toBe("left");
    expect(r.state.houses).toHaveLength(1);
  });

  it("the named heir and a loyal one do not write", () => {
    const s = house();
    s.world.quarter = 4;
    s.agendas.loyalty[byName(s, "Carl").id] = 20;
    s.house.designated_heir = byName(s, "Carl").id;
    s.agendas.named = s.house.designated_heir;
    resolvePeople(s, NO_RNG, data({ requests: { ...P.requests, chance: 0 }, split: { ...P.split, chance: 1 } }));
    expect(s.agendas.letters.filter((x) => x.kind === "leaving")).toHaveLength(0);
  });

  it("forbidding: they stay, less loyal, or go, by the roll", () => {
    const stay = data({ requests: { ...P.requests, chance: 0 }, split: { ...P.split, chance: 0, forbid_stay: 1 } });
    const go = data({ requests: { ...P.requests, chance: 0 }, split: { ...P.split, chance: 0, forbid_stay: 0 } });
    for (const [d, role] of [[stay, "line"], [go, "left"]] as const) {
      const s = house();
      const carl = byName(s, "Carl");
      s.agendas.loyalty[carl.id] = 20;
      letter(s, { kind: "leaving", person: carl.id });
      resolvePeople(s, NO_RNG, d); // unanswered: forbid is the default
      expect(byName(s, "Carl").role).toBe(role);
      if (role === "line") expect(loyaltyOf(s, byName(s, "Carl"), d)).toBe(10);
    }
  });
});

describe("claims at succession", () => {
  /** Johann dies with Carl named heir, so Friedrich and Amalie are passed over. */
  function passOver(s: GameState): void {
    s.house.designated_heir = byName(s, "Carl").id;
    s.agendas.named = s.house.designated_heir;
    succeed(s, still);
    resolvePeople(s, NO_RNG, still);
  }

  it("older adult heirs who are not loyal claim a share of cash", () => {
    const s = house();
    passOver(s);
    const claims = s.agendas.letters.filter((l) => l.kind === "claim");
    expect(claims.map((l) => l.person).sort()).toEqual([byName(s, "Friedrich").id, byName(s, "Amalie").id].sort());
    expect(claims[0]!.amount).toBe(claimAmount(s, still));
    expect(claims[0]!.amount).toBe(10000);
  });

  it("a loyal eldest accepts it: no claim, and no reputation for passing over", () => {
    const a = house();
    const b = house();
    a.agendas.loyalty[byName(a, "Friedrich").id] = 80;
    a.agendas.loyalty[byName(a, "Amalie").id] = 80;
    passOver(a);
    passOver(b);
    expect(a.agendas.letters.filter((l) => l.kind === "claim")).toHaveLength(0);
    expect(a.house.reputation - b.house.reputation).toBe(gameData.tuning.family.succession.passed_over_reputation);
  });

  it("paying settles it; refusing starts a feud that costs reputation each quarter", () => {
    const s = house();
    passOver(s);
    const [first, second] = s.agendas.letters.filter((l) => l.kind === "claim");
    const r = answerFamilyLetter(s, { kind: "answer_family_letter", letter: first!.id, option: "pay" }, still);
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.house.cash).toBe(s.house.cash - first!.amount);
    expect(loyaltyOf(r.state, r.state.people.find((p) => p.id === first!.person)!, still)).toBe(P.loyalty.after_claim_paid);
    const rep = r.state.house.reputation;
    resolvePeople(r.state, NO_RNG, still); // the second is left unanswered: refused
    expect(r.state.agendas.feuds.map((f) => f.person)).toEqual([second!.person]);
    expect(r.state.house.reputation).toBe(rep - P.feuds.reputation_per_quarter);
  });

  it("going to law: dismissed, or the house pays half", () => {
    for (const win of [1, 0]) {
      const d = data({ requests: { ...P.requests, chance: 0 }, split: { ...P.split, chance: 0, feud_chance: 0 }, claims: { ...P.claims, law_win: win } });
      const s = house();
      passOver(s);
      const c = s.agendas.letters.find((l) => l.kind === "claim")!;
      const r = answerFamilyLetter(s, { kind: "answer_family_letter", letter: c.id, option: "law" }, d);
      if (!r.ok) throw new Error(r.reason);
      const cash = r.state.house.cash;
      r.state.agendas.letters = r.state.agendas.letters.filter((l) => l.id === c.id);
      resolvePeople(r.state, NO_RNG, d);
      expect(r.state.house.cash).toBe(win ? cash : cash - c.amount / 2);
      expect(r.state.agendas.feuds).toHaveLength(0);
      expect(accountBalance(r.state, "cash")).toBe(r.state.house.cash);
    }
  });

  it("a head dying mid-feud ends the feud", () => {
    const s = house();
    passOver(s);
    resolvePeople(s, NO_RNG, still); // both claims refused
    expect(s.agendas.feuds).toHaveLength(2);
    succeed(s, still); // Carl dies young, it happens
    resolvePeople(s, NO_RNG, still);
    expect(s.agendas.feuds.every((f) => f.head === headOf(s)!.id)).toBe(true);
    expect(s.agendas.feuds).toHaveLength(0);
    expect(s.agendas.log.some((e) => /buried/.test(e.text))).toBe(true);
  });

  it("a feud offers terms at year end; accepting ends it", () => {
    const s = house();
    passOver(s);
    resolvePeople(s, NO_RNG, still);
    s.world.quarter = 4;
    resolvePeople(s, NO_RNG, still);
    const terms = s.agendas.letters.filter((l) => l.kind === "reconcile");
    expect(terms).toHaveLength(2);
    const r = answerFamilyLetter(s, { kind: "answer_family_letter", letter: terms[0]!.id, option: "pay" }, still);
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.agendas.feuds).toHaveLength(1);
  });

  it("an heir in a feud who splits off leaves a house more hostile", () => {
    const s = house();
    passOver(s);
    resolvePeople(s, NO_RNG, still);
    const f = s.agendas.feuds[0]!;
    const h = splitOff(s, s.people.find((p) => p.id === f.person)!, still);
    expect(h.opinion).toBe(P.split.feud_opinion);
    expect(s.agendas.feuds.some((x) => x.person === f.person)).toBe(false);
  });
});

describe("education paths", () => {
  const kid = (s: GameState) => {
    const carl = byName(s, "Carl");
    carl.birth_year = s.world.year - 17;
    return carl;
  };

  it("pays in full, takes the head's time, and returns with the path's gains", () => {
    const s = house();
    const carl = kid(s);
    const before = { ...carl };
    const r = applyDecision(s, { kind: "send_to_study", heir: carl.id, path: "london" }, still);
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.house.cash).toBe(s.house.cash - 2400);
    expect(r.state.counting.used.head).toBe(1);
    expect(accountBalance(r.state, "cash")).toBe(r.state.house.cash);
    const st = r.state;
    for (let i = 0; i < 7; i++) {
      resolvePeople(st, NO_RNG, still);
      st.world.turn += 1;
    }
    expect(byName(st, "Carl").acumen).toBe(before.acumen);
    resolvePeople(st, NO_RNG, still);
    expect(byName(st, "Carl").acumen).toBe(before.acumen + 2);
    expect(byName(st, "Carl").connections).toBe(before.connections + 1);
    expect(st.agendas.studies).toHaveLength(0);
    expect(loyaltyOf(st, byName(st, "Carl"), still)).toBe(65);
  });

  it("refuses the wrong age, a second path, and a path the house cannot pay", () => {
    const s = house();
    const carl = kid(s);
    expect(applyDecision(s, { kind: "send_to_study", heir: byName(s, "Friedrich").id, path: "army" }, still).ok).toBe(false);
    const r = sendToStudy(s, { kind: "send_to_study", heir: carl.id, path: "army" }, still);
    if (!r.ok) throw new Error(r.reason);
    expect(sendToStudy(r.state, { kind: "send_to_study", heir: carl.id, path: "counting_house" }, still).ok).toBe(false);
    r.state.agendas.studies = [];
    expect(sendToStudy(r.state, { kind: "send_to_study", heir: carl.id, path: "counting_house" }, still).ok).toBe(true);
    const again = sendToStudy(r.state, { kind: "send_to_study", heir: carl.id, path: "army" }, still);
    expect(!again.ok && again.reason).toMatch(/already had/);
    const broke = house();
    broke.house.cash = 100;
    const r2 = sendToStudy(broke, { kind: "send_to_study", heir: kid(broke).id, path: "university" }, still);
    expect(!r2.ok && r2.reason).toMatch(/Not enough cash/);
  });

  it("the counting house path is free and adds loyalty 10", () => {
    const s = house();
    const carl = kid(s);
    const r = sendToStudy(s, { kind: "send_to_study", heir: carl.id, path: "counting_house" }, still);
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.house.cash).toBe(s.house.cash);
    for (let i = 0; i < 4; i++) {
      resolvePeople(r.state, NO_RNG, still);
      r.state.world.turn += 1;
    }
    expect(loyaltyOf(r.state, byName(r.state, "Carl"), still)).toBe(70);
  });

  it("an heir who takes over mid-study comes back at once with half the gains", () => {
    const s = house();
    s.people = s.people.filter((p) => !["Friedrich", "Amalie"].some((n) => p.name.startsWith(n)));
    const carl = kid(s);
    const before = { ...carl };
    const r = sendToStudy(s, { kind: "send_to_study", heir: carl.id, path: "university" }, still);
    if (!r.ok) throw new Error(r.reason);
    succeed(r.state, still);
    expect(headOf(r.state)!.id).toBe(carl.id);
    resolvePeople(r.state, NO_RNG, still);
    expect(byName(r.state, "Carl").prudence).toBe(before.prudence + 1);
    expect(byName(r.state, "Carl").connections).toBe(before.connections);
    expect(r.state.agendas.studies).toHaveLength(0);
  });
});

describe("the system switched off", () => {
  it("draws no letters", () => {
    const s = house();
    byName(s, "Carl").traits = ["gambler"];
    s.world.quarter = 4;
    s.agendas.loyalty[byName(s, "Carl").id] = 0;
    resolvePeople(s, NO_RNG, quiet);
    expect(s.agendas.letters).toHaveLength(0);
  });
});

describe("whole runs with the real data", () => {
  it("play to 1850 with the books reconciled, and family news written", async () => {
    const { play } = await import("../src/harness/golden");
    const { idle } = await import("../src/harness/strategies");
    let letters = 0;
    for (const seed of [1, 2, 3, 4]) {
      const { state } = play(idle, seed, 140, gameData);
      expect(accountBalance(state, "cash")).toBe(state.house.cash);
      expect(accountBalance(state, "deposits")).toBe(state.house.deposits);
      letters += state.news.filter((n) => n.kind === "letter" && /awaits your answer/.test(n.text)).length;
    }
    expect(letters).toBeGreaterThan(0);
  });
});

describe("harness makers", () => {
  it("cautious and cautious_no_family answer family letters alike; aggressive grants only ventures; idle answers nothing", async () => {
    const { peopleMakers } = await import("../src/harness/systems/people");
    const s = house();
    letter(s, { kind: "request", person: byName(s, "Amalie").id, agenda: "allowance" });
    letter(s, { kind: "request", person: byName(s, "Carl").id, agenda: "venture" });
    letter(s, { kind: "leaving", person: byName(s, "Friedrich").id });
    const answers = (name: string) => peopleMakers(name, s, still).early.map((m) => m(s)).map((d) => (d && d.kind === "answer_family_letter" ? d.option : null));
    expect(answers("cautious")).toEqual(["grant", null, "buy_off"]);
    expect(answers("cautious_no_family")).toEqual(answers("cautious"));
    expect(answers("aggressive")).toEqual([null, "grant", null]);
    expect(answers("idle")).toEqual([null, null, null]);
  });

  it("only cautious sends its successor to the counting house", async () => {
    const { peopleMakers } = await import("../src/harness/systems/people");
    const s = fresh();
    s.world.year = 1817; // Friedrich is 14
    byName(s, "Friedrich").acumen = 4; // and the best of the heirs, so the successor
    expect(peopleMakers("cautious", s, still).late.map((m) => m(s))).toEqual([{ kind: "send_to_study", heir: byName(s, "Friedrich").id, path: "counting_house" }]);
    expect(peopleMakers("cautious_no_family", s, still).late).toHaveLength(0);
  });
});
