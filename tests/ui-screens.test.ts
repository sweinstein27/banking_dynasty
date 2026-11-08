// Wave 1's screens (src/ui/model/credit.ts, house.ts, markets.ts) must agree with the sim: every
// sum adds up to the sim's own figure, every action the screen offers as open is one the sim
// accepts, and no hidden quality number reaches the screen.
import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { economyDecisions } from "../src/harness/golden";
import { applyDecisions } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { commoditiesBook, sharesBook, warehouseSpace } from "../src/sim/systems/markets";
import { upkeepBill, wageBill } from "../src/sim/systems/counting";
import { createRng } from "../src/sim/rng";
import { salePrice } from "../src/sim/systems/credit";
import { endTurn } from "../src/sim/turn";
import type { Decision, GameState } from "../src/sim/types";
import { fileDoc, loansHeld, merchantRows, salePriceSection } from "../src/ui/model/credit";
import { candidates, costSections, councilLetters, houseRooms, pools } from "../src/ui/model/house";
import { companyRows, goodsRows, goodsTrade, harvestView, roomFor, shareTrade, trendOf, ventureRows, warehouse } from "../src/ui/model/markets";

const accepts = (s: GameState, d: Decision) => applyDecisions(s, [d], gameData).ok;

/** Every check the screens make, on one state. */
function checkScreens(s: GameState) {
  // Credit: no quality anywhere, and open actions are accepted.
  const rows = merchantRows(s, gameData);
  expect(JSON.stringify(rows)).not.toMatch(/quality/i);
  for (const r of rows) {
    for (const a of r.actions) {
      if (a.kind === "lend") continue; // lending needs an amount and rate: the dialog checks it
      const d = { kind: a.kind, borrower: r.offer.borrower_id } as Decision;
      expect(a.blocked === null, `${a.kind} on ${r.offer.name}: ${a.blocked}`).toBe(accepts(s, d));
    }
  }
  for (const l of loansHeld(s, gameData)) {
    const sec = salePriceSection(s, l, gameData);
    expect(sec.lines.reduce((n, x) => n + x.amount!, 0)).toBe(sec.total!.amount);
    expect(sec.total!.amount).toBe(salePrice(s.loans.find((x) => x.id === l.loan_id)!, s, gameData));
    expect(l.blocked === null).toBe(accepts(s, { kind: "sell_loan", loan: l.loan_id }));
  }

  // The House: bills add up to the sim's, and open builds and hires are accepted.
  const [wages, upkeep] = costSections(s, gameData);
  expect(wages!.lines.reduce((n, x) => n + x.amount!, 0)).toBe(wageBill(s, gameData));
  expect(wages!.total!.amount).toBe(wageBill(s, gameData));
  expect(upkeep!.lines.reduce((n, x) => n + x.amount!, 0)).toBe(upkeepBill(s, gameData));
  for (const room of houseRooms(s, gameData)) {
    if (!room.build) continue;
    const facility = room.id === "partners_office" ? null : room.id;
    expect(room.build.blocked === null, `build ${room.id}: ${room.build.blocked}`).toBe(accepts(s, { kind: "build", facility: facility! }));
  }
  for (const role of ["clerk", "analyst", "partner"] as const)
    for (const c of candidates(s, role, gameData)) expect(c.blocked === null).toBe(accepts(s, { kind: "hire", role, candidate: c.index }));
  expect(pools(s, gameData).every((p) => p.left <= p.size)).toBe(true);
  expect(councilLetters(s).every((a) => a.title.length > 0)).toBe(true);

  // Markets: holdings add up to the books, and open trades are accepted at the cost shown.
  const cos = companyRows(s, gameData);
  expect(cos.reduce((n, c) => n + c.value, 0)).toBe(sharesBook(s));
  expect(JSON.stringify(cos)).not.toMatch(/fair|truth/i);
  const goods = goodsRows(s, gameData);
  expect(goods.reduce((n, g) => n + g.value, 0)).toBe(commoditiesBook(s));
  expect(warehouse(s, gameData).space).toBe(warehouseSpace(s, gameData));
  for (const c of cos.filter((x) => x.status === "listed").slice(0, 3)) {
    const t = shareTrade(s, c.id, 10, "buy", gameData);
    const r = applyDecisions(s, [{ kind: "buy_shares", company: c.id, shares: 10 }], gameData);
    expect(t.blocked === null).toBe(r.ok);
    if (r.ok) expect(s.house.cash - r.state.house.cash).toBe(t.amount);
  }
  for (const g of goods) {
    const n = Math.min(5, roomFor(s, g.id, gameData));
    if (n === 0) continue;
    const t = goodsTrade(s, g.id, n, "buy", gameData);
    const r = applyDecisions(s, [{ kind: "buy_commodity", commodity: g.id, units: n }], gameData);
    expect(t.blocked === null).toBe(r.ok);
    if (r.ok) expect(s.house.cash - r.state.house.cash).toBe(t.amount);
  }
  const h = harvestView(s, gameData);
  expect(h.regions).toHaveLength(gameData.markets.regions.length);
  for (const v of ventureRows(s, gameData)) {
    expect(v.callsPaid).toBeLessThanOrEqual(v.calls);
    expect(v.overrunCalls).toBe(v.calls - v.callsPlanned);
    if (v.sale) expect(v.sale.blocked === null).toBe(accepts(s, { kind: "sell_venture", venture: v.id }));
  }
}

describe("wave 1 screens", () => {
  it("agree with the sim, quarter by quarter, across the full economy", () => {
    const rng = createRng(1815);
    let s = newGame(gameData, rng);
    let sawFile = false;
    let sawVenture = false;
    for (let i = 0; i < 24 && s.house.status !== "bankrupt"; i++) {
      checkScreens(s);
      const ds = economyDecisions(s, gameData);
      const r = applyDecisions(s, ds, gameData);
      if (!r.ok) throw new Error(r.reason);
      checkScreens(r.state);
      // Buy a report and an inquiry on top of the strategy's orders, to see files on the page.
      const asking = r.state.requests[0]?.borrower_id;
      const files = asking === undefined ? r : applyDecisions(r.state, [{ kind: "report", borrower: asking }, { kind: "inquire", borrower: asking }], gameData);
      if (files.ok) {
        checkScreens(files.state);
        sawFile ||= merchantRows(files.state, gameData).some((m) => m.doc !== null);
      }
      sawVenture ||= ventureRows(r.state, gameData).length > 0;
      s = endTurn(s, ds, rng, gameData);
    }
    expect(sawFile).toBe(true);
    expect(sawVenture).toBe(true);
  });

  it("refuse everything that costs money when the house has no free cash", () => {
    const s = newGame(gameData, createRng(2));
    s.house.cash = 0;
    for (const r of merchantRows(s, gameData)) {
      expect(r.actions.find((a) => a.kind === "report")!.blocked).toMatch(/cash/);
    }
    for (const room of houseRooms(s, gameData)) if (room.build) expect(room.build.blocked).toMatch(/cash/);
    checkScreens(s);
  });

  it("refuse everything for a bankrupt house", () => {
    const s = newGame(gameData, createRng(3));
    s.house.status = "bankrupt";
    for (const r of merchantRows(s, gameData)) for (const a of r.actions) expect(a.blocked).toBe("The house is bankrupt");
    checkScreens(s);
  });

  it("show a report without collateral and an inquiry with the partner's remark", () => {
    const s = newGame(gameData, createRng(4));
    const id = s.requests[0]!.borrower_id;
    const report = applyDecisions(s, [{ kind: "report", borrower: id }], gameData);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    const rDoc = merchantRows(report.state, gameData).find((m) => m.offer.borrower_id === id)!.doc!;
    expect(rDoc.age).toBe("bought this quarter");
    expect(rDoc.lines.map((l) => l.label)).not.toContain("Collateral");
    expect(rDoc.remark).toBeNull();
    const b = report.state.borrowers.find((x) => x.id === id)!;
    const iDoc = fileDoc({ ...b.file!, tier: "inquiry", collateral: 5000, true_profit: 900, remark: "steady" }, report.state.world.turn + 2, gameData);
    expect(iDoc.age).toBe("2 quarters old");
    expect(iDoc.lines.map((l) => l.label)).toContain("Collateral");
    expect(iDoc.remark).toBe(gameData.credit.remarks.steady);
  });

  it("counts a hire as starting next quarter and a dismissal as leaving", () => {
    const s = newGame(gameData, createRng(5));
    const r = applyDecisions(s, [{ kind: "hire", role: "clerk", candidate: 0 }, { kind: "dismiss", staff: 1 }], gameData);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const staff = houseRooms(r.state, gameData).find((x) => x.id === "counting_room")!.staff;
    expect(staff.find((m) => m.id === 1)!.status).toBe("leaving");
    expect(staff.some((m) => m.status === "starts")).toBe(true);
  });

  it("reads a trend toward the target, level within 2%", () => {
    expect(trendOf(10, 11)).toBe("up");
    expect(trendOf(10, 9)).toBe("down");
    expect(trendOf(10, 10.1)).toBe("level");
  });
});
