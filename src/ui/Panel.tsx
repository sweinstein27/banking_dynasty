// The panel slot: one document at a time in a gilt frame, opened from the side menu.
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export type PanelId = "gazette" | "ledger" | "bourse" | "houses" | "family" | "counting" | "letters";

export const PANELS: { id: PanelId; title: string; short: string; icon: IconName }[] = [
  { id: "gazette", title: "The Bourse Gazette", short: "Gazette", icon: "gazette" },
  { id: "ledger", title: "The Ledger", short: "Ledger", icon: "ledger" },
  { id: "bourse", title: "The Bourse", short: "Bourse", icon: "bourse" },
  { id: "houses", title: "The Houses of Frankfurt", short: "Houses", icon: "houses" },
  { id: "family", title: "The Family", short: "Family", icon: "family" },
  { id: "counting", title: "The Counting House", short: "Counting", icon: "counting" },
  { id: "letters", title: "Letters", short: "Letters", icon: "letters" },
];

export function PanelFrame({ id, onClose, children }: { id: PanelId; onClose?: () => void; children: ReactNode }) {
  const p = PANELS.find((x) => x.id === id)!;
  return (
    <section className={`frame slot slot-${id}`} aria-label={p.title}>
      <header className="frame-head">
        <Icon name={p.icon} />
        <h2>{p.title}</h2>
        {onClose && (
          <button className="close" onClick={onClose} aria-label={`Close ${p.title}`}>
            <Icon name="close" />
          </button>
        )}
      </header>
      <div className="frame-body">{children}</div>
    </section>
  );
}
