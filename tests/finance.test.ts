import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { bondBook } from "../src/sim/bonds";
import { applyDecision } from "../src/sim/decisions";
import { createHouses } from "../src/sim/houses";
import { accountBalance } from "../src/sim/ledger";
import { raiseCash } from "../src/sim/liquidity";
import { awardContracts, bidScore, closeContract, contractGate, placeContracts, placementRate, redeemBonds, announceContracts } from "../src/sim/finance/contracts";
import { drawHouseRequests, gratitude, rescueFactor, serviceHouseLoans } from "../src/sim/finance/houseLoans";
import { collateralLots, runAssets, settleAuctions } from "../src/sim/finance/auctions";
import { drawCoverRequests, rollStorm, settlePolicies } from "../src/sim/finance/insurance";
import type { Contract, CoverRequest, Lot } from "../src/sim/finance/types";
import { financeAccounts, financeBook, houseFailed } from "../src/sim/systems/finance";
import { netWorth } from "../src/sim/turn";
import type { GameData } from "../src/sim/tuning";
import type { Decision, GameState } from "../src/sim/types";
import { fixedRng, fresh, quiet } from "./helpers";

/** Quiet data with the real houses. */
const withHouses: GameData = { ...quiet, houses: gameData.houses };
const NEVER = 0.999999;

function withRealHouses(): GameState {
  const s = fresh();
  s.houses = createHouses(withHouses);
  return s;
}

function apply(s: GameState, d: Decision, data: GameData = quiet): GameState {
  const r = applyDecision(s, d, data);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

function reason(s: GameState, d: Decision, data: GameData = quiet): string {
  const r = applyDecision(s, d, data);
  if (r.ok) throw new Error("expected a refusal");
  return r.reason;
}

/** Every finance account, bonds and cash agree with their ledger. */
function expectReconciled(s: GameState) {
  for (const [account, balance] of Object.entries(financeAccounts(s))) expect(accountBalance(s, account as "assets")).toBe(balance);
  expect(accountBalance(s, "bonds")).toBe(bondBook(s));
  expect(accountBalance(s, "cash")).toBe(s.house.cash);
}

function contract(s: GameState, over: Partial<Contract> = {}): Contract {
  const c: Contract = {
    id: s.finance.next_id++, state: "bavaria", size: 200000, coupon: 0.05, term_years: 10, open_turn: s.world.turn, status: "open",
    player_bid: null, winner: null, commission: null, issue_price: null, placed: 0, quarters_placed: 0, caution: 0, carried: 0, ...over,
  };
  s.finance.contracts.push(c);
  return c;
}

describe("state loan contracts", () => {
  it("states announce loans more often in the post-war years, none in a panic", () => {
    const s = fresh();
    // 1815: 0.04 x 2 = 0.08 a state; rolls of 0.05 announce, then size, coupon, term.
    announceContracts(s, fixedRng(0.05, 0.5, 0, 0.5, 0.05, 0.5, 0, 0.5, 0.05, 0.5, 0, 0.5, 0.05, 0.5, 0, 0.5, 0.05, 0.5, 0, 0.5), gameData);
    expect(s.finance.contracts.map((c) => c.state)).toEqual(["prussia", "bavaria", "austria", "france", "naples"]);
    const prussia = s.finance.contracts[0]!;
    expect(prussia).toMatchObject({ size: 450000, coupon: 0.05, term_years: 15, open_turn: s.world.turn + 1, status: "open" });
    const p = fresh();
    p.world.sentiment = "panic";
    announceContracts(p, fixedRng(0), quiet);
    expect(p.finance.contracts).toEqual([]);
  });

  it("refuses a bid with no cash for the caution money, or too little reputation", () => {
    const s = fresh();
    const c = contract(s);
    s.house.cash = 0;
    expect(reason(s, { kind: "bid_contract", contract: c.id, commission: 0.02 })).toMatch(/caution money/);
    const t = fresh();
    const d = contract(t, { state: "prussia" });
    t.house.reputation = 30;
    expect(reason(t, { kind: "bid_contract", contract: d.id, commission: 0.02 })).toMatch(/reputation/);
    expect(reason(t, { kind: "bid_contract", contract: 999, commission: 0.02 })).toMatch(/No loan/);
  });

  it("refuses a commission not on the list, and a second bid", () => {
    const s = fresh();
    const c = contract(s);
    expect(reason(s, { kind: "bid_contract", contract: c.id, commission: 0.017 })).toMatch(/Commission must be/);
    const t = apply(s, { kind: "bid_contract", contract: c.id, commission: 0.02 });
    expect(reason(t, { kind: "bid_contract", contract: c.id, commission: 0.02 })).toMatch(/already bid/);
  });

  it("loses the contract to a house that asks less", () => {
    let s = withRealHouses();
    const c = contract(s);
    s = apply(s, { kind: "bid_contract", contract: c.id, commission: 0.05 }, withHouses);
    const cash = s.house.cash;
    const kessler = s.houses.find((h) => h.id === "kessler")!.wealth;
    // Kessler bids (0) at the bottom of its range (0): 1.5%. Every other house's roll misses.
    awardContracts(s, fixedRng(0, 0, NEVER), withHouses);
    const after = s.finance.contracts[0]!;
    expect(after).toMatchObject({ status: "lost", winner: "kessler", commission: 0.015 });
    expect(s.house.cash).toBe(cash);
    expect(s.houses.find((h) => h.id === "kessler")!.wealth).toBe(kessler + 3000);
    expect(s.news.at(-1)!.text).toMatch(/Your bid of 5% was passed over/);
  });

  it("weighs a better name against a lower commission", () => {
    // Ten points of reputation are worth 0.2% of commission.
    expect(bidScore(0.03, 70, quiet)).toBeCloseTo(bidScore(0.026, 50, quiet), 10);
  });

  it("a loan no house bids for is withdrawn", () => {
    const s = fresh();
    contract(s);
    awardContracts(s, fixedRng(0), quiet);
    expect(s.finance.contracts[0]!.status).toBe("unawarded");
  });

  it("wins, places over two calm quarters, keeps its commission and carries the rest", () => {
    let s = fresh();
    const c = contract(s);
    s = apply(s, { kind: "bid_contract", contract: c.id, commission: 0.02 });
    const cash0 = s.house.cash;
    awardContracts(s, fixedRng(0), quiet);
    const k = s.finance.contracts[0]!;
    expect(k).toMatchObject({ status: "placing", winner: "player", commission: 0.02, issue_price: 1, caution: 10000 });
    expect(s.house.cash).toBe(cash0 - 10000);
    expect(financeBook(s)).toBe(10000);
    expectReconciled(s);

    // Next quarter: rate 0.55 x (0.6 + 0.8 x 0.5) x (1 - 0.5 x 0.2) + 0.05 x 1 correspondent = 0.545.
    s.world.turn += 1;
    expect(placementRate(s, k, quiet)).toBeCloseTo(0.545, 6);
    placeContracts(s, fixedRng(0.5), quiet);
    expect(k.placed).toBe(109000);
    expect(s.house.cash).toBe(cash0 - 10000 + 2180);
    s.world.turn += 1;
    placeContracts(s, fixedRng(0.5), quiet);
    // 0.545 of the 91,000 left: 49,600 (to the 100). Closed: 158,600 placed, 41,400 carried at 0.98.
    expect(k).toMatchObject({ status: "closed", placed: 158600, carried: 41400, quarters_placed: 2, caution: 0 });
    const bond = s.bonds.at(-1)!;
    expect(bond).toMatchObject({ issuer_state: "bavaria", face_value: 41400, price: 0.98, coupon: 0.05 });
    expect(s.house.cash).toBe(cash0 - 10000 + 2180 + 992 + 10000 - 40572);
    // 79% placed: the bourse speaks well of it (+3).
    expect(s.house.reputation).toBe(53);
    expect(s.finance.redemptions).toEqual([{ bond: bond.id, turn: s.world.turn + 40 }]);
    expectReconciled(s);
  });

  it("an issue that sticks in a panic leaves the house carrying most of it, and costs reputation", () => {
    const s = fresh();
    const c = contract(s, { status: "placing", winner: "player", commission: 0.02, issue_price: 1, caution: 0, open_turn: 0 });
    s.house.cash = 500000;
    s.world.sentiment = "panic";
    placeContracts(s, fixedRng(0.5), quiet);
    placeContracts(s, fixedRng(0.5), quiet);
    expect(c.status).toBe("closed");
    // Panic: 0.1 x 1 x 0.9 + 0.05 = 0.14 a quarter, so about 74% is carried.
    expect(c.carried).toBe(147900);
    expect(s.house.reputation).toBe(47);
  });

  it("a carry the house cannot pay for bankrupts it", () => {
    const s = fresh();
    contract(s, { size: 600000, status: "placing", winner: "player", commission: 0.02, issue_price: 1, caution: 0, open_turn: 0, quarters_placed: 1 });
    s.world.sentiment = "panic";
    placeContracts(s, fixedRng(0.5), quiet);
    expect(s.house.status).toBe("bankrupt");
  });

  it("a state that defaults during placement takes the caution money with it", () => {
    let s = fresh();
    const c = contract(s);
    s = apply(s, { kind: "bid_contract", contract: c.id, commission: 0.02 });
    awardContracts(s, fixedRng(0), quiet);
    s.defaulted_states.push("bavaria");
    const k = s.finance.contracts[0]!;
    s.world.turn += 1;
    expect(placementRate(s, k, quiet)).toBe(0);
    closeContract(s, k, quiet);
    expect(k.status).toBe("closed");
    expect(s.bonds).toEqual([]);
    expect(financeBook(s)).toBe(0);
    expectReconciled(s);
  });

  it("redeems carried bonds at par when the term ends", () => {
    const s = fresh();
    const k = contract(s, { status: "placing", winner: "player", commission: 0.02, issue_price: 0.9, open_turn: 0, quarters_placed: 1, placed: 150000 });
    closeContract(s, k, quiet);
    const bond = s.bonds.at(-1)!;
    const cash = s.house.cash;
    s.world.turn = s.finance.redemptions[0]!.turn;
    redeemBonds(s, quiet);
    expect(bond.status).toBe("sold");
    expect(s.house.cash).toBe(cash + 50000);
    expect(s.finance.redemptions).toEqual([]);
    expectReconciled(s);
  });

  it("the contract gate adds the premium to the state's bond gate", () => {
    const s = fresh();
    const prussia = quiet.states.find((x) => x.id === "prussia")!;
    expect(contractGate(s, prussia, quiet)).toBe(65);
  });
});

describe("lending to other houses", () => {
  it("a house that has lost wealth asks in a panic, and not in a calm market", () => {
    const s = withRealHouses();
    const kessler = s.houses.find((h) => h.id === "kessler")!;
    kessler.wealth = 240000;
    drawHouseRequests(s, fixedRng(0), withHouses);
    expect(s.finance.house_requests).toEqual([]);
    s.world.sentiment = "panic";
    drawHouseRequests(s, fixedRng(0), withHouses);
    // Kessler dislikes the player (opinion -30): 8% + 12% + 4%.
    expect(s.finance.house_requests).toEqual([{ id: 1, house: "kessler", amount: 12000, max_rate: 0.24, term_quarters: 4, open_turn: s.world.turn + 1 }]);
  });

  it("lending at a fair price earns gratitude, interest and repayment; a high one is remembered", () => {
    let s = withRealHouses();
    s.world.sentiment = "panic";
    s.houses[0]!.wealth = 200000;
    drawHouseRequests(s, fixedRng(0), withHouses);
    s.world.turn += 1;
    const req = s.finance.house_requests[0]!;
    expect(reason(s, { kind: "lend_house", request: req.id, rate: 0.3 }, withHouses)).toMatch(/at most 24%/);
    const opinion = s.houses[0]!.opinion;
    s = apply(s, { kind: "lend_house", request: req.id, rate: 0.08 }, withHouses);
    expect(s.houses[0]!.opinion).toBe(opinion + 25);
    expect(rescueFactor(s, "kessler", withHouses)).toBe(0.5);
    expect(financeBook(s)).toBe(10000);
    const cash = s.house.cash;
    for (let i = 0; i < 4; i++) {
      s.world.turn += 1;
      serviceHouseLoans(s, withHouses);
    }
    expect(s.house.cash).toBe(cash + 4 * 200 + 10000);
    expect(s.finance.house_loans[0]!.status).toBe("repaid");
    expect(s.houses[0]!.opinion).toBe(opinion + 30);
    expectReconciled(s);
    expect(gratitude(0.15, withHouses)).toBe(-5);
  });

  it("refuses with no cash", () => {
    const s = withRealHouses();
    s.world.sentiment = "panic";
    drawHouseRequests(s, fixedRng(0), withHouses);
    s.world.turn += 1;
    s.house.cash = 0;
    expect(reason(s, { kind: "lend_house", request: s.finance.house_requests[0]!.id, rate: 0.08 }, withHouses)).toMatch(/Not enough cash/);
  });

  it("a house that fails while owing recovers a share from its estate, and its holdings go to auction", () => {
    let s = withRealHouses();
    s.world.sentiment = "panic";
    drawHouseRequests(s, fixedRng(0), withHouses);
    s.world.turn += 1;
    s = apply(s, { kind: "lend_house", request: s.finance.house_requests[0]!.id, rate: 0.1 }, withHouses);
    const cash = s.house.cash;
    const h = s.houses[0]!;
    h.failed_turn = s.world.turn;
    houseFailed(s, h, withHouses);
    // Panic: 20% of 15,000 back.
    expect(s.house.cash).toBe(cash + 3000);
    expect(s.finance.house_loans[0]!.status).toBe("failed");
    expect(financeBook(s)).toBe(0);
    // Warehouse, ships and broker's place; shares need a listed company (Danube bank lists in 1820).
    expect(s.finance.lots.map((l) => l.kind)).toEqual(["warehouse", "ship", "broker_place"]);
    expect(s.finance.lots[0]!.appraisal).toBe(36000);
    expectReconciled(s);
  });
});

function lot(s: GameState, over: Partial<Lot> = {}): Lot {
  const l: Lot = { id: s.finance.next_id++, kind: "warehouse", name: "A test warehouse", appraisal: 20000, source: "Test", open_turn: s.world.turn, player_bid: null, ...over };
  s.finance.lots.push(l);
  return l;
}

describe("bankruptcy auctions", () => {
  it("a lot no one bids for is sold for scrap", () => {
    const s = fresh();
    lot(s);
    const worth = netWorth(s);
    settleAuctions(s, fixedRng(0), quiet);
    expect(s.finance.lots).toEqual([]);
    expect(s.finance.assets).toEqual([]);
    expect(netWorth(s)).toBe(worth);
    expect(s.news.at(-1)!.text).toMatch(/No one bid/);
  });

  it("a bargain for the house that kept cash: paid at the bid, counted at the appraisal", () => {
    let s = fresh();
    const l = lot(s);
    s = apply(s, { kind: "bid_lot", lot: l.id, bid: 0.4 });
    const worth = netWorth(s);
    settleAuctions(s, fixedRng(0), quiet);
    expect(s.finance.assets).toMatchObject([{ kind: "warehouse", appraisal: 20000, paid: 8000 }]);
    expect(netWorth(s)).toBe(worth + 12000);
    expectReconciled(s);
  });

  it("a richer house outbids a low bid", () => {
    let s = withRealHouses();
    const l = lot(s);
    s = apply(s, { kind: "bid_lot", lot: l.id, bid: 0.3 }, withHouses);
    // Kessler bids (0) at 75% with noise (0.5): 15,000.
    settleAuctions(s, fixedRng(0, 0.5, NEVER), withHouses);
    expect(s.finance.assets).toEqual([]);
    expect(s.news.at(-1)!.text).toMatch(/Bankhaus Kessler bought A test warehouse for 15,000 fl\. .*Your bid was not enough/);
  });

  it("refuses a bid above free cash, and a second broker's place", () => {
    const s = fresh();
    const l = lot(s, { appraisal: 500000 });
    expect(reason(s, { kind: "bid_lot", lot: l.id, bid: 0.5 })).toMatch(/Not enough cash/);
    s.finance.assets.push({ id: 99, kind: "broker_place", name: "A place", appraisal: 5000, paid: 3000, bought_turn: 0 });
    const b = lot(s, { kind: "broker_place" });
    expect(reason(s, { kind: "bid_lot", lot: b.id, bid: 0.5 })).toMatch(/already has a broker's place/);
  });

  it("a defaulted commercial loan's collateral goes to auction next quarter", () => {
    const s = fresh();
    s.loans.push({ id: 1, borrower_id: 1, borrower_name: "Poor and Co.", kind: "commercial", principal: 10000, rate: 0.1, quality: 0.3, start_turn: 1, term_quarters: 4, status: "defaulted" });
    s.borrowers[0]!.books.collateral = 30000;
    collateralLots(s, gameData);
    expect(s.finance.lots).toMatchObject([{ kind: "warehouse", appraisal: 15000, source: "Poor and Co.", open_turn: s.world.turn + 1 }]);
    collateralLots(s, gameData);
    expect(s.finance.lots).toHaveLength(1);
  });

  it("assets earn, can be lost, and are sold in a bank run", () => {
    const s = fresh();
    s.finance.assets.push({ id: 1, kind: "ship", name: "Barges", appraisal: 40000, paid: 20000, bought_turn: 0 });
    s.finance.assets.push({ id: 2, kind: "warehouse", name: "Store", appraisal: 20000, paid: 10000, bought_turn: 0 });
    // Seed the ledger as a purchase would.
    s.ledger.push({ id: 9000, turn: 0, account: "assets", category: "auction_purchase", amount: 60000, note: "test" });
    const cash = s.house.cash;
    runAssets(s, fixedRng(NEVER), quiet, 1);
    // Freight 12% a year, rent 6%.
    expect(s.house.cash).toBe(cash + 1200 + 300);
    // In winter (Q1) the ship's chance doubles: 0.03; a roll of 0.02 sinks it.
    runAssets(s, fixedRng(0.02, NEVER), quiet, 1);
    expect(s.finance.assets.map((a) => a.id)).toEqual([2]);
    const before = s.house.cash;
    const raised = raiseCash(s, 5000, quiet.tuning, "to test");
    expect(raised).toBe(14000);
    expect(s.house.cash).toBe(before + 14000);
    expectReconciled(s);
  });

  it("selling an asset fetches its appraisal less the discount", () => {
    const s = fresh();
    s.finance.assets.push({ id: 1, kind: "warehouse", name: "Store", appraisal: 20000, paid: 10000, bought_turn: 0 });
    const t = apply(s, { kind: "sell_asset", asset: 1 });
    expect(t.house.cash).toBe(s.house.cash + 17000);
    expect(t.finance.assets).toEqual([]);
  });
});

function cover(s: GameState, over: Partial<CoverRequest> = {}): CoverRequest {
  const r: CoverRequest = { id: s.finance.next_id++, kind: "ship", insured: "Good and Co.", what: "Fortuna", value: 20000, quarters: 1, premium_rate: 0.056, open_turn: s.world.turn, ...over };
  s.finance.cover_requests.push(r);
  return r;
}

describe("insurance underwriting", () => {
  it("draws requests priced at the expected loss plus the load", () => {
    const s = fresh();
    s.world.quarter = 4;
    // Ship (0.1), insured, name, value (0.5).
    drawCoverRequests(s, fixedRng(0.1, 0, 0, 0.5, 0.9, 0, 0, 0.5), gameData);
    expect(s.finance.cover_requests).toMatchObject([
      { kind: "ship", what: "Hoffnung", value: 17500, quarters: 1, premium_rate: 0.056 },
      { kind: "warehouse", what: "Frankfurt", value: 22500, quarters: 4, premium_rate: 0.014 },
    ]);
  });

  it("takes the premium at once for its line, and pays nothing when the ship comes home", () => {
    let s = fresh();
    const r = cover(s);
    expect(reason(s, { kind: "underwrite", request: r.id, line: 0.3 })).toMatch(/A line must be/);
    const cash = s.house.cash;
    s = apply(s, { kind: "underwrite", request: r.id, line: 0.5 });
    expect(s.house.cash).toBe(cash + 560);
    settlePolicies(s, fixedRng(NEVER), quiet, 1);
    expect(s.finance.policies[0]!.status).toBe("expired");
    expect(s.house.cash).toBe(cash + 560);
  });

  it("a great storm makes every ship likelier to founder", () => {
    const s = fresh();
    s.world.quarter = 1;
    expect(rollStorm(s, fixedRng(0.07), gameData)).toBe(gameData.finance.insurance.storm.ship_factor);
    expect(s.finance.storm_turn).toBe(s.world.turn);
    s.world.quarter = 2;
    expect(rollStorm(s, fixedRng(0.07), gameData)).toBe(1);
  });

  it("a big claim sells assets and, when that is not enough, bankrupts the house", () => {
    let s = fresh();
    const r = cover(s, { value: 400000 });
    s = apply(s, { kind: "underwrite", request: r.id, line: 1 });
    s.house.cash = 50000;
    // Lost (0), with no salvage (0).
    settlePolicies(s, fixedRng(0, 0), quiet, 1);
    expect(s.house.status).toBe("bankrupt");
  });

  it("a claim within the house's means is paid", () => {
    let s = fresh();
    const r = cover(s, { kind: "warehouse", what: "Mainz", quarters: 4 });
    s = apply(s, { kind: "underwrite", request: r.id, line: 1 });
    const cash = s.house.cash;
    // Burns (0); half the value (0.2857 of the way from 0.3 to 1 is 0.5).
    settlePolicies(s, fixedRng(0, 2 / 7), quiet, 1);
    expect(s.house.cash).toBe(cash - 10000);
    expect(s.finance.policies[0]!.status).toBe("claimed");
    expectReconciled(s);
  });

  it("the great fire of Hamburg, May 1842, burns half the insured warehouses there", () => {
    let s = fresh();
    s.world.year = 1842;
    s.world.quarter = 2;
    const r = cover(s, { kind: "warehouse", what: "Hamburg", quarters: 4 });
    s = apply(s, { kind: "underwrite", request: r.id, line: 1 });
    settlePolicies(s, fixedRng(0.4, 0), quiet, 1);
    expect(s.finance.policies[0]!.status).toBe("claimed");
    expect(s.news.some((n) => n.title === "The great fire of Hamburg")).toBe(true);
  });
});
