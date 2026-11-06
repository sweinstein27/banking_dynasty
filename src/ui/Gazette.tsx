// The Gazette: each quarter's news as an issue of a newspaper, with earlier issues a click away.
// The paper's name is invented.
import { useState } from "react";
import { gameData } from "../data";
import { dateOfTurn } from "../sim/chronicle";
import type { GameState, NewsItem } from "../sim/types";
import { keepUnits, seasonLabel } from "./format";
import { PageTurner, usePages } from "./Pager";

/** News items shown on one page of an issue. */
const ITEMS_PER_PAGE = 5;

/** The Gazette, opened at the latest issue. Keyed by turn in App, so a new quarter opens the new issue. */
export function Gazette({ state }: { state: GameState }) {
  const latest = state.world.turn - 1;
  // Issues back from the latest: 0 is the news from the quarter just ended.
  const [back, setBack] = useState(0);
  const issueTurn = Math.max(1, latest - back);

  return (
    <section className="panel gazette" aria-label="The Gazette">
      <header className="gazette-head">
        <h2>The Bourse Gazette</h2>
        <p className="dateline">{latest === 0 ? "Frankfurt, first issue" : `Frankfurt, ${seasonLabel(dateOfTurn(issueTurn, gameData.tuning))}`}</p>
      </header>

      {state.panic_warning && back === 0 && (
        <p className="warning-banner">
          Panic warning: the market will panic {state.panic_warning.turns_left === 1 ? "next quarter" : `in ${state.panic_warning.turns_left} quarters`}.
          Build reserves now, or prepare crisis measures.
        </p>
      )}

      {latest === 0 ? (
        <div className="gazette-body">
          <p>The wars are over and the house opens for business. News arrives at the end of each quarter.</p>
        </div>
      ) : (
        <Issue key={issueTurn} news={state.news.filter((n) => n.turn === issueTurn)} />
      )}

      {latest > 1 && (
        <div className="page-turner issues">
          <button className="turn" onClick={() => setBack(back + 1)} disabled={issueTurn <= 1}>Earlier issue</button>
          <span>{back === 0 ? "Latest issue" : `${back} issue${back === 1 ? "" : "s"} back`}</span>
          <button className="turn" onClick={() => setBack(Math.max(0, back - 1))} disabled={back === 0}>Later issue</button>
        </div>
      )}
    </section>
  );
}

/** One issue's news, paged. */
function Issue({ news }: { news: NewsItem[] }) {
  const pages = usePages(news, ITEMS_PER_PAGE);
  return (
    <>
      <div className="gazette-body">
        {news.length === 0 ? (
          <p>A quiet quarter. Nothing of note.</p>
        ) : (
          <ul className="news">
            {pages.items.map((n, i) => (
              <li key={i} className={`news-${n.kind}`}>
                {n.title && <strong className="headline">{n.title}. </strong>}
                {keepUnits(n.text)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <PageTurner pages={pages} />
    </>
  );
}
