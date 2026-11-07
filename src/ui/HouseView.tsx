// The House: the counting house drawn as a cutaway, room by room. Each room shows who works there
// and what it costs; clicking a room opens its sheet to hire, dismiss, build or enlarge. Beside the
// building: capacity left in each pool, the quarter's bills, the reserve, and the council's letters.
import { useState } from "react";
import { gameData } from "../data";
import { freeCash } from "../sim/reserves";
import type { StaffRole } from "../sim/systems/counting";
import type { Decision, GameState } from "../sim/types";
import { DecisionDialog } from "./DecisionDialogs";
import { fl, keepUnits } from "./format";
import { candidates, costSections, councilLetters, councilMembers, dismissBlocked, houseRooms, pools, type RoomId, type RoomView, type StaffView } from "./model/house";
import { merchantRows } from "./model/credit";
import { PageTurner, usePages } from "./Pager";
import { ActButton, ActionDialog, Refused, SumCard, useRun } from "./ScreenKit";
import { Term } from "./Term";

type Decide = (d: Decision) => string | null;

const FLOORS: { name: string; rooms: RoomId[] }[] = [
  { name: "Upper floor", rooms: ["reception_rooms", "partners_office", "archive"] },
  { name: "Ground floor", rooms: ["counting_room"] },
  { name: "Cellar and yard", rooms: ["strongroom", "courier_stable", "warehouse"] },
];

const STATUS_WORDS: Record<StaffView["status"], string> = { working: "", starts: "starts next quarter", leaving: "leaving" };

export function HouseView({ state, onDecide }: { state: GameState; onDecide?: Decide }) {
  const rooms = houseRooms(state, gameData);
  const [openRoom, setOpenRoom] = useState<RoomId | null>(null);
  const [reserve, setReserve] = useState(false);
  const room = rooms.find((r) => r.id === openRoom) ?? null;
  return (
    <div className="house-layout">
      <div className="doc cutaway" aria-label="The house, room by room">
        <div className="roof"><span>{state.house.name}</span></div>
        {FLOORS.map((f) => (
          <div key={f.name} className={`floor floor-${f.rooms.length === 1 ? "main" : "side"}`} aria-label={f.name}>
            {f.rooms.map((id) => <Room key={id} room={rooms.find((r) => r.id === id)!} onOpen={() => setOpenRoom(id)} />)}
          </div>
        ))}
      </div>
      <aside className="doc house-side">
        <Pools state={state} />
        <Bills state={state} onReserve={onDecide ? () => setReserve(true) : undefined} />
        <Council state={state} />
      </aside>
      <ActionDialog open={room !== null} title={room?.name ?? ""} onClose={() => setOpenRoom(null)} className="room-sheet">
        {room && <RoomSheet room={room} state={state} onDecide={onDecide} />}
      </ActionDialog>
      {onDecide && <DecisionDialog kind={reserve ? "set_reserve" : null} state={state} onClose={() => setReserve(false)} onSubmit={onDecide} />}
    </div>
  );
}

function Room({ room, onOpen }: { room: RoomView; onOpen: () => void }) {
  const status = room.status === "none" ? "Not built" : room.status === "building" ? "Being built, ready next quarter" : room.upkeep > 0 ? `Upkeep ${fl(room.upkeep)} a quarter` : "No upkeep";
  return (
    <button className={`room room-${room.status} room-${room.id}`} onClick={onOpen}>
      <span className="room-name">{room.name}</span>
      <span className="room-status">{keepUnits(status)}</span>
      {room.desks ? (
        <span className="desks" style={{ gridTemplateColumns: `repeat(${room.desks.total > 12 ? 8 : 6}, minmax(0, 1fr))` }}>
          {Array.from({ length: room.desks.total }, (_, i) => {
            const m = room.staff[i];
            return m ? (
              <span key={i} className={`desk-tile role-${m.role} ${m.status}`}>
                <b>{m.name.split(" ").at(-1)}</b>
                <small>{m.roleName}, skill {m.skill}</small>
                <small>{m.trait}, {keepUnits(fl(m.wage))}</small>
                {m.status !== "working" && <small className="status-note">{STATUS_WORDS[m.status]}</small>}
              </span>
            ) : <span key={i} className="desk-tile empty">empty desk</span>;
          })}
        </span>
      ) : room.staff.length > 0 ? (
        <span className="room-staff">{room.staff.map((m) => `${m.name}, skill ${m.skill}${m.status !== "working" ? ` (${STATUS_WORDS[m.status]})` : ""}`).join("; ")}</span>
      ) : room.status === "none" && room.build ? (
        <span className="room-build">{keepUnits(`Build for ${fl(room.build.cost)}`)}</span>
      ) : null}
    </button>
  );
}

function RoomSheet({ room, state, onDecide }: { room: RoomView; state: GameState; onDecide?: Decide }) {
  const { error, run } = useRun(onDecide);
  const staffPages = usePages(room.staff, 5);
  const [role, setRole] = useState<StaffRole>(room.roles[0] ?? "clerk");
  const hireRole = room.roles.includes(role) ? role : room.roles[0];
  const asking = room.id === "counting_room" ? merchantRows(state, gameData) : [];
  const analysts = room.staff.some((m) => m.role === "analyst" && m.status !== "starts");
  return (
    <div className="room-sheet-body">
      <p>{room.description}</p>
      <p className="small">
        {keepUnits(room.status === "none" ? `Upkeep once built: ${fl(room.upkeep)} a quarter.` : `Upkeep ${fl(room.upkeep)} a quarter.`)}
        {room.desks && <> <Term id="desks">Desks</Term> in use next quarter: {room.desks.taken} of {room.desks.total}.</>}
        {" "}Free cash: {keepUnits(fl(freeCash(state)))}
      </p>
      {room.build && onDecide && (
        <div className="act-row">
          <ActButton primary label={`${room.build.label}, ${fl(room.build.cost)}`} blocked={room.build.blocked} onClick={() => run({ kind: "build", facility: room.id as Exclude<RoomId, "partners_office"> })} />
        </div>
      )}
      {room.roles.length > 0 && (
        <div className="sheet-columns">
          <section>
            <h3>Staff</h3>
            {room.staff.length === 0 ? <p className="muted">No one works here.</p> : (
              <table className="staff-table">
                <thead><tr><th>Name</th><th>Post</th><th><Term id="staff_skill">Skill</Term></th><th><Term id="staff_trait">Trait</Term></th><th>Wage</th><th /></tr></thead>
                <tbody>
                  {staffPages.items.map((m) => {
                    const why = dismissBlocked(state, m.id, gameData);
                    return (
                      <tr key={m.id} className={m.status}>
                        <td>{m.name}{m.status !== "working" && <small className="status-note"> {STATUS_WORDS[m.status]}</small>}</td>
                        <td>{m.roleName}</td>
                        <td className="num">{m.skill}</td>
                        <td>{m.trait}</td>
                        <td className="num">{keepUnits(fl(m.wage))}</td>
                        <td>{onDecide && m.status !== "leaving" && <button className="secondary" disabled={why !== null} onClick={() => run({ kind: "dismiss", staff: m.id })}>Dismiss</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <PageTurner pages={staffPages} />
          </section>
          {hireRole && (
            <section>
              <h3><Term id="hiring">Candidates this quarter</Term></h3>
              {room.roles.length > 1 && (
                <div className="row role-picks">
                  {room.roles.map((r) => (
                    <button key={r} className={r === hireRole ? "primary" : "secondary"} aria-pressed={r === hireRole} onClick={() => setRole(r)}>{gameData.counting.roles[r].name}</button>
                  ))}
                </div>
              )}
              <p className="small muted">{gameData.counting.roles[hireRole].description}</p>
              <ul className="candidates">
                {candidates(state, hireRole, gameData).map((c) => (
                  <li key={`${c.role}${c.index}${c.name}`}>
                    <span><strong>{c.name}</strong>, skill {c.skill}, {c.trait.toLowerCase()} <small className="muted">({c.traitText})</small>. {keepUnits(fl(c.wage))} a quarter.</span>
                    {onDecide && <ActButton label="Hire" blocked={c.blocked} onClick={() => run({ kind: "hire", role: c.role, candidate: c.index })} />}
                  </li>
                ))}
                {candidates(state, hireRole, gameData).length === 0 && <li className="muted">No one else applied this quarter.</li>}
              </ul>
            </section>
          )}
        </div>
      )}
      {room.id === "counting_room" && onDecide && analysts && (
        <section>
          <h3><Term id="analyst_opinion">Consult an analyst</Term></h3>
          {asking.length === 0 ? <p className="muted">No one is asking for a loan this quarter.</p> : (
            <div className="act-row">
              {asking.map((m) => {
                const a = m.actions.find((x) => x.kind === "consult_analyst")!;
                return m.opinion ? (
                  <span key={m.offer.borrower_id} className="small opinion-note">{m.offer.name}: {m.opinion.verdict}</span>
                ) : (
                  <ActButton key={m.offer.borrower_id} label={`On ${m.offer.name}`} blocked={a.blocked} onClick={() => run({ kind: "consult_analyst", borrower: m.offer.borrower_id })} />
                );
              })}
            </div>
          )}
        </section>
      )}
      <Refused error={error} />
    </div>
  );
}

function Pools({ state }: { state: GameState }) {
  return (
    <section>
      <h3><Term id="actions">Capacity this quarter</Term></h3>
      <ul className="pool-list">
        {pools(state, gameData).map((p) => (
          <li key={p.pool}>
            <span className="pool-name">{p.name}</span>
            <span className="pool-pips" aria-label={`${p.left} of ${p.size} left`}>
              {Array.from({ length: p.size }, (_, i) => <span key={i} className={i < p.left ? "pip on" : "pip"} />)}
            </span>
            <span className="num">{p.left} of {p.size} left</span>
            <small className="pool-from">from {p.from}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Bills({ state, onReserve }: { state: GameState; onReserve?: () => void }) {
  const sections = costSections(state, gameData);
  const total = sections.reduce((n, s) => n + s.total!.amount!, 0);
  return (
    <section>
      <h3>The quarter's bills</h3>
      <p className="small">
        <SumCard title="Wages and upkeep" summary={`The staff and rooms cost ${fl(total)} this quarter, paid at End Turn.`} term="counting_house" sections={sections}>
          {keepUnits(`Wages ${fl(sections[0]!.total!.amount!)}, upkeep ${fl(sections[1]!.total!.amount!)}`)}
        </SumCard>
      </p>
      <p className="small">
        <Term id="cash">Cash</Term> {keepUnits(fl(state.house.cash))}, <Term id="reserve">reserve</Term> {keepUnits(fl(state.house.reserve))}, <Term id="free_cash">free</Term> {keepUnits(fl(freeCash(state)))}
      </p>
      {onReserve && <button className="secondary" onClick={onReserve}>Set reserves</button>}
    </section>
  );
}

function Council({ state }: { state: GameState }) {
  const letters = councilLetters(state);
  const pages = usePages(letters, 1);
  const members = councilMembers(state, gameData);
  return (
    <section className="council">
      <h3><Term id="council">The council's advice</Term></h3>
      {letters.length === 0 ? (
        <p className="small muted">
          No letters this quarter. {members.length > 0 ? `${members.map((m) => `${m.name} (${m.title}) watches ${m.topic}`).join("; ")}.` : "The council has no members."}
        </p>
      ) : (
        pages.items.map((a) => (
          <blockquote key={`${a.advisor}${a.turn}`} className={`advice ${a.alarm ? "alarm" : ""}`}>
            <p>{a.text}</p>
            <footer>{a.name}, {a.title}{a.alarm ? ": a warning" : ""}</footer>
          </blockquote>
        ))
      )}
      <PageTurner pages={pages} label="Letter" />
    </section>
  );
}

