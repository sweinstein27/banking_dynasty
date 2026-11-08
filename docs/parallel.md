# Working in parallel

From 2026-11-06 the roadmap in docs/spec.md is built by several sessions at once, each in its own git worktree and branch, merged into `main` by the integrating session. These rules keep the branches from colliding. CLAUDE.md still applies in full: plan first and wait for Scott's approval, sim before UI, tests for everything, no em dashes.

## Who owns what (wave 1)

| Session | Milestone | Owns (may change freely) | May touch lightly |
| --- | --- | --- | --- |
| Credit | A1 | `src/sim/systems/credit.ts`, `data/credit.json`, `src/sim/borrowers.ts`, `src/sim/loans.ts`, `src/sim/offers.ts`, `data/borrowers.json`, `src/harness/systems/credit.ts`, new `tests/credit*.test.ts` | The `Borrower`, `Loan` and `LendDecision`/`ReportDecision` types in `src/sim/types.ts`; the loan loop in `src/sim/turn.ts`; the `loans` section of `data/tuning.json`; the existing Lend and Report dialogs, only to keep them compiling |
| Counting house | A2 | `src/sim/systems/counting.ts`, `src/sim/capacity.ts`, `data/counting.json`, `src/harness/systems/counting.ts`, new `tests/counting*.test.ts` | `actions_per_turn` in `data/tuning.json` and `tuning.ts` (to retire it); the coins on the Desk, only to keep them compiling |
| Markets | A3 | `src/sim/systems/markets.ts`, `data/markets.json`, `src/sim/ventures.ts`, `data/ventures.json`, `src/harness/systems/markets.ts`, new `tests/markets*.test.ts` | The `Venture` type and `InvestVentureDecision`; the `ventures` section of `data/tuning.json`; the save check's list of books in `src/sim/save.ts`; the Venture dialog, only to keep it compiling |
| Interface | A4 | Everything in `src/ui/` and `index.html` | Nothing in `src/sim/`; read sim functions, never change them |
| History research | none | `docs/research/` | Nothing else |

Each system adds its own decisions, ledger categories, ledger accounts (markets), state and data through the types in its `src/sim/systems/*.ts` file, which `src/sim/types.ts` and `src/sim/tuning.ts` already include. Its End Turn step (`resolveCredit`, `resolveCounting`, `resolveMarkets`) is already called from `src/sim/turn.ts`; its starting state from `src/sim/init.ts`; its harness behaviour from `src/harness/systems/*.ts`. Every decision checks and uses capacity only through `checkCapacity` and `useCapacity` in `src/sim/capacity.ts`.

## Who owns what (wave 2)

Wave 1 is merged into `main` and tuned (2026-11-07). Wave 2 adds four new systems through the same seams (`src/sim/systems/finance.ts`, `people.ts`, `europe.ts`, `progress.ts`, each with a data file, an End Turn hook, decision routing and harness makers already wired) and builds wave 1's screens.

| Session | Milestone | Owns (may change freely) | May touch lightly |
| --- | --- | --- | --- |
| Screens | Wave 1's screens in the A4 shell | Everything in `src/ui/` and `index.html` | Nothing in `src/sim/`; read sim functions, never change them. If a screen needs a sim helper that doesn't exist, write it in `src/ui/model/` |
| High finance | A5 | `src/sim/systems/finance.ts`, `data/finance.json`, `src/harness/systems/finance.ts`, new `tests/finance*.test.ts` | `src/sim/houses.ts` (houses borrowing from you, their failures feeding auctions); the borrower default path in `src/sim/borrowers.ts`/`loans.ts` (auctions of collateral); `data/events.json` for its own letters |
| People | B2 | `src/sim/systems/people.ts` (state slot `agendas`), `data/people.json`, `src/harness/systems/people.ts`, new `tests/people*.test.ts` | `src/sim/family.ts` (succession claims, feuds, education paths) and `src/sim/traits.ts`; `data/events.json` for its own letters; `src/sim/news.ts` for its own news |
| Europe | C1 | `src/sim/systems/europe.ts`, `data/europe.json`, `src/harness/systems/europe.ts`, new `tests/europe*.test.ts` | `src/sim/news.ts` (news that travels by courier: expose `newsDelay` and let others call it); `data/states.json`; `src/sim/systems/counting.ts` only for branch staff |
| Progress | C4 | `src/sim/systems/progress.ts`, `data/progress.json`, `src/harness/systems/progress.ts`, new `tests/progress*.test.ts` | Unlock dates in `data/ventures.json` and `data/markets.json`; `data/events.json` for its own events. News speed from the telegraph: call Europe's `newsDelay` through a hook in your own module, defaulting to no change until Europe merges |

The map of Europe, and screens for wave 2's systems, come in wave 3 on the shell.

## Who owns what (wave 3)

Wave 2 is merged into `main` and tuned (2026-11-08). Wave 3 adds four systems through the same seams (`src/sim/systems/rivals.ts`, `legacy.ts`, `politics.ts`, `war.ts`, each with a data file, an End Turn hook, a `xBook` counted in net worth, decision routing and harness makers already wired; state slots `rivals`, `legacy`, `politics`, `war`) and builds wave 2's screens. End Turn order: `resolveWar` just before `resolveEurope`; `resolvePolitics` then `resolveRivals` just after `resolveHouses`; `resolveLegacy` last, after the markets are marked, so it scores the finished quarter. A session that needs its hook elsewhere says so in its notes; the integrator moves it.

| Session | Milestone | Owns (may change freely) | May touch lightly |
| --- | --- | --- | --- |
| Screens | Wave 2's screens in the shell: high finance, people (agendas, letters, study), progress, and the clickable SVG map of Europe (cities, news delay, branches, bills) | Everything in `src/ui/` and `index.html` | Nothing in `src/sim/`; read sim functions, never change them. Sim helpers a screen needs go in `src/ui/model/` |
| Rivals | B1 | `src/sim/systems/rivals.ts`, `data/rivals.json`, `src/harness/systems/rivals.ts`, new `tests/rivals*.test.ts` | `src/sim/houses.ts` (what houses do each quarter); `src/sim/systems/finance.ts` (rival bids on contracts); `src/sim/systems/counting.ts` (poaching staff); the sold-loan path in `src/sim/systems/credit.ts`; `data/events.json` for letters with ids starting `rivals-` |
| Legacy | B3 (simulation only; the family tree view comes in wave 4) | `src/sim/systems/legacy.ts`, `data/legacy.json`, `src/harness/systems/legacy.ts`, new `tests/legacy*.test.ts` | Nothing else: prestige reads other systems' state through their exported functions. Propose prestige-based balance targets in notes; `targets.ts` stays the integrator's |
| Politics | C2 | `src/sim/systems/politics.ts`, `data/politics.json`, `src/harness/systems/politics.ts`, new `tests/politics*.test.ts` | `data/events.json` for letters with ids starting `politics-`; `src/sim/news.ts` for its own news. Effects on other systems (contracts opened by influence, softer crises) are exported from `politics.ts` as functions defaulting to no change; the integrator wires them in after merging |
| War | C3 | `src/sim/systems/war.ts`, `data/war.json`, `src/harness/systems/war.ts`, new `tests/war*.test.ts` | City status in `src/sim/europe/world.ts` and the `history` list in `data/europe.json` (extend, don't replace C1's); `data/states.json` (war loan demand); `data/events.json` for events with ids starting `war-`; `src/sim/news.ts` for its own news |

Historical dates and facts (Senate and Diet rules, titles, wars, the 1830, 1833 and 1848 risings) are checked against `docs/research/` or a source, or flagged in the session's notes. Rivals and politics both change what other houses do: rivals owns their actions, politics only their opinion through `changeOpinion`.

## Rules for every session

1. **Plan first.** Post the milestone's detailed plan and wait for Scott's approval in your own session.
2. **Stay in your files.** If you must change a file you don't own, keep the change small and say so in your final report.
3. **Don't bump `SAVE_VERSION`, don't re-record golden snapshots and don't change `PANIC_SEED`.** If your work changes the golden runs, mark those tests `.skip` with a one-line comment naming your milestone; the integrator re-records them after merging.
4. **Don't retune numbers outside your system** and don't change `src/harness/targets.ts`. Run the harness to see your effect, but balance is measured after merging.
5. **Decisions go in `docs/notes/<milestone>.md`** (for example `docs/notes/A1-credit.md`), in the style of docs/decisions.md. The integrator moves them into docs/decisions.md.
6. **Keep the build green on your branch:** `npm run typecheck` and `npm test` pass before each commit (skipped goldens aside).
7. **Commit on your own branch** with clear messages. Never push, never merge into `main`; the integrator does that.
8. **The interface session** builds the new shell and moves every existing feature into it. New screens for credit, the counting house and markets come in wave 2, built on the shell.

## Merging (the integrating session)

Branches are merged into `main` one at a time, in the order they finish: conflicts resolved, the save version bumped, the golden runs re-recorded (re-picking the panic seed if needed), the full harness run against the targets, and docs/notes moved into docs/decisions.md. Scott is told before each merge.
