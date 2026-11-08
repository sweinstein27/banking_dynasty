# C4 progress: decisions

Decisions from the C4 session (branch `claude/c4-progress-fea830`), in the style of docs/decisions.md, for the integrator to move there. Plan approved by Scott on 2026-11-07. Historical sources: docs/research/technology.md, ventures-and-railways.md, bourse-1815-1850.md and README.md.


## Harness results

Seeds 1 to 1,000, 2026-11-07, `npm run harness -- --runs 1000`, against the base `fe0ca2b` (wave 2 foundation) on the same seeds. Medians and p90 in fl.

| Strategy | Bankrupt (base) | Median (base) | p90 (base) | Strong (base) | Bankrupt (C4) | Median (C4) | p90 (C4) | Strong (C4) |
|---|---|---|---|---|---|---|---|---|
| idle | 0.0% | 34,047 | 39,892 | 0.0% | 0.0% | 34,047 | 39,892 | 0.0% |
| cautious | 4.1% | 51,986 | 197,622 | 21.1% | 4.3% | 51,625 | 202,692 | 21.5% |
| aggressive | 31.4% | 169,504 | 735,944 | 51.8% | 31.1% | 173,923 | 824,048 | 51.8% |
| bond_heavy | 20.5% | 65,650 | 282,759 | 29.5% | 20.8% | 70,962 | 285,182 | 30.8% |
| venture_heavy | 8.9% | 97,332 | 251,953 | 31.7% | 8.8% | 97,415 | 258,031 | 29.6% |
| investor | 3.6% | 65,670 | 174,387 | 14.6% | 3.2% | 72,100 | 184,810 | 17.3% |
| cautious_no_family | 4.2% | 47,452 | 213,686 | 23.0% | 4.1% | 47,870 | 212,779 | 22.8% |

**All seven targets pass on both.** C4: T1 strong finishes cautious 21.5%, aggressive 51.8%, bond-heavy 30.8%, venture-heavy 29.6%, investor 17.3%; T4 cautious 4.3% bankrupt; T5 cautious 0.4% and aggressive 13.9% in 1825-29; T6 aggressive 31.1%; T7 51,625 against 47,870.

Progress shifts balance little, as expected for a system that only scales earnings by up to 15% late in the game. Investor gains most (median +6,400 fl.), likely from selling canals and shipping around 1844 and from railway and industry earnings rising. Aggressive's p90 rises (+88,000 fl.), likely because its railway and industry holdings earn more in the 1840s. Venture-heavy's strong finishes dip 2 points, probably because its trunk railway calls capital in the late 1840s and has not paid back by 1850 (causes inferred, not traced in flows.csv). **Watch:** cautious bankruptcy 4.3% stays near T4's 5% limit (unchanged by C4 within noise).


## Decisions

|---|---|---|


## Uncertain, flagged

- **Concordia "first":** sources disagree on which Rhine steamer ran first; the text names Concordia's first Mainz-Cologne run on 1 May 1827 and does not call it the first.
- **Gas month:** Frankfurt 1828 has no month in the sources (one search summary); Q3 is a design choice. Imperial Continental's works are dated 1844 in the research README, not checked further.
- **Optical telegraph:** completion in 1833 is from one page; the quarter (Q3) is a guess.
- **Electric telegraph:** "early 1849", February per one source; length quoted from 500 to 670 km, so the text gives no length.
- **Main-Neckar:** August 1846 through service is from a search summary of English Wikipedia and German Wikipedia's passenger date (1 Aug 1846); docs/research/technology.md says it was not confirmed there.
- **Railway curve:** only the 1835 and 1839 points rest on dates; the 1845 and 1850 levels are interpolated design numbers.
- **All factors** (sector multipliers, trade drifts, local push) are design numbers, not historical figures.


## Files touched outside C4's ownership

One-line hooks, each needed for the system to have an effect:

- `src/sim/ventures.ts`: `checkInvestVenture` uses `ventureBlocked`; `stepVentures` multiplies earnings by `sectorFactor`.
- `src/sim/systems/markets.ts`: `stepMarkets` multiplies company earnings by `sectorFactor`.
- `src/sim/offers.ts`: the venture offer's "blocked" label comes from `ventureBlocked`.
- `scripts/markets-menu.ts`: the locked label comes from `ventureBlocked`.
- `scripts/play.ts`: prints `progressLine` in the status.

The decisions table from this file was moved into docs/decisions.md when the branch was merged (2026-11-07). What is left here is the supporting detail.
