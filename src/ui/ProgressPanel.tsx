// Progress: Rhine steam, gas, railways and the telegraph. Each technology's adoption (click for the
// sums), its dated stages and what each opens, the sectors and trades it moves, and the telegraph
// lines that bring news the same day.
import { gameData } from "../data";
import type { GameState } from "../sim/types";
import type { PanelId } from "./Panel";
import { sectorRows, techViews, telegraphRows } from "./model/progress";
import { SumCard } from "./ScreenKit";
import { Term } from "./Term";

const times = (f: number) => `x ${f.toFixed(2)}`;

export function ProgressPanel({ state, onOpen }: { state: GameState; onOpen: (p: PanelId) => void }) {
  const techs = techViews(state, gameData);
  const sectors = sectorRows(state, gameData);
  const lines = telegraphRows(state, gameData);
  return (
    <div className="doc progress">
      <p className="small muted">
        New ways of moving goods, light and news spread through the German lands: their <Term id="adoption">adoption</Term> moves what ventures and companies earn, and dated <Term id="tech_stage">stages</Term> open new ventures.
      </p>
      <ul className="tech-list">
        {techs.map((t) => (
          <li key={t.tech.id} className="row-card tech">
            <p className="row-head">
              <strong>{t.tech.name}</strong>
              <SumCard title={t.tech.name} summary="How far it has spread this quarter." term="adoption" sections={t.sections} className="tech-figure">
                {t.label}
              </SumCard>
            </p>
            <span className="gauge tech-gauge" aria-hidden="true"><span style={{ width: `${Math.round(t.adoption * 100)}%` }} /></span>
            {t.local > 0 && <p className="small good">The house's own ventures add {Math.round(t.local * 1000) / 10}%.</p>}
            <ol className="stages">
              {t.stages.map((s) => (
                <li key={s.stage.id} className={s.reached ? "stage reached" : "stage"}>
                  <span className="stage-date">{s.date}</span>
                  <span className="stage-body">
                    <strong>{s.title}</strong> <span className={`chip ${s.reached ? "chip-borrowing" : ""}`}>{s.reached ? "Reached" : "To come"}</span>
                    {s.opens.length > 0 && (
                      <span className="small">
                        {" "}Opens {s.opens.map((o) => o.name).join(", ")} as {s.opens.length === 1 ? "a venture" : "ventures"}
                        {s.opens.some((o) => o.open) && (
                          <>
                            {": "}
                            <button className="link-button" onClick={() => onOpen("markets")}>back one in the Markets</button>
                          </>
                        )}
                        .
                      </span>
                    )}
                    {s.early && <span className="small muted"> {s.early}</span>}
                  </span>
                </li>
              ))}
            </ol>
            {(t.sectors.length > 0 || t.trades.length > 0) && (
              <ul className="plain small tech-effects">
                {t.sectors.map((e) => (
                  <li key={e.sector}>
                    {e.sector[0]!.toUpperCase() + e.sector.slice(1)} earnings <strong className={e.atFull >= 1 ? "tone-good" : "tone-bad"}>{times(e.now)}</strong> now, {times(e.atFull)} when it is everywhere
                  </li>
                ))}
                {t.trades.map((e) => <li key={e.trade}>Borrowers in {e.trade} {e.words}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <div className="sheet-columns">
        <section>
          <h3>Earnings by sector, every technology together</h3>
          <dl className="bd-lines">
            {sectors.map((s) => (
              <div key={s.sector} className="contents">
                <dt>{s.sector[0]!.toUpperCase() + s.sector.slice(1)}</dt>
                <dd className={s.factor > 1 ? "tone-good" : s.factor < 1 ? "tone-bad" : ""}>{times(s.factor)}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h3>Telegraph lines to Frankfurt</h3>
          <dl className="bd-lines">
            {lines.map((l) => (
              <div key={l.place} className="contents">
                <dt>{l.place}</dt>
                <dd className={l.open ? "tone-good" : ""}>{l.open ? `open since ${l.date}` : `opens ${l.date}`}</dd>
              </div>
            ))}
          </dl>
          <p className="small muted">News from a city on a line arrives the same day: see the <Term id="news_delay">news delay</Term>.</p>
        </section>
      </div>
    </div>
  );
}
