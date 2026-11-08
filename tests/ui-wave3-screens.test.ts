// Wave 2's screens (src/ui/model/finance.ts, people.ts, progress.ts, europe.ts) must agree with
// the sim: every choice the screens show as open is one the sim accepts (and every refused one is
// refused), every sum adds up to the sim's own figure, and the map never shows a city's true mood.
import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { economyDecisions } from "../src/harness/golden";
import { applyDecisions } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { createRng } from "../src/sim/rng";
import { europeBook } from "../src/sim/systems/europe";
import { financeBook } from "../src/sim/systems/finance";
import { netWorth, endTurn } from "../src/sim/turn";
import { exposure } from "../src/sim/finance/insurance";
import type { Decision, GameState } from "../src/sim/types";
import { breakdown, type Section } from "../src/ui/model/breakdowns";
import { assetRows, bidChoices, commissionChoices, contractRows, coverRows, exposureSection, financeSection, lineChoices, lotRows, rateChoices, requestRows } from "../src/ui/model/finance";
import { familyLetterViews, loyaltyView, studyViews } from "../src/ui/model/people";
import { techViews } from "../src/ui/model/progress";
import { billQuote, branchView, cityPins, europeSection, openCandidates } from "../src/ui/model/europe";

const accepts = (s: GameState, d: Decision) => applyDecisions(s, [d], gameData).ok;

function adds(sec: Section) {
  const sum = sec.lines.reduce((n, l) => n + (l.amount ?? 0), 0);
  expect(sum, sec.heading).toBe(sec.total!.amount);
}

/** Every check the wave 3 screens make, on one state. Returns decisions a keen player would take, all shown as open. */
function checkScreens(s: GameState): Decision[] {
  const take: Decision[] = [];
  // Net worth: the top bar's lines add up to the sim's.
  const worth = breakdown("worth", s, s, gameData).sections[0]!;
  adds(worth);
  expect(worth.total!.amount).toBe(netWorth(s));

  // Finance.
  const fin = financeSection(s);
  adds(fin);
  expect(fin.total!.amount).toBe(financeBook(s));
  const exp = exposureSection(s);
  adds(exp);
  expect(exp.total!.amount).toBe(exposure(s));
  for (const r of contractRows(s, gameData).filter((x) => x.phase === "open")) {
    const choices = commissionChoices(s, r.contract, gameData);
    for (const c of choices) expect(c.blocked === null, `commission ${c.value}: ${c.blocked}`).toBe(accepts(s, { kind: "bid_contract", contract: r.contract.id, commission: c.value }));
    const ok = choices.find((c) => c.blocked === null);
    if (ok) take.push({ kind: "bid_contract", contract: r.contract.id, commission: ok.value });
  }
  for (const r of requestRows(s, gameData).filter((x) => x.open)) {
    const choices = rateChoices(s, r.request, gameData);
    expect(choices.at(-1)!.value).toBe(r.request.max_rate);
    for (const c of choices) expect(c.blocked === null, `rate ${c.value}: ${c.blocked}`).toBe(accepts(s, { kind: "lend_house", request: r.request.id, rate: c.value }));
    if (choices.at(-1)!.blocked === null) take.push({ kind: "lend_house", request: r.request.id, rate: r.request.max_rate });
  }
  for (const r of lotRows(s, gameData).filter((x) => x.open)) {
    const choices = bidChoices(s, r.lot, gameData);
    for (const c of choices) expect(c.blocked === null).toBe(accepts(s, { kind: "bid_lot", lot: r.lot.id, bid: c.value }));
    const ok = choices.find((c) => c.value >= 0.7 && c.blocked === null);
    if (ok) take.push({ kind: "bid_lot", lot: r.lot.id, bid: ok.value });
  }
  for (const a of assetRows(s, gameData)) expect(a.blocked === null).toBe(accepts(s, { kind: "sell_asset", asset: a.asset.id }));
  for (const r of coverRows(s, gameData).filter((x) => x.open)) {
    const choices = lineChoices(s, r.request, gameData);
    for (const c of choices) expect(c.blocked === null).toBe(accepts(s, { kind: "underwrite", request: r.request.id, line: c.value }));
    if (choices[0]!.blocked === null) take.push({ kind: "underwrite", request: r.request.id, line: choices[0]!.value });
  }

  // People.
  for (const p of s.people) {
    const v = loyaltyView(s, p, gameData);
    if (v) expect(v.value).toBeGreaterThanOrEqual(0);
  }
  for (const l of familyLetterViews(s, gameData)) {
    for (const o of l.options) {
      if (l.letter.answer !== null) continue;
      expect(o.blocked === null, `${l.title} ${o.id}: ${o.blocked}`).toBe(accepts(s, { kind: "answer_family_letter", letter: l.letter.id, option: o.id }));
      expect(o.effect.length).toBeGreaterThan(0);
    }
    const first = l.options.find((o) => o.blocked === null);
    if (l.letter.answer === null && first) take.push({ kind: "answer_family_letter", letter: l.letter.id, option: first.id });
  }
  for (const h of studyViews(s, gameData)) {
    for (const p of h.paths) expect(p.blocked === null, `${h.heir.name} ${p.path.id}: ${p.blocked}`).toBe(accepts(s, { kind: "send_to_study", heir: h.heir.id, path: p.path.id }));
    const ok = h.paths.find((p) => p.blocked === null && p.path.id !== "army");
    if (ok) take.push({ kind: "send_to_study", heir: h.heir.id, path: ok.path.id });
  }

  // Progress: no hidden borrower quality reaches the screen.
  expect(JSON.stringify(techViews(s, gameData))).not.toMatch(/quality/i);

  // Europe.
  const eu = europeSection(s, gameData);
  adds(eu);
  expect(eu.total!.amount).toBe(europeBook(s));
  for (const pin of cityPins(s, gameData)) {
    if (pin.home) continue;
    const cs = s.europe.cities.find((c) => c.id === pin.city.id)!;
    expect(pin.known).toEqual(cs.known);
    const min = gameData.europe.branch.min_capital;
    if (!pin.branch) {
      for (const c of openCandidates(s, pin.city.id, min, gameData)) expect(c.blocked === null, `${pin.city.id} ${c.person.name}: ${c.blocked}`).toBe(accepts(s, { kind: "open_branch", city: pin.city.id, head: c.person.id, capital: min }));
      const ok = openCandidates(s, pin.city.id, min, gameData).find((c) => c.blocked === null);
      if (ok && !take.some((d) => d.kind === "open_branch")) take.push({ kind: "open_branch", city: pin.city.id, head: ok.person.id, capital: min });
    } else {
      const v = branchView(s, pin.city.id, gameData)!;
      adds(v.estimate);
      expect(v.closeBlocked === null).toBe(accepts(s, { kind: "close_branch", city: pin.city.id }));
      for (const c of v.candidates) expect(c.blocked === null).toBe(accepts(s, { kind: "appoint_branch_head", city: pin.city.id, head: c.person.id }));
    }
    const q = billQuote(s, pin.city.id, 1000, gameData);
    adds(q.sections[1]!);
    expect(q.sections[1]!.total!.amount).toBe(q.room);
    const r = applyDecisions(s, [{ kind: "buy_bill", city: pin.city.id, amount: 1000 }], gameData);
    expect(q.blocked === null, `bill on ${pin.city.id}: ${q.blocked}`).toBe(r.ok);
    if (r.ok) {
      expect(s.house.cash - r.state.house.cash).toBe(1000);
      expect(r.state.europe.bills.at(-1)!.face).toBe(q.face);
      if (pin.city.id === "amsterdam") take.push({ kind: "buy_bill", city: "amsterdam", amount: 1000 });
    }
  }
  return take;
}

/** Applies as many of `ds` as the sim accepts, in order. */
function applySome(s: GameState, ds: Decision[]): { state: GameState; taken: Decision[] } {
  const taken: Decision[] = [];
  for (const d of ds) {
    const r = applyDecisions(s, [d], gameData);
    if (r.ok) {
      s = r.state;
      taken.push(d);
    }
  }
  return { state: s, taken };
}

describe("wave 3 screens", () => {
  it("agree with the sim for a rich, well-known house that takes every chance", () => {
    const rng = createRng(1830);
    let s = newGame(gameData, rng);
    s.house.cash += 400000;
    s.house.reputation = 85;
    const seen = { contract: false, lot: false, cover: false, branch: false, study: false, letter: false };
    for (let i = 0; i < 70 && s.house.status !== "bankrupt"; i++) {
      const eco = applySome(s, economyDecisions(s, gameData));
      const mine = checkScreens(eco.state);
      const all = applySome(eco.state, mine);
      checkScreens(all.state);
      seen.contract ||= s.finance.contracts.length > 0;
      seen.lot ||= s.finance.lots.length > 0;
      seen.cover ||= s.finance.cover_requests.length > 0;
      seen.branch ||= s.europe.branches.length > 0;
      seen.study ||= s.agendas.studies.length > 0;
      seen.letter ||= s.agendas.letters.length > 0;
      s = endTurn(s, [...eco.taken, ...all.taken], rng, gameData);
    }
    expect(seen).toEqual({ contract: true, lot: true, cover: true, branch: true, study: true, letter: true });
  }, 60000);

  it("refuse what costs money when the house has no free cash", () => {
    const s = newGame(gameData, createRng(5));
    s.house.cash = 0;
    for (const h of studyViews(s, gameData)) for (const p of h.paths) if (p.path.cost > 0 && p.blocked) expect(p.blocked).not.toBe("");
    expect(billQuote(s, "london", 1000, gameData).blocked).toMatch(/cash/);
    checkScreens(s);
  });

  it("refuse everything for a bankrupt house", () => {
    const s = newGame(gameData, createRng(6));
    s.house.status = "bankrupt";
    expect(billQuote(s, "london", 1000, gameData).blocked).toBe("The house is bankrupt");
    checkScreens(s);
  });
});
