// The family: the head of house and the heirs as portraits, with what each stat does. A click on a
// portrait opens the person's sheet: their traits and what each one does.
import { Dialog } from "radix-ui";
import { useState } from "react";
import { gameData } from "../data";
import { ageIn, effectiveStat, headEffects, headOf, headStat, heirsOf, isTrained, livingSpouse, STATS, successor, yearlyDeathChance, type Stat } from "../sim/family";
import { describeEffects, traitById } from "../sim/traits";
import { marriageable } from "../sim/marriages";
import type { Decision, GameState, Person } from "../sim/types";
import { MarriageDialog } from "./MarriageDialog";
import { pct } from "./format";
import { PageTurner, usePages } from "./Pager";

const HEIRS_PER_PAGE = 3;
const STAT_NAMES: Record<Stat, string> = { acumen: "Acumen", prudence: "Prudence", connections: "Connections" };
const STAT_EFFECT: Record<Stat, string> = {
  acumen: "ventures fail less",
  prudence: "sharper borrower estimates",
  connections: "states sell bonds sooner",
};

const initials = (name: string) => name.split(" ").map((w) => w[0]).join("");

/** A stat as pips out of the maximum, with the number for anyone who would rather read it. */
function Pips({ value, max }: { value: number; max: number }) {
  return (
    <span className="pips" aria-label={`${value} of ${max}`}>
      {Array.from({ length: max }, (_, i) => <span key={i} className={i < value ? "pip on" : "pip"} />)}
      <span className="pip-n">{value}</span>
    </span>
  );
}

/** A portrait that opens the person's sheet. */
function Cameo({ p, year, onOpen }: { p: Person; year: number; onOpen: (p: Person) => void }) {
  return (
    <button className="cameo" onClick={() => onOpen(p)} aria-label={`About ${p.name}`}>
      <span>{initials(p.name)}</span>
      <small>{ageIn(p, year)}</small>
    </button>
  );
}

/** Trait names under a person's name. The sheet explains them. */
function TraitLabels({ p }: { p: Person }) {
  if (!p.traits.length) return <p className="small muted">No traits yet</p>;
  return (
    <p className="traits">
      {p.traits.map((id) => <span key={id} className="trait">{traitById(id, gameData)?.name ?? id}</span>)}
    </p>
  );
}

/** Who a member of the line is married to, in a line under their name. */
function SpouseLine({ p, state }: { p: Person; state: GameState }) {
  const spouse = livingSpouse(state, p);
  if (spouse) {
    const from = spouse.origin && spouse.origin !== "merchant" ? state.houses.find((h) => h.id === spouse.origin)?.name : null;
    return <p className="small spouse-line">Married to {spouse.name}{spouse.born ? `, born ${spouse.born}` : ""}{from ? `, of ${from}` : ", of a merchant family"}</p>;
  }
  const widowed = p.spouse !== null;
  if (ageIn(p, state.world.year) < gameData.tuning.family.marriage.min_age) return null;
  return <p className="small muted spouse-line">{widowed ? "Widowed" : "Unmarried"}: no children without a spouse</p>;
}

/** A person's sheet: who they are, their traits and what each one does. Opened by a click, never by hover. */
function PersonSheet({ p, state, onClose, onDecide, onMarry }: {
  p: Person | null;
  state: GameState;
  onClose: () => void;
  /** Queues a decision; returns the sim's reason if refused. Absent once the run is over. */
  onDecide?: (d: Decision) => string | null;
  onMarry: (p: Person) => void;
}) {
  const [refused, setRefused] = useState<string | null>(null);
  const canName = p !== null && onDecide && p.role === "line" && !p.is_head && p.death_year === null;
  const canMarry = p !== null && onDecide && marriageable(state, gameData).some((x) => x.id === p.id);
  const eldest = heirsOf(state)[0];
  return (
    <Dialog.Root open={p !== null} onOpenChange={(open) => { if (!open) { setRefused(null); onClose(); } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog person-sheet" aria-describedby={undefined}>
          {p && (
            <>
              <Dialog.Title>{p.name}</Dialog.Title>
              <p className="muted">
                Born {p.birth_year}{p.death_year !== null ? `, died ${p.death_year}` : `, aged ${ageIn(p, state.world.year)}`}.{" "}
                {p.role === "spouse"
                  ? `Married into the house${p.born ? `, born ${p.born}` : ""}. A spouse never leads the house, but can pass traits to the children.`
                  : p.role === "left"
                    ? "Married out of the house; no longer in the line."
                    : p.is_head ? "Head of the house: these traits act on the business now." : "Their traits will act on the business if they become head."}
              </p>
              <p>{STATS.map((k) => `${STAT_NAMES[k]} ${effectiveStat(p, k, gameData)}`).join(", ")} (traits included)</p>
              {p.traits.length === 0 ? (
                <p className="muted">No traits yet. Heirs gain one when they come of age, shaped by their schooling.</p>
              ) : (
                <ul className="choices trait-list">
                  {p.traits.map((id) => {
                    const t = traitById(id, gameData);
                    if (!t) return null;
                    return (
                      <li key={id} className="choice">
                        <strong>{t.name}</strong>
                        <span>{t.description}</span>
                        <span className="small">{describeEffects(t).join("; ")}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {canName && state.house.designated_heir !== p.id && (
                <p className="small muted">
                  Naming an heir uses one of the quarter's actions.
                  {eldest && eldest.id !== p.id && ` Passing over the elder ${eldest.name} will cost ${gameData.tuning.family.succession.passed_over_reputation} reputation when ${p.name} takes over.`}
                </p>
              )}
              {canName && state.house.designated_heir === p.id && <p className="good">{p.name} is the named heir.</p>}
              {refused && <p className="error">Refused: {refused}</p>}
              <div className="row dialog-buttons">
                <Dialog.Close asChild>
                  <button className="secondary">Close</button>
                </Dialog.Close>
                {canMarry && (
                  <button className="secondary" onClick={() => onMarry(p)}>Arrange a marriage</button>
                )}
                {canName && state.house.designated_heir !== p.id && (
                  <button
                    className="primary"
                    onClick={() => {
                      const reason = onDecide!({ kind: "designate_heir", heir: p.id });
                      if (reason) setRefused(reason);
                      else onClose();
                    }}
                  >
                    Name as heir
                  </button>
                )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function FamilyPanel({ state, onDecide }: { state: GameState; onDecide?: (d: Decision) => string | null }) {
  const { tuning } = gameData;
  const { world } = state;
  const max = tuning.family.max_stat;
  const head = headOf(state);
  const heirs = heirsOf(state);
  // Who would take over now: the named heir if living, else the automatic choice.
  const named = heirs.find((p) => p.id === state.house.designated_heir);
  const next = named ?? successor(state, gameData);
  const pages = usePages(heirs, HEIRS_PER_PAGE);
  const dead = state.people.filter((p) => p.death_year !== null);
  const green = head?.inexperienced_until != null && world.turn < head.inexperienced_until;
  const [open, setOpen] = useState<Person | null>(null);
  const [marrying, setMarrying] = useState<Person | null>(null);

  return (
    <div className="doc family">
      <h2>The House of {gameData.family.surname}</h2>

      {head && (
        <div className="person head">
          <Cameo p={head} year={world.year} onOpen={setOpen} />
          <div className="person-body">
            <p className="person-name">{head.name}, head of house, aged {ageIn(head, world.year)}</p>
            <TraitLabels p={head} />
            <SpouseLine p={head} state={state} />
            <ul className="stat-list">
              {STATS.map((k) => (
                <li key={k}>
                  <span className="stat-name">{STAT_NAMES[k]}</span>
                  <Pips value={headStat(state, k, gameData)} max={max} />
                  <span className="stat-effect">{STAT_EFFECT[k]}</span>
                </li>
              ))}
            </ul>
            {green && <p className="stamp">Untrained: stats count lower for {head.inexperienced_until! - world.turn} more quarters</p>}
            <p className="muted small">Chance of death this year: {pct(Math.min(1, yearlyDeathChance(ageIn(head, world.year), tuning) * headEffects(state, gameData).death_chance))}</p>
          </div>
        </div>
      )}

      <h3>Heirs</h3>
      {heirs.length === 0 ? (
        <p className="stamp">No heirs. If the head dies, a distant cousin takes over, untrained.</p>
      ) : (
        <ul className="heirs">
          {pages.items.map((p) => {
            const trained = isTrained(p, world.year, gameData);
            return (
              <li key={p.id} className="person heir">
                <Cameo p={p} year={world.year} onOpen={setOpen} />
                <div className="person-body">
                  <p className="person-name">
                    {p.name}
                    {p.id === next?.id && <span className="ribbon-tag">{named ? "Heir: named" : "Heir: by right"}</span>}
                  </p>
                  <TraitLabels p={p} />
                  <SpouseLine p={p} state={state} />
                  <p className="small">
                    {STATS.map((k) => `${STAT_NAMES[k]} ${effectiveStat(p, k, gameData)}`).join(", ")}
                  </p>
                  <p className={trained ? "small good" : "small muted"}>
                    {trained ? "Trained" : `Untrained: needs ${tuning.family.succession.adult_age}+ and a total of ${tuning.family.succession.trained_total}`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <PageTurner pages={pages} />

      <PersonSheet p={open} state={state} onClose={() => setOpen(null)} onDecide={onDecide} onMarry={(p) => { setOpen(null); setMarrying(p); }} />
      {onDecide && <MarriageDialog member={marrying} state={state} onClose={() => setMarrying(null)} onSubmit={onDecide} />}

      {dead.length > 0 && (
        <p className="remembered small muted">
          Remembered: {dead.map((p) => `${p.name} (${p.birth_year} to ${p.death_year})`).join("; ")}
        </p>
      )}
    </div>
  );
}
