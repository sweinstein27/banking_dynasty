// Holds the running game and calls the sim. No game rules live here: every change goes through
// applyDecisions or endTurn, and a refusal is shown with the sim's own reason.
import { useState } from "react";
import { gameData } from "../data";
import { applyDecisions } from "../sim/decisions";
import { newGame } from "../sim/init";
import { createRng } from "../sim/rng";
import { parseSave, toSave } from "../sim/save";
import { endTurn } from "../sim/turn";
import type { Decision, GameState } from "../sim/types";

export interface Game {
  seed: number;
  /** RNG internal state at the start of the current turn. */
  rngState: number;
  /** State at the start of the current turn. */
  base: GameState;
  /** Decisions queued this turn. */
  queued: Decision[];
  /** `base` with the queued decisions applied: what the panels show. */
  preview: GameState;
}

function start(seed: number): Game {
  const base = newGame(gameData);
  return { seed, rngState: createRng(seed).state, base, queued: [], preview: base };
}

export function useGame() {
  const [game, setGame] = useState<Game | null>(null);

  return {
    game,
    newGame(seed: number) {
      setGame(start(seed));
    },
    /** Queues a decision. Returns the sim's reason if it refuses, or null. */
    queue(d: Decision): string | null {
      if (!game) return "No game";
      const r = applyDecisions(game.preview, [d], gameData);
      if (!r.ok) return r.reason;
      setGame({ ...game, queued: [...game.queued, d], preview: r.state });
      return null;
    },
    clearQueue() {
      if (game) setGame({ ...game, queued: [], preview: game.base });
    },
    endTurn() {
      if (!game) return;
      const rng = createRng(game.rngState);
      const next = endTurn(game.base, game.queued, rng, gameData);
      setGame({ ...game, rngState: rng.state, base: next, queued: [], preview: next });
    },
    saveText(): string | null {
      return game ? toSave(game.base, game.seed, game.rngState, game.queued) : null;
    },
    /** Loads a save file's text. Returns the reason if it is refused, or null. */
    load(text: string): string | null {
      const r = parseSave(text, gameData);
      if (!r.ok) return r.reason;
      const { seed, rng_state, state, queued } = r.save;
      const replay = applyDecisions(state, queued, gameData);
      if (!replay.ok) return replay.reason;
      setGame({ seed, rngState: rng_state, base: state, queued, preview: replay.state });
      return null;
    },
  };
}

export type GameApi = ReturnType<typeof useGame>;
