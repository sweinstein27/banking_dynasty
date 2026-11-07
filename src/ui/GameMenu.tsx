// The game menu, opened from the quill: save, load, start again, or carry on.
import { Dialog } from "radix-ui";

export function GameMenu({ open, onClose, onSave, onLoad, onNew, error }: {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  onLoad: () => void;
  onNew: () => void;
  error: string | null;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog game-menu" aria-describedby={undefined}>
          <Dialog.Title>The game</Dialog.Title>
          <div className="menu-buttons">
            <button className="primary" onClick={() => { onSave(); onClose(); }}>Save this game to a file</button>
            <button className="secondary" onClick={onLoad}>Load a saved game</button>
            <button className="secondary" onClick={onNew}>New game or title page</button>
            <Dialog.Close asChild>
              <button className="secondary">Back to the game</button>
            </Dialog.Close>
          </div>
          {error && <p className="error">{error}</p>}
          <p className="muted small">Loading or starting another game replaces this one. Save it first to keep it.</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
