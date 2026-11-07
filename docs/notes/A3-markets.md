# A3 markets: decisions

Decisions from the A3 session (branch `claude/a3-markets-e93df9`), in the style of docs/decisions.md, for the integrator to move there. Plan approved by Scott on 2026-11-06. Historical sources: docs/research/bourse-1815-1850.md, commodities-and-harvests.md and utilities.md (history-research branch, commit 453152c).


## Harness results

Seeds 1 to 1,000, 2026-11-06, `npm run harness -- --runs 1000`, against main at `450eda8` on the same seeds. Medians and p90 in fl.

| Strategy | Bankrupt (main) | Median (main) | p90 (main) | Bankrupt (A3) | Median (A3) | p90 (A3) | Strong (A3) |
| idle | 0.0% | 35,402 | 41,195 | 0.0% | 35,500 | 41,381 | 0.0% |
| cautious | 0.7% | 79,495 | 225,554 | 0.5% | 87,263 | 232,065 | 30.3% |
| aggressive | 33.0% | 56,932 | 353,295 | 27.0% | 96,820 | 533,539 | 38.7% |
| bond_heavy | 27.8% | 43,692 | 334,200 | 27.4% | 53,721 | 441,965 | 28.2% |
| venture_heavy | 44.1% | 6,691 | 454,226 | 1.4% | 174,337 | 341,835 | 58.8% |
| investor (new) | | | | 0.2% | 172,627 | 326,100 | 60.5% |
| cautious_no_family | 0.8% | 88,120 | 250,247 | 2.0% | 89,946 | 251,856 | 35.9% |

Targets on A3: T1, T3, T4, T5 and T7 pass. **T2 fails** (aggressive dominates bond-heavy on median, p90 and bankruptcy) and **T6 fails** (aggressive bankrupt in 27.0% of runs, against 30 to 60%). On main all seven pass. Not tuned further: balance is measured after merging (docs/parallel.md rule 4), and the main levers there are outside A3 (lending, bonds, the counting house's capacity).

What changed and why, from flows.csv (average per run):

- **Venture-heavy** went from the weakest to the strongest strategy. Its capital is now called in instalments and a floated stake turns into shares it can sell cheaply in a run, so it almost never goes bankrupt (44.1% to 1.4%). Per run: short ventures +164k fl. paid out over stake against 135k fl. lost to failures; dividends on floated ventures 111k fl.; share revaluation +32k fl.; company failures -30k fl.
- **Investor:** dividends 154k fl., revaluation +31k fl., company failures -41k fl.; grain roughly breaks even after storage (about -4k fl.). Its p10 (70k fl.) is far above every other strategy's: shares carry too little ruin risk compared with bonds and loans. **For after merging:** more equity tail risk (deeper panic falls, dividend cuts) or a lower investor reserve to test.
- **Aggressive** is safer than on main (33.0% to 27.0% bankrupt): its shipping venture now draws cash over two years instead of all at once, and its railway shares are a liquid buffer.
- **Cautious** barely uses the markets: its utilities purchase needs 30,000 fl. of free cash and an action left over, and it seldom has both (dividends of about 400 fl. a run).
- Floating opens on average slightly below the stake (listing gain about -3k fl. a run for venture-heavy), because a great work floats on its first section's earnings, in whatever mood the quarter has.

Tuning between the first and second 1,000-seed runs: medium and great venture yields set so a floated venture opens about 15% above cost (yield x payout / required yield x 0.9 near 1.15: mill 8%, shipping 7.7%, ironworks 8%, gasworks 6%, railway 6.4%, canal 6.4%, mine 8%, trunk railway 6.4%), and aggressive's railway and industry purchases cut from 30% to 15% of free cash. The first run had venture-heavy at a 208,566 fl. median with 1.6% bankrupt, and aggressive at 25.8% bankrupt (T5 also failed at 11.9%).

Other checks: `npm run typecheck` and `npm test` pass (484 tests, 5 skipped: the goldens and one news test that depend on the old venture rules). A production build of the UI succeeds and the Venture dialog compiles unchanged; it sends the amount as a commitment, and LedgerBook's "pays X in N qtr" line is now only right for short ventures. Not checked in the browser: port 5173 was in use by another session.

## Files touched outside A3's ownership

Light changes, each needed for the system to work:

- `src/sim/turn.ts`: one line calling `markMarkets` after `markBonds`, and the End Turn comment.
- `src/sim/liquidity.ts`: bank runs sell shares and goods after bonds (`raiseFromMarkets`); unlisted stakes sell at no less than the private-sale discount; a stake sold to nothing has no more calls.
- `src/sim/news.ts`: the paid-out or failed venture stake comes from the quarter's ventures-account entries.
- `src/sim/save.ts`: `shares` and `commodities` in the books check; a check that `state.markets` is complete.
- `src/sim/types.ts`: the `Venture` type (allowed) and `"markets"` in `NewsKind`.
- `src/sim/tuning.ts`: `VentureType` (tiers, calls, overruns, sections, sector, listing), the `ventures` section (allowed) and two keys in `forced_sale` (`share_discount`, `commodity_discount`).
- `data/tuning.json`: the `ventures` section (allowed) and the same two `forced_sale` keys.
- `src/data.ts`: `ventures` cast to `VentureType[]` (the JSON's `tier` string).
- `src/harness/strategies.ts`: the `investor` strategy in the list (allowed); aggressive's and venture-heavy's commitments sized on free cash less calls still owed.
- `scripts/play.ts`: the `[m] Markets` menu, the markets line in the status, and holdings; the menu itself is in the new `scripts/markets-menu.ts`.
- Tests: `tests/family.test.ts` and `tests/news.test.ts` (venture assertions rewritten for the new rules; one news test skipped), `tests/golden.test.ts` (three skips, each with an A3 comment).

Not touched: `src/ui/`. The Venture dialog and LedgerBook compile unchanged.

The decisions table from this file was moved into docs/decisions.md when the branch was merged (2026-11-07). What is left here is the supporting detail.
