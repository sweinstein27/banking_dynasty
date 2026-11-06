// Net worth at each year end, inked as a line in the ledger. Labels are always visible: no hover.
import { useLayoutEffect, useRef, useState } from "react";
import { gameData } from "../data";
import type { GameState } from "../sim/types";
import { fl } from "./format";

export function WorthChart({ state, now }: { state: GameState; now: number }) {
  const start = gameData.tuning.start.cash - gameData.tuning.start.deposits;
  const points = [{ year: gameData.tuning.start.year - 1, worth: start }, ...state.year_ends.map((y) => ({ year: y.year, worth: y.net_worth }))];
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 400, h: 120 });

  // Draw to the space the ledger page leaves, whatever the screen size.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (points.length < 2) {
    return (
      <div className="worth-chart" ref={box}>
        <p className="muted small">Net worth is recorded at the end of each year. The first mark comes at the close of {gameData.tuning.start.year}.</p>
      </div>
    );
  }

  const values = [...points.map((p) => p.worth), now, 0];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = { l: 4, r: 4, t: 14, b: 16 };
  const w = Math.max(50, size.w);
  const h = Math.max(40, size.h);
  const firstYear = points[0]!.year;
  const lastYear = Math.max(points.at(-1)!.year, firstYear + 1);
  const x = (year: number) => pad.l + ((year - firstYear) / (lastYear - firstYear)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / Math.max(1, hi - lo)) * (h - pad.t - pad.b);
  const line = points.map((p) => `${x(p.year).toFixed(1)},${y(p.worth).toFixed(1)}`).join(" ");

  return (
    <div className="worth-chart" ref={box} aria-label={`Net worth by year, from ${fl(start)} to ${fl(points.at(-1)!.worth)}`}>
      <svg width={w} height={h} role="img">
        <line x1={pad.l} x2={w - pad.r} y1={y(start)} y2={y(start)} className="start-line" />
        {lo < 0 && <line x1={pad.l} x2={w - pad.r} y1={y(0)} y2={y(0)} className="zero-line" />}
        <polyline points={line} className="worth-line" />
        <text x={pad.l} y={10} className="chart-label">Net worth at each year end. Highest {fl(hi)}</text>
        <text x={w - pad.r} y={y(start) - 3} className="chart-label" textAnchor="end">start {fl(start)}</text>
        <text x={pad.l} y={h - 3} className="chart-label">{firstYear + 1}</text>
        <text x={w - pad.r} y={h - 3} className="chart-label" textAnchor="end">{points.at(-1)!.year}: {fl(points.at(-1)!.worth)}</text>
      </svg>
    </div>
  );
}
