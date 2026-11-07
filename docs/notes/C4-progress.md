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

| Date | Question | Decision |
|---|---|---|
| 2026-11-07 | How do technologies arrive? | Each technology (Rhine steam, gas lighting, railways, electric telegraph) has an adoption level from 0 to 1, read off a dated curve in `data/progress.json` (straight lines between points, quarter by quarter). Dated **stages** write news and open venture types. All numbers are data; the code holds no dates. |
| 2026-11-07 | Which stages and dates? | Rhine steamers 1827 Q2 (Concordia, Mainz-Cologne, 1 May 1827); Frankfurt gas 1828 Q3 (Knoblauch und Schiele, private houses; opens gasworks); Prussian optical telegraph 1833 Q3 (Berlin-Koblenz; government only, flavour); first railway 1835 Q4 (Nuremberg-Fuerth, 7 Dec 1835; no stage text because the existing event `railway-1835` already tells it); railway companies 1836 Q1 (opens railway); Taunus railway 1839 Q3 (Frankfurt-Hoechst, 26 Sep 1839); trunk lines 1842 Q1 (opens trunk railway); Imperial Continental's Obermainstrasse gasworks 1844 Q1; Main-Neckar through service 1846 Q3 (Aug 1846); electric telegraph Berlin-Frankfurt 1849 Q1 (Siemens and Halske). Sources in docs/research/technology.md, ventures-and-railways.md and bourse-1815-1850.md. |
| 2026-11-07 | Adoption curves. | Steam: 10% from 1827 Q2, 50% by 1832, full by 1840. Gas: 5% from 1828 Q3, 40% by 1844 (the second gasworks), 70% by 1850. Railways: 1% from 1835 Q4, 10% by 1840 (Taunus open), 35% by 1845, 70% by 1850. Telegraph: 0, then 1 from 1849 Q1 (it only drives the news hook). |
| 2026-11-07 | Which businesses gain and which decline? | A sector's earnings are multiplied by 1 + (at_full - 1) x adoption for each technology touching it. At full adoption: steam lifts shipping x1.15; gas lifts utilities x1.1; railways lift railways x1.15 and industry x1.1, cut canals to x0.6 and shipping to x0.85. Applied in the two earnings lines: listed companies (`stepMarkets`) and the house's own ventures (`stepVentures`). By 1850 (railways 70%) a canal earns about 72% of what it would have, and shipping about 0.9 x 1.15, close to level: steam first helps the river trade, then rails take it. |
| 2026-11-07 | How do borrowers' trades feel it? | As railway adoption rises, every borrower in a touched trade drifts by the change in adoption: river freight quality -0.2 and turnover x0.7 at full; ironmongers +0.05 and x1.15; timber +0.03 and x1.1. Quality stays within 0.05 to 0.98. This changes the borrower record, not loans.ts, so a loan already made keeps the quality it was priced at; only new loans and the books see the change. |
| 2026-11-07 | Player investment speeds a technology locally. | Each open section of the house's own gasworks adds 5 points of gas adoption (cap 10); each open section of its railway or trunk railway adds 2 points of railway adoption (cap 10). Only once the technology has arrived (curve above 0). Failed ventures do not count. The trunk-lines stage also comes early, from 1840 Q1, for a house with a railway section open, with its own news line. |
| 2026-11-07 | Venture unlocks. | A venture type opened by a stage opens on the stage's date, or earlier if the stage is reached early (`ventureBlocked`, `ventureOpen`). Others still use `unlock_year`. The check also opens by date alone, so a save from before C4 (no stages recorded) and tests that set the year directly behave as before. "Not before 1836" for a first-quarter stage, "Not before 1828 Q3" otherwise. `offers.ts`, `checkInvestVenture` and the markets menu use the same function, so the offer and the decision agree. |
| 2026-11-07 | Gasworks now open 1828 Q3, not 1828 Q1. | The research dates the Frankfurt gasworks to 1828 without a month; Q3 gives the news a believable lead after Hannover (1825) and Berlin (1826). `data/ventures.json` is unchanged (unlock_year 1828); a test checks each stage's year matches its venture's unlock_year. |
| 2026-11-07 | Telegraph and news delay (for C1). | `telegraphDelay(state, data, place, base)` returns `base` until a telegraph line from `place` to Frankfurt is open, then 0. One line in data: Berlin from 1849 Q1. C1's `newsDelay` should call it as its last line. Nothing calls it on this branch, so it has no effect until C1 merges. Hand-off note in the shared notes folder (`C4-progress-hooks.md`). At merge, if C1's id for Berlin is not `"berlin"`, change the place in `data/progress.json`. |
| 2026-11-07 | Randomness. | Progress draws no random numbers: curves and stages are dated, and the early trunk stage depends only on the house's own ventures. A test runs `resolveProgress` with an RNG that throws if called, and another checks the main RNG is in the same place after a turn. Progress adds no draws to any stream; runs still differ from main where strategies choose differently (earnings, unlock dates). |
| 2026-11-07 | Where it runs in End Turn. | `resolveProgress` already sits after `resolveEvents` (foundation). It sets adoption for the coming quarter, reaches stages due then, and drifts trades, so the news and the new levels appear with the quarter they belong to. |
| 2026-11-07 | Company listings. | Left as static data in `data/markets.json`; a test checks each railway and gas company lists no earlier than the stage that makes it possible. No new events added to `data/events.json`; no unlock dates changed. |
| 2026-11-07 | Harness strategies. | Venture-heavy backs a trunk railway as soon as one opens (30% of uncommitted free cash, again every 8 quarters). Investor and aggressive sell canal and shipping shares once railway adoption reaches 30% (about 1844). Cautious and bond-heavy ignore progress. |
| 2026-11-07 | Terminal. | `scripts/play.ts` prints one progress line each quarter: "Progress: Rhine steam 80%, Gas lighting 22%, Railways 12% (house +4), Electric telegraph not yet". |
| 2026-11-07 | Goldens. | None skipped or re-recorded by C4. Golden 1 (1815-1820) runs before any stage; the long snapshot goldens were already skipped on this base. SAVE_VERSION, PANIC_SEED and targets unchanged. |


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
