# Banking Dynasty Sim

A turn-based banking dynasty game set in Frankfurt, 1815 to 1850. The full design is in `docs/spec.md`. Read it before starting any task.

## How we work

- **Plan first.** Before writing code for a new feature, show a short plan (files to touch, functions to add, how it will be tested) and wait for approval.
- **Follow the build plan** in `docs/spec.md`. Work one week's milestone at a time. Don't build ahead (no UI before the sim core runs in the terminal).
- **Small steps.** One feature per session or commit. Commit after each working step with a clear message.
- **Fix root causes**, not symptoms. If a test fails, find out why before changing the test.
- **Ask, don't assume,** when the spec is unclear. Note the question in `docs/decisions.md` with the answer once settled.

## Parallel work

- Several sessions may build milestones at once. Read `docs/parallel.md` first: it says which files each session owns and the rules for saves, golden runs, tuning and notes.

## Architecture rules

- TypeScript throughout, strict mode on.
- `src/sim/` holds the game logic as pure functions: `(state, decisions, rng) -> newState`. No UI, DOM, or I/O imports in `src/sim/`.
- All randomness goes through a seeded RNG passed in as an argument. Never call `Math.random()` in sim code.
- Game data (events, starting values, tuning constants) lives in `data/*.json`, not hard-coded. Tuning numbers belong in `data/tuning.json`.
- Every ledger change writes a `ledger_entry` so any run can be audited.
- `src/ui/` (React) only reads state and dispatches decisions.
- `scripts/` holds CLI tools: a terminal play mode and, from week 6, the balancing harness.

## Libraries

- Use the libraries listed under "Libraries" in docs/spec.md. Don't add other runtime dependencies without proposing them in the plan first.
- Keep the existing RNG in src/sim/rng.ts. Do not replace it.
- No game engine. No AI or LLM calls in game code.

## UI rules

- Must be fully playable with a trackpad: click only, no drag-and-drop, no hover-only information, large click targets.
- Four panels: News, Ledger, Family, Decisions, plus an End Turn button.

## Testing

- Use Vitest. Every sim function gets unit tests, including edge cases (zero cash, bankruptcy, a head of house dying mid-year).
- A fixed-seed "golden run" test plays 20 turns and checks the result is stable, so balance changes are deliberate.
- Run tests before saying a task is done.

## Writing style

- No em dashes in game text or docs.
- Historical event text must be checked against real dates. Flag anything uncertain in `docs/decisions.md` rather than guessing.
