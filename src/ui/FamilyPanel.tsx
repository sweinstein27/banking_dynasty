import { gameData } from "../data";
import { ageIn, headOf, headStat, heirsOf, isTrained, STATS, statTotal, successor, yearlyDeathChance, type Stat } from "../sim/family";
import type { GameState, Person } from "../sim/types";
import { pct } from "./format";

const STAT_NAMES: Record<Stat, string> = { acumen: "Acumen", prudence: "Prudence", connections: "Connections" };
const STAT_EFFECT: Record<Stat, string> = {
  acumen: "ventures fail less often",
  prudence: "sharper estimates of borrowers",
  connections: "states sell bonds at a lower reputation",
};

function Stats({ p }: { p: Person }) {
  return (
    <span>
      {STATS.map((k) => `${STAT_NAMES[k]} ${p[k]}`).join(", ")} (total {statTotal(p)})
    </span>
  );
}

export function FamilyPanel({ state }: { state: GameState }) {
  const { tuning } = gameData;
  const { house, world } = state;
  const head = headOf(state);
  const heirs = heirsOf(state);
  const next = successor(state, tuning);
  const dead = state.people.filter((p) => p.death_year !== null);
  const green = head?.inexperienced_until != null && world.turn < head.inexperienced_until;

  return (
    <section className="panel">
      <h2>Family</h2>
      <p>
        {house.name}, {house.city}. Reputation {house.reputation} of 100.
      </p>

      {head && (
        <div className="person head">
          <h3>Head of house: {head.name}, aged {ageIn(head, world.year)}</h3>
          <ul className="stat-list">
            {STATS.map((k) => (
              <li key={k}>
                <strong>{STAT_NAMES[k]} {headStat(state, k, tuning)}</strong>
                {green && ` (${head[k]} once experienced)`}: {STAT_EFFECT[k]}
              </li>
            ))}
          </ul>
          {green && <p className="error">New to the house and untrained: stats count lower until {head.inexperienced_until! - world.turn} more quarters have passed.</p>}
          <p className="muted">Chance of death this year: {pct(yearlyDeathChance(ageIn(head, world.year), tuning))}</p>
        </div>
      )}

      <h3>Heirs</h3>
      {heirs.length === 0 ? (
        <p className="error">No heirs. If the head dies, a distant cousin takes over, untrained.</p>
      ) : (
        <ul className="heirs">
          {heirs.map((p) => (
            <li key={p.id} className={p.id === next?.id ? "next-heir" : undefined}>
              <strong>{p.name}, aged {ageIn(p, world.year)}</strong>
              {p.id === next?.id && <span className="tag">Would take over</span>}
              <br />
              <Stats p={p} />
              <br />
              <span className={isTrained(p, world.year, tuning) ? "good" : "muted"}>
                {isTrained(p, world.year, tuning)
                  ? "Trained: a smooth succession"
                  : `Untrained: needs to be ${tuning.family.succession.adult_age} or over with a total of ${tuning.family.succession.trained_total}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">Educate heirs with "Invest in the family" in the Decisions panel.</p>

      {dead.length > 0 && (
        <>
          <h3>Remembered</h3>
          <ul className="heirs">
            {dead.map((p) => (
              <li key={p.id} className="muted">
                {p.name}, {p.birth_year} to {p.death_year}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
