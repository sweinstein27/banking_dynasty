// Small pieces shared by wave 1's screens: a click-open card of sums, a dialog for one decision,
// and a hook that queues a decision and keeps the sim's refusal to show.
import { Dialog, Popover } from "radix-ui";
import { useState, type ReactNode } from "react";
import type { Decision } from "../sim/types";
import { BdLine } from "./Breakdown";
import { keepUnits } from "./format";
import type { Section } from "./model/breakdowns";
import { Term } from "./Term";

/** A number that opens, on click, the sums behind it. */
export function SumCard({ title, summary, term, sections, children, className = "" }: {
  title: string;
  summary: string;
  term?: string;
  sections: Section[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger className={`sum-trigger ${className}`}>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="card-pop breakdown" side="bottom" align="start" sideOffset={4} collisionPadding={12}>
          <SumBody title={title} summary={summary} term={term} sections={sections} />
          <Popover.Arrow className="card-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SumBody({ title, summary, term, sections }: { title: string; summary: string; term?: string; sections: Section[] }) {
  return (
    <>
      <header className="card-head">
        <h3>{title}</h3>
        <Popover.Close className="close" aria-label="Close">×</Popover.Close>
      </header>
      <p className="card-summary">
        {keepUnits(summary)}
        {term && <> <Term id={term}>More about this</Term></>}
      </p>
      <Sums sections={sections} />
    </>
  );
}

/** Sections of lines, each with its total under a rule. */
export function Sums({ sections }: { sections: Section[] }) {
  return (
    <>
      {sections.map((s, i) => (
        <section key={i} className="bd-section">
          <h4>{s.heading}</h4>
          <dl className="bd-lines">
            {s.lines.map((l, j) => <BdLine key={j} line={l} />)}
            {s.total && <BdLine line={s.total} total />}
          </dl>
        </section>
      ))}
    </>
  );
}

/** A dialog for one decision or one sheet. Closes on Escape, the close button, or the overlay. */
export function ActionDialog({ open, title, onClose, className = "", children }: {
  open: boolean;
  title: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className={`dialog ${className}`} aria-describedby={undefined}>
          <header className="dialog-head">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="close" aria-label="Close">×</Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Queues decisions, keeping the last refusal to show. `run` returns true if the sim took it. */
export function useRun(onDecide?: (d: Decision) => string | null) {
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    clear: () => setError(null),
    run(d: Decision): boolean {
      if (!onDecide) return false;
      const reason = onDecide(d);
      setError(reason);
      return reason === null;
    },
  };
}

/** A button for an action with a price, and, when the sim would refuse it, the reason under it in words. */
export function ActButton({ label, blocked, onClick, primary = false, disabled = false }: {
  label: string;
  blocked: string | null;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="act">
      <button className={primary ? "primary" : "secondary"} disabled={disabled || blocked !== null} onClick={onClick}>{keepUnits(label)}</button>
      {blocked && <span className="act-why">{keepUnits(blocked)}</span>}
    </div>
  );
}

/** A refusal from the sim, as a line under the controls. */
export function Refused({ error }: { error: string | null }) {
  return error ? <p className="error">Refused: {keepUnits(error)}</p> : null;
}
