import type { GameState } from "../sim/types";
import { dateLabel } from "./format";

/** The news from the quarter that just resolved. */
export function NewsPanel({ state }: { state: GameState }) {
  const lastTurn = state.world.turn - 1;
  const news = state.news.filter((n) => n.turn === lastTurn);
  const prev = lastTurn >= 1 ? previousQuarter(state.world) : null;

  return (
    <section className="panel">
      <h2>News</h2>
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
                <li key={i} className={`news-${n.kind}`}>{n.text}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function previousQuarter(w: GameState["world"]) {
  return w.quarter === 1 ? { year: w.year - 1, quarter: 4 as const } : { year: w.year, quarter: (w.quarter - 1) as 1 | 2 | 3 };
}
