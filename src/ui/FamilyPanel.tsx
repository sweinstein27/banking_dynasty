import { gameData } from "../data";
import { headOf } from "../sim/family";
import type { GameState } from "../sim/types";

/** Placeholder until Week 5 adds people, heirs and succession. */
export function FamilyPanel({ state }: { state: GameState }) {
  const { house } = state;
  return (
    <section className="panel">
      <h2>Family</h2>
      <dl className="facts">
        <dt>House</dt>
        <dd>{house.name}, {house.city}</dd>
        <dt>Head of house</dt>
        <dd>{headOf(state)?.name ?? "None"}</dd>
        <dt>Reputation</dt>
        <dd>{house.reputation} of 100</dd>
      </dl>
      <p className="muted">Heirs, stats and succession arrive in Week 5.</p>
    </section>
  );
}
