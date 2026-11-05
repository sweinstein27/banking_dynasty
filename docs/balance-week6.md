# Balance baseline, Week 6

Measured on 2026-11-05 with the game as it stood after Week 5 (commit f789d61). Nothing was tuned: this is the starting point for Week 7.

## How to reproduce

    npm run harness -- --runs 1000

Plays each strategy on seeds 1 to 1,000 (the same seeds for all, so the runs are paired), writes `out/runs.csv` (one row per run) and `out/years.csv` (net worth and reputation at every year end), and prints the table below. 5,000 full runs take about 136 seconds. The cash-flow, default and mood figures further down came from a one-off script over seeds 1 to 200; Week 7 question 8 asks whether the harness should write them too.

The strategies are in `src/harness/strategies.ts`. They are simple probes, not good players:

| Strategy | Plays |
| --- | --- |
| idle | Nothing |
| cautious | Reserve 40% of deposits (60% once worried), a report on the best-paying request, lends 25% of free cash to requests whose estimate's low end is 0.6 or more, educates the eldest untrained heir every turn it can afford to, buys the safest open bonds, pays out slowly in a panic when short |
| aggressive | No reserve, lends 60% of free cash to the best-paying request, buys the riskiest open bonds, backs a shipping line every year, borrows from Kessler when a panic leaves it short |
| bond_heavy | Reserve 15% of deposits, most free cash into the two open states with the best coupon after expected defaults, 10% lending to the safest request |
| venture_heavy | Reserve 10% of deposits, half of free cash into the best venture at today's odds, half of the rest into the next best |

## Results: seeds 1 to 1,000

Start net worth 50,000 fl. A "strong finish" is 150,000 fl. or more at the end of 1850 (a harness measure, set in the Week 6 plan). A bankrupt run's final net worth is its net worth when it closed.

| Strategy | Bankrupt | p10 | Median | Mean | p90 | Above start | Strong |
| --- | --- | --- | --- | --- | --- | --- | --- |
| idle | 0.0% | 42,303 fl. | 46,696 fl. | 46,644 fl. | 51,189 fl. | 15.9% | 0.0% |
| cautious | 12.3% | -3,258 fl. | 16,915 fl. | 20,535 fl. | 47,226 fl. | 7.1% | 0.0% |
| aggressive | 76.4% | -53,678 fl. | -27,073 fl. | -13,603 fl. | 27,112 fl. | 6.1% | 2.5% |
| bond_heavy | 11.1% | -2,883 fl. | 77,270 fl. | 98,673 fl. | 224,017 fl. | 60.4% | 28.1% |
| venture_heavy | 44.0% | -21,448 fl. | 2,480 fl. | 63,947 fl. | 208,620 fl. | 27.9% | 14.6% |

**Bankruptcies by period** (of 1,000 runs):

| Strategy | 1815-19 | 1820-24 | 1825-29 | 1830-39 | 1840-46 | 1847-50 |
| --- | --- | --- | --- | --- | --- | --- |
| idle | 0 | 0 | 0 | 0 | 0 | 0 |
| cautious | 0 | 1 | 30 | 45 | 20 | 27 |
| aggressive | 49 | 132 | 425 | 85 | 31 | 42 |
| bond_heavy | 4 | 8 | 41 | 33 | 9 | 16 |
| venture_heavy | 44 | 58 | 205 | 75 | 35 | 23 |

**Median net worth at year end** (runs still going that year):

| Strategy | 1815 | 1820 | 1825 | 1826 | 1830 | 1840 | 1850 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| idle | 50,000 | 48,610 | 48,214 | 48,111 | 47,826 | 47,200 | 46,705 |
| cautious | 44,766 | 23,932 | 18,966 | 19,891 | 22,061 | 25,427 | 22,189 |
| aggressive | 54,731 | 57,015 | 29,106 | 5,953 | 69,213 | 23,560 | 19,424 |
| bond_heavy | 54,028 | 77,014 | 80,660 | 81,420 | 92,764 | 111,019 | 93,314 |
| venture_heavy | 50,000 | 63,619 | 60,556 | 36,114 | 36,887 | 41,976 | 48,941 |

**Where the money goes**, mean per run over seeds 1 to 200, fl. (gains positive, losses negative):

| Strategy | Loan interest | Loan defaults | Bond coupons | State defaults | Venture payouts | Venture failures | Family | Reports | Events (cash) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| idle | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | -3,490 |
| cautious | 15,882 | -22,751 | 31,249 | -14,786 | 0 | 0 | -34,920 | -6,000 | 1,941 |
| aggressive | 37,175 | -57,101 | 62,539 | -89,218 | 24,354 | -7,693 | 0 | 0 | 1,274 |
| bond_heavy | 10,007 | -13,488 | 151,510 | -98,665 | 0 | 0 | 0 | 0 | 2,042 |
| venture_heavy | 0 | 0 | 0 | 0 | 991,874 | -303,287 | 0 | 0 | 1,678 |

(Venture payouts include the stake returned, so the venture gain is payouts less stakes, not payouts less failures.)

**Defaults and the market**, seeds 1 to 200:

| Strategy | Defaults from quality rolls | Defaults from events | Mean true quality lent to | Quarters calm / uneasy / panic | Final reputation (mean) |
| --- | --- | --- | --- | --- | --- |
| cautious | 923 (12,884 fl. a run) | 670 (9,867 fl. a run) | 0.76 | 60% / 31% / 9% | 32 |
| aggressive | 1,299 (43,063 fl.) | 442 (14,038 fl.) | 0.57 | 63% / 29% / 8% | 36 |
| bond_heavy | 558 (8,948 fl.) | 309 (4,540 fl.) | 0.70 | 60% / 32% / 9% | 29 |

## The spec's success tests

| Test | Status | Evidence |
| --- | --- | --- |
| At least two strategies can reach a strong 1850 finish | Passes, narrowly | bond_heavy 28.1%, venture_heavy 14.6%, aggressive 2.5% |
| No dominant strategy: cautious, aggressive and bond-heavy can all win | **Fails** | cautious never finishes strong and ends below its start in 93% of runs; aggressive goes bankrupt in 76% |
| The 1825 panic feels dangerous but survivable with good reserves | Passes | 1825-29 bankruptcies: cautious 3.0%, bond_heavy 4.1%, aggressive 42.5% |
| A full run takes about 60 to 90 minutes | Not measured | needs a human playtest (Week 7) |

## What the numbers show

1. **Careful lending loses money.** The cautious lender earns 15,882 fl. in interest and loses 22,751 fl. to defaults, though it lends to borrowers averaging 0.76 true quality. Two causes:
   - **Events:** 43% of its default losses come from events (mostly the warehouse fire, which defaults a random loan whatever its quality: 670 such defaults in 200 runs, about 3 a run, or one a decade).
   - **The market is calm only 60% of the time:** it's uneasy 31% and panicking 9%, so default risk is doubled or worse for 40% of the run. The highest rate a borrower pays (4% + 14% × (1 - market quality)) doesn't cover that.
2. **Bonds are the only steady earner.** Bond-heavy collects 151,510 fl. in coupons against 98,665 fl. in state defaults. It has the best median (77,270 fl.) and the most strong finishes (28.1%) with an 11.1% bankruptcy rate. Today it's the dominant sensible strategy.
3. **Ventures are a positive-value lottery.** The mean is 63,947 fl. but the median is 2,480 fl., with 44.0% bankrupt. Locked-up capital can't meet a run: 205 of its 440 bankruptcies come in 1825-29.
4. **Educating heirs doesn't pay.** Cautious spends 34,920 fl. a run on tutors, 70% of the starting net worth. Nothing in the numbers shows a return.
5. **Reputation drifts down for everyone.** The idle house ends at 25 on average from a start of 50. Random events lower it more than they raise it, and successions cost 3 or 10. Lower reputation means more withdrawals in uneasy and panic quarters, and Prussia's gate of 55 is almost never open.
6. **Doing nothing loses a little.** Idle loses 3,490 fl. a run to events. The clerk skimming 2% of cash hits a cash-rich house hardest.
7. **The aggressive house fails the way it should.** Its losses split between loan defaults (57,101 fl.) and Naples and French defaults (89,218 fl.), and most of its bankruptcies come in the 1825 crisis (425 of 764).

## Caveats

- These strategies are simple probes with fixed rules. A human, or a better script, could do better: for example, cautious educates every quarter and always lends at the borrower's highest rate.
- The harness measures one tuning set. Week 7 changes numbers and re-runs it.
- Figures from seeds 1 to 200 (cash flow, defaults, moods) are a sample. The main table uses all 1,000.

## Questions for Week 7

1. **Lending margin.** Should careful lending pay about as well as safe bonds? Levers: a wider rate spread, a lower `loans.p0`, fewer warehouse fires (weight 2 today), or fires that strike the riskiest borrower instead of a random one.
2. **Bond dominance.** Once lending pays, re-check that bonds aren't still strictly better (coupon 5%, Naples 6%; default chance `bonds.p0` 0.02 × risk × mood).
3. **Ventures.** Keep them as a high-variance gamble? The liquidity risk seems right. A way to sell a stake early at a discount (beyond forced sales) is a design question, not a number.
4. **Education.** Make it cheaper (1,500 fl. today), or make stats count for more (Acumen 5% per point, Connections 2 reputation points per point, Prudence 5% of the estimate width per point), so a trained heir pays for itself.
5. **Reputation drift.** Add a slow recovery (for example +1 a year without defaults or suspensions), or make the rumour event rarer or weaker.
6. **How turbulent should the market be?** 60% calm, 31% uneasy and 9% panic comes from the mood table plus events. Is that the intended feel?
7. **Strong finish.** Keep 150,000 fl. (three times the start) as the bar?
8. **Harness output.** Should the harness write per-category cash flows (a `flows.csv`) every run? This analysis needed them and used a one-off script.
