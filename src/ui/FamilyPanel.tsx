// The family: the head of house and the heirs as portraits, with what each stat does.
import { gameData } from "../data";
import { ageIn, headOf, headStat, heirsOf, isTrained, STATS, successor, yearlyDeathChance, type Stat } from "../sim/family";
import type { GameState, Person } from "../sim/types";
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

function Cameo({ p, year }: { p: Person; year: number }) {
  return (
    <div className="cameo" aria-hidden="true">
      <span>{initials(p.name)}</span>
      <small>{ageIn(p, year)}</small>
    </div>
  );
}

export function FamilyPanel({ state }: { state: GameState }) {
  const { tuning } = gameData;
  const { world } = state;
  const max = tuning.family.max_stat;
  const head = headOf(state);
  const heirs = heirsOf(state);
  const next = successor(state, tuning);
  const pages = usePages(heirs, HEIRS_PER_PAGE);
  const dead = state.people.filter((p) => p.death_year !== null);
  const green = head?.inexperienced_until != null && world.turn < head.inexperienced_until;

  return (
    <section className="panel family" aria-label="The Family">
      <h2>The House of {gameData.family.surname}</h2>

      {head && (
        <div className="person head">
          <Cameo p={head} year={world.year} />
          <div className="person-body">
            <p className="person-name">{head.name}, head of house, aged {ageIn(head, world.year)}</p>
            <ul className="stat-list">
              {STATS.map((k) => (
                <li key={k}>
                  <span className="stat-name">{STAT_NAMES[k]}</span>
                  <Pips value={headStat(state, k, tuning)} max={max} />
                  <span className="stat-effect">{STAT_EFFECT[k]}</span>
                </li>
              ))}
            </ul>
            {green && <p className="stamp">Untrained: stats count lower for {head.inexperienced_until! - world.turn} more quarters</p>}
            <p className="muted small">Chance of death this year: {pct(yearlyDeathChance(ageIn(head, world.year), tuning))}</p>
          </div>
        </div>
      )}

      <h3>Heirs</h3>
      {heirs.length === 0 ? (
        <p className="stamp">No heirs. If the head dies, a distant cousin takes over, untrained.</p>
      ) : (
        <ul className="heirs">
          {pages.items.map((p) => {
            const trained = isTrained(p, world.year, tuning);
            return (
              <li key={p.id} className="person heir">
                <Cameo p={p} year={world.year} />
                <div className="person-body">
                  <p className="person-name">
                    {p.name}
                    {p.id === next?.id && <span className="ribbon-tag">Heir</span>}
                  </p>
                  <p className="small">
                    {STATS.map((k) => `${STAT_NAMES[k]} ${p[k]}`).join(", ")}
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

      {dead.length > 0 && (
        <p className="remembered small muted">
          Remembered: {dead.map((p) => `${p.name} (${p.birth_year} to ${p.death_year})`).join("; ")}
        </p>
      )}
    </section>
  );
}
