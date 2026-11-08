// The counting house (milestone A2): staff and facilities, their wages and upkeep, and the advisor
// council. Staff give the house its capacity (src/sim/capacity.ts); facilities change how the rest
// of the game treats the house, through the small functions near the end of this file that other
// systems call. Numbers live in data/counting.json; capacity per staff member in data/tuning.json.
import type { DecisionResult } from "../actions";
import { checkCapacity, useCapacity, workingCount } from "../capacity";
import { depositLevel } from "../deposits";
import { headOf, isTrained, livingSpouse, successor } from "../family";
import { fl } from "../format";
import { addEntry } from "../ledger";
import { raiseCash } from "../liquidity";
import { freeCash } from "../reserves";
import type { Rng } from "../rng";
import { withdrawalDemand } from "../sentiment";
import { cloneState } from "../state";
import type { GameData } from "../tuning";
import type { Borrower, Decision, GameState } from "../types";

export type StaffRole = "clerk" | "correspondent" | "analyst" | "teller" | "partner";
export const STAFF_ROLES: StaffRole[] = ["clerk", "correspondent", "analyst", "teller", "partner"];
export type FacilityId = "strongroom" | "archive" | "courier_stable" | "reception_rooms" | "warehouse";
export const FACILITY_IDS: FacilityId[] = ["strongroom", "archive", "courier_stable", "reception_rooms", "warehouse"];
export type RoomSize = "small" | "medium" | "large";
export type AdvisorRole = "chief_clerk" | "head_correspondent" | "spouse";
export type AdviceTopic = "liquidity" | "market" | "family";
export type Verdict = "sound" | "doubtful" | "unsound";
export const VERDICTS: Verdict[] = ["sound", "doubtful", "unsound"];

export interface RoleData {
  name: string;
  description: string;
  /** Paid every quarter the member works. */
  wage: number;
  /** Needs a desk in the counting room. */
  desk: boolean;
  /** Most the house may employ, or null for no limit but the desks. */
  max: number | null;
}

export interface RoomData {
  size: RoomSize;
  name: string;
  desks: number;
  /** Cost to build, from the room before it. The small room is owned at the start. */
  build: number;
  upkeep: number;
}

export interface FacilityData {
  name: string;
  description: string;
  build: number;
  upkeep: number;
}

export interface StaffTrait {
  id: string;
  name: string;
  description: string;
  /** Scales an advisor's chance of seeing trouble that is not there. */
  false_alarm: number;
  /** Scales an advisor's chance of missing trouble that is there. */
  missed: number;
  /** Added to an analyst's chance of a right opinion. */
  accuracy: number;
}

/** data/counting.json */
export interface CountingData {
  /** The house at the start: its room and its staff, fixed like the founding family. */
  start: { room: RoomSize; staff: (Candidate & { role: StaffRole })[] };
  roles: Record<StaffRole, RoleData>;
  /** A new member's skill is drawn from min to max; it rises one point per quarters_per_point served, up to cap. */
  skill: { min: number; max: number; cap: number; quarters_per_point: number };
  candidates_per_role: number;
  rooms: RoomData[];
  facilities: Record<FacilityId, FacilityData>;
  effects: {
    /** Panic withdrawals are scaled by this with a strongroom. */
    strongroom_panic_withdrawals: number;
    /** With a strongroom, calm quarters draw deposits toward the reputation's level times this. */
    strongroom_deposit_level: number;
    /** With reception rooms, at each year end every trading house's opinion rises by this... */
    reception_yearly_opinion: number;
    /** ...and its baseline (where opinion drifts back to) by this, up to reception_baseline_ceiling. */
    reception_yearly_baseline: number;
    reception_baseline_ceiling: number;
    /** With a courier stable, bonds are bought this share below the market price (the gap is booked as a gain). */
    courier_bond_edge: number;
    /** Quarters of payment records kept, without and with an archive (for the credit system). */
    record_quarters: number;
    archive_record_quarters: number;
    /** Lots of goods a warehouse stores (for the markets system). */
    warehouse_space: number;
    reception_court_opinion: number;
    /** Houses agree to marriages at this much less opinion with reception rooms. */
    reception_marriage_opinion: number;
    /** Courting and marriage costs are scaled by this with a partner. */
    partner_cost_factor: number;
    partner_court_opinion: number;
    /** Each correspondent after the first takes this share off report costs, up to the max. */
    correspondent_report_discount: number;
    correspondent_max_discount: number;
    /** Each teller adds this to the share of the deposit gap closed in a calm quarter. */
    teller_catch_up: number;
  };
  analysts: { base_accuracy: number; per_skill: number; min_accuracy: number; max_accuracy: number; sound_from: number; doubtful_from: number };
  traits: StaffTrait[];
  /** The head's spouse advises coloured by their family trait: trait id to staff trait id. */
  spouse_traits: Record<string, string>;
  advice: {
    /** False silences the council (and its rolls), for unit tests of other systems. */
    enabled: boolean;
    /** An advisor's chance of reading their topic wrong: base_error less per_skill per point, at least min_error, before traits. */
    base_error: number;
    per_skill: number;
    min_error: number;
    /** Quarters between an advisor's warnings. */
    cooldown_quarters: number;
    /** Every advisor writes a routine letter before this quarter. */
    routine_quarter: number;
    letters: {
      liquidity: { alarm: string; calm: string };
      market: { alarm: string; calm: string };
      family: { alarm: string; calm: string; none: string };
    };
  };
  names: { first: string[]; surnames: string[] };
}

/** Someone the house could hire this quarter. */
export interface Candidate {
  name: string;
  skill: number;
  trait: string;
}

export interface Staff extends Candidate {
  id: number;
  role: StaffRole;
  hired_turn: number;
  /** The first quarter they work and are paid. */
  start_turn: number;
  /** Dismissed: works out this quarter and leaves at End Turn. */
  leaving: boolean;
}

export interface Facility {
  id: FacilityId;
  /** Built this turn's quarter; working from ready_turn. */
  ready_turn: number;
}

/** An analyst's written opinion on a borrower this quarter. */
export interface Opinion {
  turn: number;
  borrower: number;
  /** Staff id of the analyst who wrote it. */
  analyst: number;
  verdict: Verdict;
  /** Never shown to the player: for tests and the harness. */
  correct: boolean;
}

/** A letter from an advisor, written at End Turn for the quarter that follows. */
export interface Advice {
  turn: number;
  advisor: AdvisorRole;
  name: string;
  topic: AdviceTopic;
  /** The advisor warns of trouble. */
  alarm: boolean;
  /** Whether the advisor read it right. Never shown to the player. */
  correct: boolean;
  text: string;
}

/** state.counting */
export interface CountingState {
  room: RoomSize;
  /** A larger room being built, ready from ready_turn. */
  room_building: { size: RoomSize; ready_turn: number } | null;
  facilities: Facility[];
  staff: Staff[];
  next_staff_id: number;
  /** Who could be hired this quarter, by role. Drawn afresh at each End Turn. */
  candidates: Record<StaffRole, Candidate[]>;
  /** Capacity used this quarter, by pool. */
  used: Record<"deals" | "reports" | "opinions" | "head", number>;
  /** Draws for this quarter's analyst opinions, rolled at the End Turn before, so an opinion cannot be re-rolled. */
  opinion_draws: number[];
  opinions: Opinion[];
  /** The letters advisors wrote at the last End Turn. */
  advice: Advice[];
  /** The turn each advisor last wrote. */
  last_letter: Partial<Record<AdvisorRole, number>>;
  /** The panic warning running at the last End Turn has had a quarter to reach the house (see warningKnown). */
  warning_heard: boolean;
}

export interface HireDecision {
  kind: "hire";
  role: StaffRole;
  /** Index into this quarter's candidates for the role. */
  candidate: number;
}

export interface DismissDecision {
  kind: "dismiss";
  /** Staff id. */
  staff: number;
}

/** Build a facility, or "counting_room" to build the next larger room. */
export interface BuildDecision {
  kind: "build";
  facility: FacilityId | "counting_room";
}

/** Ask an analyst for a written opinion on a borrower who is asking for a loan this quarter. */
export interface ConsultAnalystDecision {
  kind: "consult_analyst";
  borrower: number;
}

export type CountingDecision = HireDecision | DismissDecision | BuildDecision | ConsultAnalystDecision;
export type CountingCategory = "wages" | "upkeep" | "building";

const COUNTING_KINDS: ReadonlySet<string> = new Set(["hire", "dismiss", "build", "consult_analyst"]);

// ---------- Staff ----------

/** "a strongroom", "an archive". */
const article = (name: string) => `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;

function draw(rng: Rng, n: number): number {
  return Math.min(n - 1, Math.floor(rng.next() * n));
}

/** A candidate: four rolls (first name, surname, skill, trait). */
export function drawCandidate(rng: Rng, data: GameData): Candidate {
  const c = data.counting;
  const first = c.names.first[draw(rng, c.names.first.length)]!;
  const surname = c.names.surnames[draw(rng, c.names.surnames.length)]!;
  const skill = c.skill.min + draw(rng, c.skill.max - c.skill.min + 1);
  const trait = c.traits[draw(rng, c.traits.length)]!.id;
  return { name: `${first} ${surname}`, skill, trait };
}

function drawCandidates(rng: Rng, data: GameData): Record<StaffRole, Candidate[]> {
  const n = data.counting.candidates_per_role;
  const out = {} as Record<StaffRole, Candidate[]>;
  for (const role of STAFF_ROLES) out[role] = Array.from({ length: n }, () => drawCandidate(rng, data));
  return out;
}

/** A member's skill this turn: their drawn skill plus a point per quarters_per_point served, up to the cap. */
export function skillOf(m: Pick<Staff, "skill" | "start_turn">, turn: number, data: GameData): number {
  const s = data.counting.skill;
  return Math.min(s.cap, m.skill + Math.floor(Math.max(0, turn - m.start_turn) / s.quarters_per_point));
}

export function traitOf(id: string, data: GameData): StaffTrait | undefined {
  return data.counting.traits.find((t) => t.id === id);
}

/** Staff working this quarter, by role. */
export function working(state: GameState, role?: StaffRole): Staff[] {
  return state.counting.staff.filter((m) => m.start_turn <= state.world.turn && (!role || m.role === role));
}

/** Staff who will work next quarter (staying on, or hired this quarter). */
function nextQuarterStaff(state: GameState): Staff[] {
  return state.counting.staff.filter((m) => !m.leaving);
}

// ---------- Rooms and facilities ----------

export function roomData(size: RoomSize, data: GameData): RoomData {
  return data.counting.rooms.find((r) => r.size === size)!;
}

/** The next larger room, or undefined at the largest. */
export function nextRoom(size: RoomSize, data: GameData): RoomData | undefined {
  const rooms = data.counting.rooms;
  return rooms[rooms.findIndex((r) => r.size === size) + 1];
}

/** Desks next quarter: the room being built counts, since a hire starts then too. */
function desksNextQuarter(state: GameState, data: GameData): number {
  return roomData(state.counting.room_building?.size ?? state.counting.room, data).desks;
}

/** Desks in use next quarter. */
export function desksTaken(state: GameState, data: GameData): number {
  return nextQuarterStaff(state).filter((m) => data.counting.roles[m.role].desk).length;
}

/** The facility is built and working this quarter. */
export function hasFacility(state: GameState, id: FacilityId): boolean {
  return state.counting.facilities.some((f) => f.id === id && f.ready_turn <= state.world.turn);
}

/** The facility is built or being built. */
function ownsFacility(state: GameState, id: FacilityId): boolean {
  return state.counting.facilities.some((f) => f.id === id);
}

/** Wages due this quarter, in whole gulden. */
export function wageBill(state: GameState, data: GameData): number {
  return working(state).reduce((sum, m) => sum + data.counting.roles[m.role].wage, 0);
}

/** Upkeep due this quarter: the room and every working facility. */
export function upkeepBill(state: GameState, data: GameData): number {
  const room = roomData(state.counting.room, data).upkeep;
  return room + FACILITY_IDS.filter((id) => hasFacility(state, id)).reduce((sum, id) => sum + data.counting.facilities[id].upkeep, 0);
}

// ---------- Starting state ----------

/** The starting room and staff from the data (working from turn 1), then the first candidates (four rolls each). */
export function createCounting(data: GameData, rng: Rng): CountingState {
  const c = data.counting;
  const staff: Staff[] = c.start.staff.map((m, i) => ({ ...m, id: i + 1, hired_turn: 0, start_turn: 0, leaving: false }));
  return {
    room: c.start.room,
    room_building: null,
    facilities: [],
    staff,
    next_staff_id: staff.length + 1,
    candidates: drawCandidates(rng, data),
    used: { deals: 0, reports: 0, opinions: 0, head: 0 },
    opinion_draws: [],
    opinions: [],
    advice: [],
    last_letter: {},
    warning_heard: false,
  };
}

// ---------- Decisions ----------

export const isCountingDecision = (d: Decision): d is CountingDecision => COUNTING_KINDS.has(d.kind);

export function checkHire(state: GameState, d: HireDecision, data: GameData): string | null {
  const noAction = checkCapacity(state, "hire", data.tuning);
  if (noAction) return noAction;
  const role = data.counting.roles[d.role];
  if (!role) return `Unknown role "${d.role}"`;
  const candidate = state.counting.candidates[d.role]?.[d.candidate];
  if (!candidate) return `No such candidate for ${role.name.toLowerCase()} this quarter`;
  const count = nextQuarterStaff(state).filter((m) => m.role === d.role).length;
  if (role.max !== null && count >= role.max) return `The house has as many of that post as it may (${role.max})`;
  if (role.desk && desksTaken(state, data) >= desksNextQuarter(state, data))
    return `No desk free in the counting room (${desksNextQuarter(state, data)} desks): build a larger room`;
  return null;
}

/** Hires a candidate, who starts work (and is paid) next quarter. Free: uses no capacity. */
function hire(state: GameState, d: HireDecision, data: GameData): DecisionResult {
  const reason = checkHire(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const c = next.counting;
  const [candidate] = c.candidates[d.role].splice(d.candidate, 1);
  c.staff.push({ ...candidate!, id: c.next_staff_id++, role: d.role, hired_turn: next.world.turn, start_turn: next.world.turn + 1, leaving: false });
  useCapacity(next, "hire", data.tuning);
  return { ok: true, state: next };
}

export function checkDismiss(state: GameState, d: DismissDecision, data: GameData): string | null {
  const noAction = checkCapacity(state, "dismiss", data.tuning);
  if (noAction) return noAction;
  const m = state.counting.staff.find((x) => x.id === d.staff);
  if (!m) return `No member of staff #${d.staff}`;
  if (m.leaving) return `${m.name} is already leaving`;
  return null;
}

/** Dismisses a member: one hired this quarter never starts; others work out the quarter (and are paid for it), then leave. */
function dismiss(state: GameState, d: DismissDecision, data: GameData): DecisionResult {
  const reason = checkDismiss(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const c = next.counting;
  const m = c.staff.find((x) => x.id === d.staff)!;
  if (m.start_turn > next.world.turn) c.staff = c.staff.filter((x) => x.id !== m.id);
  else m.leaving = true;
  useCapacity(next, "dismiss", data.tuning);
  return { ok: true, state: next };
}

/** What a build decision would cost, or null if there is nothing to build. */
export function buildCost(state: GameState, facility: BuildDecision["facility"], data: GameData): number | null {
  if (facility === "counting_room") return nextRoom(state.counting.room_building?.size ?? state.counting.room, data)?.build ?? null;
  return data.counting.facilities[facility]?.build ?? null;
}

export function checkBuild(state: GameState, d: BuildDecision, data: GameData): string | null {
  const noAction = checkCapacity(state, "build", data.tuning);
  if (noAction) return noAction;
  if (d.facility === "counting_room") {
    if (state.counting.room_building) return "A larger counting room is already being built";
    if (!nextRoom(state.counting.room, data)) return "The counting room is as large as it can be";
  } else {
    if (!data.counting.facilities[d.facility]) return `Unknown facility "${d.facility}"`;
    if (ownsFacility(state, d.facility)) return `The house already has ${article(data.counting.facilities[d.facility].name.toLowerCase())}`;
  }
  const cost = buildCost(state, d.facility, data)!;
  if (cost > freeCash(state)) return `Not enough cash above the reserve (cost ${fl(cost)}, free ${fl(freeCash(state))})`;
  return null;
}

/** Builds a facility or the next larger room: paid now, working from next quarter. Free: uses no capacity. */
function build(state: GameState, d: BuildDecision, data: GameData): DecisionResult {
  const reason = checkBuild(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const c = next.counting;
  const cost = buildCost(next, d.facility, data)!;
  const ready_turn = next.world.turn + 1;
  let name: string;
  if (d.facility === "counting_room") {
    const room = nextRoom(c.room, data)!;
    c.room_building = { size: room.size, ready_turn };
    name = room.name.toLowerCase();
  } else {
    c.facilities.push({ id: d.facility, ready_turn });
    name = data.counting.facilities[d.facility].name.toLowerCase();
  }
  next.house.cash -= cost;
  addEntry(next, "cash", "building", -cost, `Building ${article(name)}`);
  useCapacity(next, "build", data.tuning);
  return { ok: true, state: next };
}

/**
 * What the borrower's books truly say. Stands in for the credit system's books (milestone A1) until
 * they exist: today it reads the borrower's hidden quality.
 */
export function bookVerdict(b: Pick<Borrower, "quality">, data: GameData): Verdict {
  const a = data.counting.analysts;
  return b.quality >= a.sound_from ? "sound" : b.quality >= a.doubtful_from ? "doubtful" : "unsound";
}

/** An analyst's chance of a right opinion: base plus per_skill per point plus their trait, within the bounds. */
export function analystAccuracy(m: Pick<Staff, "skill" | "start_turn" | "trait">, turn: number, data: GameData): number {
  const a = data.counting.analysts;
  const raw = a.base_accuracy + a.per_skill * skillOf(m, turn, data) + (traitOf(m.trait, data)?.accuracy ?? 0);
  return Math.min(a.max_accuracy, Math.max(a.min_accuracy, raw));
}

/**
 * An opinion from the truth, the analyst's accuracy and one draw in [0, 1): right below `accuracy`;
 * otherwise one of the two wrong verdicts, split evenly over the rest of the draw.
 */
export function analystOpinion(truth: Verdict, accuracy: number, d: number): Verdict {
  if (d < accuracy) return truth;
  const wrong = VERDICTS.filter((v) => v !== truth);
  return (d - accuracy) / (1 - accuracy) < 0.5 ? wrong[0]! : wrong[1]!;
}

/** Working analysts in the order they take requests: most skilled first, then by id. */
function analystsInOrder(state: GameState, data: GameData): Staff[] {
  const turn = state.world.turn;
  return working(state, "analyst").sort((a, b) => skillOf(b, turn, data) - skillOf(a, turn, data) || a.id - b.id);
}

export function checkConsult(state: GameState, d: ConsultAnalystDecision, data: GameData): string | null {
  const noAction = checkCapacity(state, "consult_analyst", data.tuning);
  if (noAction) return noAction;
  if (!state.requests.some((r) => r.borrower_id === d.borrower)) return `Borrower #${d.borrower} is not asking for a loan this quarter`;
  if (state.counting.opinions.some((o) => o.borrower === d.borrower && o.turn === state.world.turn)) return "An analyst has already written on that borrower this quarter";
  if (state.counting.opinion_draws[state.counting.used.opinions] === undefined) return "No analyst is free this quarter: hire an analyst or wait";
  return null;
}

/** An analyst writes an opinion on the borrower's books: right more often with skill. Draws nothing (see opinion_draws). */
function consultAnalyst(state: GameState, d: ConsultAnalystDecision, data: GameData): DecisionResult {
  const reason = checkConsult(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const c = next.counting;
  const turn = next.world.turn;
  const analyst = analystsInOrder(next, data)[Math.floor(c.used.opinions / data.tuning.capacity.per_analyst)]!;
  const borrower = next.borrowers.find((b) => b.id === d.borrower)!;
  const truth = bookVerdict(borrower, data);
  const verdict = analystOpinion(truth, analystAccuracy(analyst, turn, data), c.opinion_draws[c.used.opinions]!);
  c.opinions.push({ turn, borrower: borrower.id, analyst: analyst.id, verdict, correct: verdict === truth });
  useCapacity(next, "consult_analyst", data.tuning);
  return { ok: true, state: next };
}

export function applyCountingDecision(state: GameState, d: CountingDecision, data: GameData): DecisionResult {
  switch (d.kind) {
    case "hire":
      return hire(state, d, data);
    case "dismiss":
      return dismiss(state, d, data);
    case "build":
      return build(state, d, data);
    case "consult_analyst":
      return consultAnalyst(state, d, data);
  }
}

export function describeCountingDecision(d: CountingDecision, state: GameState, data: GameData): string {
  switch (d.kind) {
    case "hire": {
      const c = state.counting.candidates[d.role]?.[d.candidate];
      const role = data.counting.roles[d.role];
      return `Hire ${c?.name ?? "a candidate"} as ${role.name.toLowerCase()} (${fl(role.wage)} a quarter, from next quarter)`;
    }
    case "dismiss": {
      const m = state.counting.staff.find((x) => x.id === d.staff);
      return `Dismiss ${m ? `${m.name}, ${data.counting.roles[m.role].name.toLowerCase()}` : `staff #${d.staff}`}`;
    }
    case "build": {
      const cost = buildCost(state, d.facility, data) ?? 0;
      const name = d.facility === "counting_room" ? (nextRoom(state.counting.room, data)?.name ?? "a larger counting room") : data.counting.facilities[d.facility].name;
      return `Build ${article(name.toLowerCase())} for ${fl(cost)}`;
    }
    case "consult_analyst": {
      const b = state.borrowers.find((x) => x.id === d.borrower);
      return `Ask an analyst for an opinion on ${b?.name ?? `borrower #${d.borrower}`}`;
    }
  }
}

// ---------- Advisors ----------

export interface Advisor {
  role: AdvisorRole;
  name: string;
  skill: number;
  trait: StaffTrait | undefined;
  topic: AdviceTopic;
}

export const ADVISOR_TITLES: Record<AdvisorRole, string> = {
  chief_clerk: "the chief clerk",
  head_correspondent: "the head correspondent",
  spouse: "the head's spouse",
};

/** The longest serving working member of a role (earliest start, then id). */
function senior(state: GameState, role: StaffRole): Staff | undefined {
  return working(state, role).sort((a, b) => a.start_turn - b.start_turn || a.id - b.id)[0];
}

/** The advisor council as it stands: the chief clerk, the head correspondent and the head's spouse, each if there is one. */
export function advisors(state: GameState, data: GameData): Partial<Record<AdvisorRole, Advisor>> {
  const out: Partial<Record<AdvisorRole, Advisor>> = {};
  const turn = state.world.turn;
  const clerk = senior(state, "clerk");
  if (clerk) out.chief_clerk = { role: "chief_clerk", name: clerk.name, skill: skillOf(clerk, turn, data), trait: traitOf(clerk.trait, data), topic: "liquidity" };
  const corr = senior(state, "correspondent");
  if (corr) out.head_correspondent = { role: "head_correspondent", name: corr.name, skill: skillOf(corr, turn, data), trait: traitOf(corr.trait, data), topic: "market" };
  const head = headOf(state);
  const spouse = head && livingSpouse(state, head);
  if (spouse) {
    const traitId = spouse.traits.map((t) => data.counting.spouse_traits[t]).find((t) => t !== undefined);
    out.spouse = { role: "spouse", name: spouse.name, skill: spouse.prudence, trait: traitId ? traitOf(traitId, data) : undefined, topic: "family" };
  }
  return out;
}

/** The truth of an advisor's topic: whether there is trouble. */
export function topicTrouble(state: GameState, topic: AdviceTopic, data: GameData): boolean {
  switch (topic) {
    case "liquidity": {
      const { house } = state;
      const panicAsk = withdrawalDemand(house.deposits, "panic", data.tuning, house.reputation) * strongroomFactor(state, data);
      return house.cash < panicAsk;
    }
    case "market":
      return state.panic_warning !== null;
    case "family": {
      const heir = successor(state, data);
      return !!heir && !isTrained(heir, state.world.year, data);
    }
  }
}

/** An advisor's chance of reading their topic wrong, given the truth. */
export function adviceError(a: Pick<Advisor, "skill" | "trait">, trouble: boolean, data: GameData): number {
  const c = data.counting.advice;
  const base = Math.max(c.min_error, c.base_error - c.per_skill * a.skill);
  const tilt = a.trait ? (trouble ? a.trait.missed : a.trait.false_alarm) : 1;
  return Math.min(0.9, base * tilt);
}

/**
 * Each advisor reads their topic (one roll each, in council order, whether or not the seat is
 * filled), sometimes wrongly. They write before the routine quarter, and otherwise when they see
 * trouble and have not written for cooldown_quarters. Letters go to the news. Mutates `state`.
 */
function writeAdvice(state: GameState, rng: Rng, data: GameData): void {
  const c = state.counting;
  const cfg = data.counting.advice;
  const turn = state.world.turn;
  const nextQuarter = (state.world.quarter % 4) + 1;
  const council = advisors(state, data);
  c.advice = [];
  if (!cfg.enabled) return;
  for (const role of ["chief_clerk", "head_correspondent", "spouse"] as AdvisorRole[]) {
    const roll = rng.next();
    const a = council[role];
    if (!a) continue;
    let text: string;
    let alarm: boolean;
    let correct = true;
    const heir = a.topic === "family" ? successor(state, data) : undefined;
    if (a.topic === "family" && !heir) {
      alarm = true;
      text = cfg.letters.family.none;
    } else {
      const trouble = topicTrouble(state, a.topic, data);
      correct = roll >= adviceError(a, trouble, data);
      alarm = correct ? trouble : !trouble;
      text = cfg.letters[a.topic][alarm ? "alarm" : "calm"].replace("{heir}", heir?.name ?? "");
    }
    const last = c.last_letter[role];
    const routine = nextQuarter === cfg.routine_quarter;
    const warn = alarm && (last === undefined || turn - last >= cfg.cooldown_quarters);
    if (!routine && !warn) continue;
    c.last_letter[role] = turn;
    c.advice.push({ turn, advisor: role, name: a.name, topic: a.topic, alarm, correct, text });
    state.news.push({ turn, kind: "letter", title: `From ${ADVISOR_TITLES[role]}, ${a.name}`, text });
  }
}

// ---------- End Turn ----------

/**
 * The counting house's End Turn step, after debts are serviced and before depositors withdraw:
 * 1. notes whether a running panic warning has reached the house, 2. pays wages to working staff
 * and upkeep on the room and working facilities (selling assets at a discount if cash is short; a
 * house that still cannot pay is bankrupt), 3. in a calm market, tellers draw extra deposits,
 * 4. those dismissed leave and a larger room being built opens, 5. advisors write (three rolls),
 * 6. next quarter's candidates are drawn (four rolls each) and its opinion draws rolled (one per
 * opinion the analysts can write). Mutates `state`.
 */
export function resolveCounting(state: GameState, rng: Rng, data: GameData): void {
  const { house } = state;
  if (house.status === "bankrupt") return;
  const c = state.counting;
  const turn = state.world.turn;
  c.warning_heard = state.panic_warning !== null;

  const wages = wageBill(state, data);
  const upkeep = upkeepBill(state, data);
  const due = wages + upkeep;
  if (house.cash < due) raiseCash(state, due - Math.max(0, house.cash), data.tuning, "to pay wages and upkeep");
  if (house.cash < due) {
    house.status = "bankrupt";
    return;
  }
  for (const role of STAFF_ROLES) {
    const n = working(state, role).length;
    const pay = n * data.counting.roles[role].wage;
    if (pay === 0) continue;
    house.cash -= pay;
    const name = data.counting.roles[role].name.toLowerCase();
    addEntry(state, "cash", "wages", -pay, `Wages: ${n} ${name}${n === 1 ? "" : "s"}`);
  }
  const room = roomData(c.room, data);
  house.cash -= room.upkeep;
  addEntry(state, "cash", "upkeep", -room.upkeep, `Upkeep: ${room.name.toLowerCase()}`);
  for (const id of FACILITY_IDS) {
    if (!hasFacility(state, id)) continue;
    const f = data.counting.facilities[id];
    house.cash -= f.upkeep;
    addEntry(state, "cash", "upkeep", -f.upkeep, `Upkeep: ${f.name.toLowerCase()}`);
  }

  const inflow = tellerInflow(state, data);
  if (inflow > 0) {
    house.cash += inflow;
    house.deposits += inflow;
    const tellers = workingCount(state, "teller");
    const by = [tellers ? `tellers (${tellers})` : "", hasFacility(state, "strongroom") ? "strongroom" : ""].filter(Boolean).join(" and ");
    const note = `New deposits, drawn by the house's ${by}`;
    addEntry(state, "cash", "deposit_inflow", inflow, note);
    addEntry(state, "deposits", "deposit_inflow", inflow, note);
  }

  if (state.world.quarter === 4 && hasFacility(state, "reception_rooms")) warmHouses(state, data);

  c.staff = c.staff.filter((m) => !m.leaving);
  if (c.room_building && c.room_building.ready_turn <= turn + 1) {
    c.room = c.room_building.size;
    c.room_building = null;
  }

  writeAdvice(state, rng, data);

  c.candidates = drawCandidates(rng, data);
  const analystsNext = c.staff.filter((m) => m.role === "analyst" && m.start_turn <= turn + 1).length;
  c.opinion_draws = Array.from({ length: analystsNext * data.tuning.capacity.per_analyst }, () => rng.next());
  c.opinions = [];
  c.used = { deals: 0, reports: 0, opinions: 0, head: 0 };
}

// ---------- What other systems ask of the counting house ----------

/** The deposit level the counting house draws toward: the reputation's level, times strongroom_deposit_level with a strongroom. */
export function countingDepositLevel(state: GameState, data: GameData): number {
  const level = depositLevel(state.house.reputation, data.tuning);
  return hasFacility(state, "strongroom") ? Math.round(level * data.counting.effects.strongroom_deposit_level) : level;
}

/**
 * Extra deposits the counting house draws this quarter, in a calm market only: each teller closes
 * teller_catch_up of the gap below the counting house's level; a strongroom closes the usual
 * catch_up of the band between the reputation's level and its own (the core deposit step already
 * closes the gap below the reputation's level), so together a strongroom house is pulled toward the higher level.
 */
export function tellerInflow(state: GameState, data: GameData): number {
  if (state.world.sentiment !== "calm") return 0;
  const { deposits } = state.house;
  const base = depositLevel(state.house.reputation, data.tuning);
  const level = countingDepositLevel(state, data);
  const tellers = workingCount(state, "teller") * data.counting.effects.teller_catch_up * Math.max(0, level - deposits);
  const vault = hasFacility(state, "strongroom") ? data.tuning.deposits.catch_up * Math.max(0, level - Math.max(deposits, base)) : 0;
  return Math.round(tellers + vault);
}

/**
 * Reception rooms at year end: the bourse dines at the house, and every trading house thinks a
 * little better of it: opinion rises by reception_yearly_opinion (within the opinion limits) and
 * the baseline it drifts back to by reception_yearly_baseline, never past reception_baseline_ceiling
 * (a baseline already above the ceiling is left alone). Mutates `state`.
 */
export function warmHouses(state: GameState, data: GameData): void {
  const e = data.counting.effects;
  const { min, max } = data.tuning.houses.opinion;
  for (const h of state.houses) {
    if (h.failed_turn !== null) continue;
    h.opinion = Math.min(max, Math.max(min, h.opinion + e.reception_yearly_opinion));
    if (h.baseline < e.reception_baseline_ceiling) h.baseline = Math.min(e.reception_baseline_ceiling, h.baseline + e.reception_yearly_baseline);
  }
}

/** The share below the market price at which the house buys bonds: courier_bond_edge with a courier stable, else 0. */
export function courierBondEdge(state: GameState, data: GameData): number {
  return hasFacility(state, "courier_stable") ? data.counting.effects.courier_bond_edge : 0;
}

/** Scales what depositors ask: less in a panic with a strongroom. */
export function strongroomFactor(state: GameState, data: GameData): number {
  return hasFacility(state, "strongroom") ? data.counting.effects.strongroom_panic_withdrawals : 1;
}

/** Scales this quarter's withdrawals (used by End Turn): the strongroom works in a panic only. */
export function withdrawalFactor(state: GameState, data: GameData): number {
  return state.world.sentiment === "panic" ? strongroomFactor(state, data) : 1;
}

/** Terms for courting and marriages: a partner makes them cheaper and courting warmer; reception rooms warmer still. */
export function houseTerms(state: GameState, data: GameData): { cost_factor: number; court_opinion: number; marriage_opinion: number } {
  const e = data.counting.effects;
  const partner = workingCount(state, "partner") > 0;
  const reception = hasFacility(state, "reception_rooms");
  return {
    cost_factor: partner ? e.partner_cost_factor : 1,
    court_opinion: (partner ? e.partner_court_opinion : 0) + (reception ? e.reception_court_opinion : 0),
    marriage_opinion: reception ? e.reception_marriage_opinion : 0,
  };
}

/** Scales report costs (for the credit system): each correspondent after the first takes a share off, up to the max. */
export function reportCostFactor(state: GameState, data: GameData): number {
  const e = data.counting.effects;
  const extra = Math.max(0, workingCount(state, "correspondent") - 1);
  return 1 - Math.min(e.correspondent_max_discount, extra * e.correspondent_report_discount);
}

/** Quarters of payment records the house keeps (for the credit system): longer with an archive. */
export function paymentRecordQuarters(state: GameState, data: GameData): number {
  const e = data.counting.effects;
  return hasFacility(state, "archive") ? e.archive_record_quarters : e.record_quarters;
}

/** Lots of goods the house can store (for the markets system): none without a warehouse. */
export function warehouseSpace(state: GameState, data: GameData): number {
  return hasFacility(state, "warehouse") ? data.counting.effects.warehouse_space : 0;
}

/**
 * Whether the house knows of the running panic warning: at once with a courier stable, otherwise
 * from the quarter after it began. The news and the harness strategies go by this, not the raw state.
 */
export function warningKnown(state: GameState, _data: GameData): boolean {
  return state.panic_warning !== null && (hasFacility(state, "courier_stable") || state.counting.warning_heard);
}
