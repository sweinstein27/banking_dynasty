# First Claude Code session

Paste this as your first message to Claude Code, from inside the banking-dynasty folder:

---

Read CLAUDE.md and docs/spec.md. We're starting Week 1 of the build plan: the sim core.

Goal for this session: a TypeScript project where I can run a terminal command, play 8 quarterly turns of lending to merchants, and see the ledger after each turn.

Scope:
- Project setup: TypeScript (strict), Vitest, a seeded RNG utility
- Game state types for world_state, house and loan from the spec's data model
- Starting values in data/tuning.json
- One decision only: lend to a merchant (amount, rate, borrower quality)
- End Turn: collect interest, roll defaults using the formula in the spec, write ledger entries, advance the quarter
- scripts/play.ts: a simple terminal loop to make a decision and end turn
- Unit tests for interest, defaults and turn advance, plus one fixed-seed test

Show me the plan first. Don't start writing code until I approve it.

---

## Each later week

Start a fresh session with: "Read CLAUDE.md, docs/spec.md and docs/decisions.md. We're on Week N: <milestone>. Show me the plan first."

## When to come back to Claude in the app

- Changing the design: update the doc there, export it, replace docs/spec.md
- Writing historical event text and checking dates
- Reading balancing results from the week 6 harness and deciding what to tune
