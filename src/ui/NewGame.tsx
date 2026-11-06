import { useState } from "react";

const randomSeed = () => Math.floor(Math.random() * 1_000_000);

export function NewGame({ onStart, onLoad, onResume, error }: {
  onStart: (seed: number) => void;
  onLoad: () => void;
  /** Present when a game is in progress: returns to it without changes. */
  onResume: (() => void) | null;
  error: string | null;
}) {
  const [seedText, setSeedText] = useState(() => String(randomSeed()));
  const seed = Number(seedText);
  const valid = seedText.trim() !== "" && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff;

  return (
    <main className="start">
      <article className="title-page">
        <p className="ornament" aria-hidden="true">~ ~ ~</p>
        <h1>Banking Dynasty</h1>
        <p className="subtitle">The ledgers of a Frankfurt house, 1815 to 1850</p>
        <p className="ornament" aria-hidden="true">~ ~ ~</p>
        <p className="blurb">Lend to merchants, buy the debts of kings, back mills and railways, and raise heirs fit to keep the house. One quarter at a time, until the end of 1850.</p>

        {onResume && (
          <section className="title-block">
            <button className="primary wide" onClick={onResume}>Back to the current game</button>
            <p className="muted small">Starting or loading another game replaces the current one. Save it first if you want to keep it.</p>
          </section>
        )}

        <section className="title-block">
          <label className="field">
            <span>Seed: the same seed replays the same run</span>
            <input inputMode="numeric" value={seedText} onChange={(e) => setSeedText(e.target.value)} />
          </label>
          {!valid && <p className="error">The seed must be a whole number from 0 to 4,294,967,295.</p>}
          <div className="row">
            <button className="secondary" onClick={() => setSeedText(String(randomSeed()))}>New random seed</button>
            <button className="seal" disabled={!valid} onClick={() => onStart(seed)}>Open the house</button>
          </div>
        </section>

        <section className="title-block">
          <button className="secondary wide" onClick={onLoad}>Load a saved game from a file</button>
          {error && <p className="error">{error}</p>}
        </section>
      </article>
    </main>
  );
}
