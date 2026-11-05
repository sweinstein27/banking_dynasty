import type { GameState } from "../sim/types";
import { dateLabel, previousQuarter } from "./format";

/** The news from the quarter that just resolved. */
export function NewsPanel({ state }: { state: GameState }) {
  const lastTurn = state.world.turn - 1;
  const news = state.news.filter((n) => n.turn === lastTurn);
  const prev = lastTurn >= 1 ? previousQuarter(state.world) : null;

  return (
    <section className="panel">
      <h2>News</h2>
      {state.panic_warning && (
        <p className="warning-banner">
          Panic warning: the market will panic {state.panic_warning.turns_left === 1 ? "next quarter" : `in ${state.panic_warning.turns_left} quarters`}. Build
          reserves now, or prepare crisis measures.
        </p>
      )}
      {prev === null ? (
        <p className="muted">Frankfurt, {dateLabel(state.world)}. The wars are over and the house opens for business. News arrives at the end of each quarter.</p>
      ) : (
        <>
          <p className="muted">From {dateLabel(prev)}:</p>
          {news.length === 0 ? (
            <p>A quiet quarter. Nothing of note.</p>
          ) : (
            <ul className="news">
              {news.map((n, i) => (
                <li key={i} className={`news-${n.kind}`}>
                  {n.title && <strong>{n.title}. </strong>}
                  {n.text}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
