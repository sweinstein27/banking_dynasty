# B1: rivals that act

Decisions from milestone B1, in the style of docs/decisions.md, newest first. For the integrator to move into docs/decisions.md.

The decisions table from this file was moved into docs/decisions.md when the branch was merged (2026-11-09). What is left here is the supporting detail.

## For the integrator

- `SAVE_VERSION` is not bumped. `state.rivals` gains fields and `Staff` an optional `raise`; a save from before B1 has `rivals: {}`.
- The three "matches the recorded result" golden tests are skipped with a B1 comment.
- End Turn order is as the seam has it (after `resolveHouses` and `resolvePolitics`); B1 needs nothing moved.
- The UI (wave 3 screens) will want: `openPoachOffers` and `match_wage`; `heardPlots`, `plotWords` and `counter_plot`; `schemeTerms` (cost and odds in words); `rivalLoanOffer`/`rivalLoanWords` on large requests; `heldPaper`, `paperRoom`, `paperCost`; `shortHanded`. The House's wage tiles should show `wageOf` (role wage plus `raise`).
- Files touched outside B1's ownership: `src/sim/capacity.ts` (pools for `scheme`, `counter_plot`, free `match_wage`), `src/sim/finance/contracts.ts` (where A5's rival bids actually live), `src/sim/save.ts` (the `rival_paper` balance check), `src/sim/houses.ts` (`failHouse` exported), `scripts/play.ts` (the Rivals menu and the rival rate on the lend screen), `tests/strategies.test.ts` (bond-heavy measured in gulden), `tests/golden.test.ts` (skips). Light touches as allowed: `src/sim/systems/counting.ts` (`raise`, `freeDesks`, `joinStaff`), `src/sim/systems/credit.ts` (the sale buyer).

## Open questions

- **The `rival-rumours` letter** in data/events.json is kept alongside the new plots: it is the event layer, and plots are the system. Scott may prefer to retire it so Kessler's rumours come from one place.
- **Prestige targets (for B3):** none proposed by B1.
- **A partner is never poached.** Settled for now; a partner leaving for a rival could be a B2 story later.
- **No harness strategy lures clerks or presents paper.** They are there for the player; the harness only measures defending, rumours (aggressive) and holding paper (bond-heavy).

## Harness (300 seeds, before and after B1)

All seven targets pass both before and after. "After" is the final run, with the aggressive fix below.

| Strategy | Bankrupt | Median | p90 | Strong |
| --- | --- | --- | --- | --- |
| idle | 0.0% to 0.0% | 32,851 to 33,080 | 38,667 to 39,250 | 0% to 0% |
| cautious | 3.3% to 3.3% | 64,276 to 50,055 | 216,079 to 177,921 | 25.3% to 18.0% |
| aggressive | 31.7% to 34.0% | 232,812 to 183,834 | 1,145,917 to 939,283 | 59.7% to 53.0% |
| bond_heavy | 20.3% to 18.3% | 81,125 to 70,053 | 269,957 to 282,215 | 31.0% to 29.0% |
| venture_heavy | 7.3% to 11.0% | 95,450 to 93,213 | 240,119 to 246,283 | 27.3% to 29.3% |
| investor | 4.0% to 5.0% | 72,954 to 71,810 | 212,980 to 204,176 | 20.7% to 19.3% |
| cautious_no_family | 5.7% to 6.0% | 53,565 to 46,304 | 173,228 to 174,150 | 16.7% to 14.3% |

Rivals make the game harder for everyone but idle. The biggest moves:

- **Cautious** loses about a fifth of its median. It pays to counter plots and to match wages, and its head's time goes on counters.
- **Aggressive** goes bust a little more often (31.7% to 34.0%) and its median falls about a fifth, mostly from rivals taking its large loans at the borrower's top rate (loans alone: median 235k to 165k on the same seeds). A first run showed 41.0% bankrupt; the cause was the harness maker, not the sim: the yearly rumours scheme ran last in the quarter and spent the 800 fl. left after aggressive had lent, bought and invested, so End Turn forced sales at a discount. An inert scheme (never works, never found) gave the same 43.7%; at no cost, 30.7%. Opinion and reputation were ruled out (found-out schemes costing no reputation: still 41.0%). The maker now schemes only with free cash of 10 times the cost; what is left over (34.0% against 30.7% with no scheme) matches the scheme's real cost to reputation (43.0 against 45.2 going into 1825).
- **Venture-heavy** busts rise from 7.3% to 11.0%; it never counters plots, so rumour withdrawals land in panics.

Balance is the integrator's after merging; the levers are all in data/rivals.json.
