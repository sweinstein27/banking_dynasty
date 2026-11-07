// The side menu: one icon per panel, each with its name always shown (never hover-only), and a
// count on Letters while any wait. The quill at the foot opens save, load and new game.
import { unansweredLetters } from "../sim/letters";
import type { GameState } from "../sim/types";
import { Icon } from "./icons";
import { PANELS, type PanelId } from "./Panel";

const MENU: PanelId[] = ["gazette", "ledger", "bourse", "houses", "family", "counting", "letters"];

export function SideMenu({ open, onOpen, state, onMenu }: {
  open: PanelId;
  onOpen: (id: PanelId) => void;
  state: GameState;
  onMenu: () => void;
}) {
  const waiting = unansweredLetters(state).length;
  return (
    <nav className="rail" aria-label="Panels">
      {MENU.map((id) => {
        const p = PANELS.find((x) => x.id === id)!;
        const badge = id === "letters" && waiting > 0 ? waiting : 0;
        return (
          <button key={id} className={open === id ? "rail-button on" : "rail-button"} aria-pressed={open === id} onClick={() => onOpen(id)}>
            <Icon name={p.icon} />
            <span>{p.short}</span>
            {badge > 0 && <span className="badge" aria-label={`${badge} waiting`}>{badge}</span>}
          </button>
        );
      })}
      <button className="rail-button game" onClick={onMenu}>
        <Icon name="quill" />
        <span>Game</span>
      </button>
    </nav>
  );
}
