// The House view: the counting house as a building, room by room, with who works in each room,
// what each room costs and what can be built, hired or dismissed there. Built only from the sim's
// own functions in src/sim/systems/counting.ts and src/sim/capacity.ts.
import { POOLS, poolLeft, poolSize, type Pool } from "../../sim/capacity";
import {
  advisors,
  ADVISOR_TITLES,
  buildCost,
  checkBuild,
  checkDismiss,
  checkHire,
  desksTaken,
  FACILITY_IDS,
  hasFacility,
  nextRoom,
  roomData,
  skillOf,
  STAFF_ROLES,
  traitOf,
  upkeepBill,
  wageBill,
  type Advice,
  type FacilityId,
  type Staff,
  type StaffRole,
} from "../../sim/systems/counting";
import { fl } from "../../sim/format";
import type { GameData } from "../../sim/tuning";
import type { GameState } from "../../sim/types";
import type { Line, Section } from "./breakdowns";

export type RoomId = "counting_room" | "partners_office" | FacilityId;

export interface StaffView {
  id: number;
  name: string;
  role: StaffRole;
  roleName: string;
  skill: number;
  trait: string;
  traitText: string;
  wage: number;
  /** Working, starting next quarter, or leaving at the end of this one. */
  status: "working" | "starts" | "leaving";
}

export interface CandidateView {
  role: StaffRole;
  index: number;
  name: string;
  skill: number;
  trait: string;
  traitText: string;
  wage: number;
  blocked: string | null;
}

export interface RoomView {
  id: RoomId;
  name: string;
  description: string;
  /** Built and working, being built (ready next quarter), or not built. */
  status: "built" | "building" | "none";
  /** Upkeep a quarter once working. */
  upkeep: number;
  staff: StaffView[];
  /** Roles hired into this room. */
  roles: StaffRole[];
  /** Building it (or the next larger counting room): its cost and why it is refused, or null if nothing to build. */
  build: { label: string; cost: number; blocked: string | null } | null;
  /** The counting room only: desks in use next quarter and desks there are. */
  desks?: { taken: number; total: number };
}

function staffView(m: Staff, state: GameState, data: GameData): StaffView {
  const t = traitOf(m.trait, data);
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    roleName: data.counting.roles[m.role].name,
    skill: skillOf(m, state.world.turn, data),
    trait: t?.name ?? m.trait,
    traitText: t?.description ?? "",
    wage: data.counting.roles[m.role].wage,
    status: m.leaving ? "leaving" : m.start_turn > state.world.turn ? "starts" : "working",
  };
}

const staffIn = (state: GameState, roles: StaffRole[], data: GameData) =>
  state.counting.staff.filter((m) => roles.includes(m.role)).map((m) => staffView(m, state, data));

/** The rooms of the house, in the order the cutaway draws them. */
export function houseRooms(state: GameState, data: GameData): RoomView[] {
  const c = state.counting;
  const room = roomData(c.room, data);
  const building = c.room_building ? roomData(c.room_building.size, data) : null;
  const next = nextRoom(c.room_building?.size ?? c.room, data);
  const deskRoles = STAFF_ROLES.filter((r) => data.counting.roles[r].desk);
  const counting: RoomView = {
    id: "counting_room",
    name: room.name,
    description: building
      ? `The ${building.name.toLowerCase()} is being built, ready next quarter with ${building.desks} desks.`
      : `Desks for clerks, correspondents, analysts and tellers. ${room.desks} desks.`,
    status: "built",
    upkeep: room.upkeep,
    staff: staffIn(state, deskRoles, data),
    roles: deskRoles,
    build: next && !building ? { label: `Enlarge to the ${next.name.toLowerCase()} (${next.desks} desks)`, cost: next.build, blocked: checkBuild(state, { kind: "build", facility: "counting_room" }, data) } : null,
    desks: { taken: desksTaken(state, data), total: (building ?? room).desks },
  };
  const partner: RoomView = {
    id: "partners_office",
    name: "Partner's office",
    description: data.counting.roles.partner.description,
    status: "built",
    upkeep: 0,
    staff: staffIn(state, ["partner"], data),
    roles: ["partner"],
    build: null,
  };
  const facilities = FACILITY_IDS.map((id): RoomView => {
    const f = data.counting.facilities[id];
    const owned = c.facilities.find((x) => x.id === id);
    const status = owned ? (hasFacility(state, id) ? "built" : "building") : "none";
    return {
      id,
      name: f.name,
      description: f.description,
      status,
      upkeep: f.upkeep,
      staff: [],
      roles: [],
      build: owned ? null : { label: `Build the ${f.name.toLowerCase()}`, cost: buildCost(state, id, data) ?? f.build, blocked: checkBuild(state, { kind: "build", facility: id }, data) },
    };
  });
  return [counting, partner, ...facilities];
}

/** Staff of a room (or every room), with why each can or cannot be dismissed. */
export function dismissBlocked(state: GameState, staffId: number, data: GameData): string | null {
  return checkDismiss(state, { kind: "dismiss", staff: staffId }, data);
}

/** This quarter's candidates for a role, with why each cannot be hired now. */
export function candidates(state: GameState, role: StaffRole, data: GameData): CandidateView[] {
  return (state.counting.candidates[role] ?? []).map((cd, index) => {
    const t = traitOf(cd.trait, data);
    return {
      role,
      index,
      name: cd.name,
      skill: cd.skill,
      trait: t?.name ?? cd.trait,
      traitText: t?.description ?? "",
      wage: data.counting.roles[role].wage,
      blocked: checkHire(state, { kind: "hire", role, candidate: index }, data),
    };
  });
}

/** Who gives each pool its capacity, in words. */
const POOL_SOURCE: Record<Pool, StaffRole | "head"> = { deals: "clerk", reports: "correspondent", opinions: "analyst", head: "head" };

export interface PoolView {
  pool: Pool;
  name: string;
  left: number;
  size: number;
  /** Who supplies it: "2 clerks". */
  from: string;
}

const POOL_TITLES: Record<Pool, string> = { deals: "Deals", reports: "Reports", opinions: "Opinions", head: "The head's time" };

export function pools(state: GameState, data: GameData): PoolView[] {
  return POOLS.map((p) => {
    const src = POOL_SOURCE[p];
    let from: string;
    if (src === "head") {
      const partner = state.counting.staff.some((m) => m.role === "partner" && m.start_turn <= state.world.turn);
      from = partner ? "the head and the partner" : "the head";
    } else {
      const n = state.counting.staff.filter((m) => m.role === src && m.start_turn <= state.world.turn).length;
      const name = data.counting.roles[src].name.toLowerCase();
      from = `${n} ${name}${n === 1 ? "" : "s"}`;
    }
    return { pool: p, name: POOL_TITLES[p], left: poolLeft(state, p, data.tuning), size: poolSize(state, p, data.tuning), from };
  });
}

/** Wages by role and upkeep by room this quarter. Each section adds up to the sim's own bill. */
export function costSections(state: GameState, data: GameData): Section[] {
  const turn = state.world.turn;
  const wages: Line[] = STAFF_ROLES.flatMap((r) => {
    const n = state.counting.staff.filter((m) => m.role === r && m.start_turn <= turn).length;
    if (n === 0) return [];
    const each = data.counting.roles[r].wage;
    const amount = n * each;
    return [{ label: `${n} ${data.counting.roles[r].name.toLowerCase()}${n === 1 ? "" : "s"} at ${fl(each)}`, value: fl(amount), amount }];
  });
  const room = roomData(state.counting.room, data);
  const upkeep: Line[] = [
    { label: room.name, value: fl(room.upkeep), amount: room.upkeep },
    ...FACILITY_IDS.filter((id) => hasFacility(state, id)).map((id) => {
      const f = data.counting.facilities[id];
      return { label: f.name, value: fl(f.upkeep), amount: f.upkeep };
    }),
  ];
  const w = wageBill(state, data);
  const u = upkeepBill(state, data);
  return [
    { heading: "Wages this quarter", lines: wages, total: { label: "Wages", value: fl(w), amount: w } },
    { heading: "Upkeep of the rooms", lines: upkeep, total: { label: "Upkeep", value: fl(u), amount: u } },
  ];
}

/** The council's letters from the last End Turn, with each advisor's title. */
export function councilLetters(state: GameState): (Advice & { title: string })[] {
  return state.counting.advice.map((a) => ({ ...a, title: ADVISOR_TITLES[a.advisor] }));
}

/** Who sits on the council now, for when no letter came this quarter. */
export function councilMembers(state: GameState, data: GameData): { title: string; name: string; topic: string }[] {
  const topics = { liquidity: "the house's cash", market: "the bourse abroad", family: "the heir" };
  return Object.values(advisors(state, data)).map((a) => ({ title: ADVISOR_TITLES[a.role], name: a.name, topic: topics[a.topic] }));
}
