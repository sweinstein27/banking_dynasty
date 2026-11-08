// A readout's breakdown: a card that opens on click (never on hover) under the top bar, showing
// where the number comes from. Sections that add up show their total under a rule.
import { Popover } from "radix-ui";
import type { ReactNode } from "react";
import { gameData } from "../data";
import type { GameState } from "../sim/types";
import { keepUnits } from "./format";
import { breakdown, type BreakdownId, type Line } from "./model/breakdowns";
import type { PanelId } from "./Panel";
import { Term } from "./Term";

/** The panel that shows a readout's books in full. */
const PANEL_FOR: Record<BreakdownId, { id: PanelId; label: string }> = {
  cash: { id: "ledger", label: "Open the Ledger" },
  worth: { id: "ledger", label: "Open the Ledger" },
  deposits: { id: "ledger", label: "Open the Ledger" },
  upkeep: { id: "ledger", label: "Open the Ledger" },
  reputation: { id: "houses", label: "Open the Houses" },
  market: { id: "gazette", label: "Open the Gazette" },
  date: { id: "gazette", label: "Open the Gazette" },
};

export function BreakdownCard({ id, base, preview, onOpen, children }: {
  id: BreakdownId;
  base: GameState;
  preview: GameState;
  onOpen: (p: PanelId) => void;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger className={`readout readout-${id}`}>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="card-pop breakdown" side="bottom" align="center" sideOffset={6} collisionPadding={12}>
          <BreakdownBody id={id} base={base} preview={preview} onOpen={onOpen} />
          <Popover.Arrow className="card-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function BreakdownBody({ id, base, preview, onOpen }: { id: BreakdownId; base: GameState; preview: GameState; onOpen: (p: PanelId) => void }) {
  const b = breakdown(id, base, preview, gameData);
  const go = PANEL_FOR[id];
  return (
    <>
      <header className="card-head">
        <h3>{b.title}</h3>
        <Popover.Close className="close" aria-label="Close">×</Popover.Close>
      </header>
      <p className="card-summary">
        {b.summary}
        {b.term && <> <Term id={b.term}>More about this</Term></>}
      </p>
      {b.sections.map((s, i) => (
        <section key={i} className="bd-section">
          <h4>{s.heading}</h4>
          <dl className="bd-lines">
            {s.lines.map((l, j) => <BdLine key={j} line={l} />)}
            {s.total && <BdLine line={s.total} total />}
          </dl>
        </section>
      ))}
      <div className="card-foot">
        <Popover.Close className="secondary" onClick={() => onOpen(go.id)}>{go.label}</Popover.Close>
      </div>
    </>
  );
}

export function BdLine({ line, total = false }: { line: Line; total?: boolean }) {
  return (
    <>
      <dt className={total ? "total" : undefined}>{line.term ? <Term id={line.term}>{line.label}</Term> : line.label}</dt>
      <dd className={`${total ? "total" : ""} ${line.tone ? `tone-${line.tone}` : ""}`}>{keepUnits(line.value)}</dd>
    </>
  );
}
