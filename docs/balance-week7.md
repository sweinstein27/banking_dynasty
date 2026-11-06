# Balance after tuning, Week 7

Measured on 2026-11-06 with the tuned data (commit 993327d), seeds 1 to 1,000, by `npm run harness -- --runs 1000`. The baseline is [balance-week6.md](balance-week6.md). Every round is logged with its sweeps in `docs/decisions.md`; the sweep grids and candidate override files are in `tuning/`.

## Result: all six targets pass

| Target | Week 6 baseline | After tuning |
| --- | --- | --- |
| T1 Each contender finishes strong in at least 10% of runs | Fail: cautious 0%, aggressive 2.5% | **Pass**: cautious 18.1%, aggressive 18.8%, bond-heavy 16.8%, venture-heavy 17.2% |
| T2 No contender dominates another (median, p90, bankruptcy) | Fail: bond-heavy dominated three | **Pass**: none dominates |
| T3 Cautious median above idle | Fail: 16,915 against 46,696 fl. | **Pass**: 74,350 against 46,510 fl. |
| T4 Cautious bankruptcy at most 5% | Fail: 12.3% | **Pass**: 1.2% |
| T5 1825-29: cautious at most 5% bankrupt, aggressive at least 15% (was 25%) | Pass: 3.0% and 42.5% | **Pass**: 0.0% and 18.2% |
| T6 Aggressive bankruptcy 30% to 60% | Fail: 76.4% | **Pass**: 35.1% |

T5's aggressive floor was lowered from 25% to 15% by Scott's decision in round 3; see "What it cost" below.

## The spec's success tests

| Test | Week 6 | Now |
| --- | --- | --- |
| At least two strategies can reach a strong 1850 finish | Passed narrowly (bond-heavy, venture-heavy) | Passes: all four contenders finish strong 17% to 19% of the time |
| No dominant strategy: cautious, aggressive and bond-heavy can all win | Failed | Passes (T1 and T2) |
| The 1825 panic feels dangerous but survivable with good reserves | Passed | Passes by the numbers: no cautious house fails in 1825-29, about 1 aggressive house in 5 does. Whether it *feels* dangerous needs the playtest |
| A full run takes about 60 to 90 minutes | Not measured | Not measured: needs the playtest (docs/playtest.md) |

## Final numbers

| Strategy | Bankrupt | p10 | Median | Mean | p90 | Above start | Strong | Final reputation (median) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| idle | 0.0% | 41,979 fl. | 46,510 fl. | 46,508 fl. | 50,970 fl. | 16.9% | 0.0% | 39 |
| cautious | 1.2% | 16,117 fl. | 74,350 fl. | 86,402 fl. | 178,592 fl. | 63.3% | 18.1% | 48 |
| aggressive | 35.1% | -33,319 fl. | 36,989 fl. | 135,480 fl. | 220,549 fl. | 45.5% | 18.8% | 42 |
| bond_heavy | 18.2% | -13,660 fl. | 41,050 fl. | 92,042 fl. | 199,428 fl. | 45.6% | 16.8% | 41 |
| venture_heavy | 40.8% | -19,779 fl. | 3,661 fl. | 75,355 fl. | 261,026 fl. | 31.7% | 17.2% | 43 |

Each strategy now has its own shape. Cautious is the safe, steady house; aggressive and venture-heavy are high-variance; bond-heavy sits between.

## Round by round

Strong finishes and bankruptcy for cautious / aggressive / bond-heavy / venture-heavy, all on 1,000 seeds.

| Step | Strong finish | Bankrupt | Targets passed |
| --- | --- | --- | --- |
| Week 6 baseline | 0 / 2.5 / 28.1 / 14.6% | 12.3 / 76.4 / 11.1 / 44.0% | 1 of 6 |
| Cautious strategy fixes (no tuning) | 1.1 / 2.5 / 28.1 / 14.6% | 3.9 / 76.4 / 11.1 / 44.0% | 2 |
| Round 1: lending margin | 9.4 / 7.6 / 32.8 / 14.6% | 1.2 / 51.6 / 11.1 / 44.0% | 4 |
| Round 2: reputation drift | 13.6 / 6.1 / 32.3 / 15.5% | 1.5 / 52.1 / 10.8 / 45.5% | 4 |
| Round 3: bonds and ventures (T5 floor to 15%) | 13.3 / 18.8 / 16.8 / 17.2% | 1.5 / 35.1 / 18.2 / 40.8% | 6 |
| Round 4: education | 18.1 / 18.8 / 16.8 / 17.2% | 1.2 / 35.1 / 18.2 / 40.8% | 6 |

## What changed

| Number | Before | After | Why |
| --- | --- | --- | --- |
| `loans.p0` (base default chance) | 0.04 | 0.015 | Careful lending lost money: defaults outran interest |
| `loans.rate.base` | 4% | 5% | Same |
| `loans.rate.spread` | 14% | 22% | Same; the wide spread is what lets lending to risky borrowers pay |
| Rival rumours event weight | 2 | 1 | Reputation drifted down about 0.8 a year whatever the player did |
| "A good name" event weight | 2 | 3 | Same |
| Naples coupon (states.json) | 6% | 10% | Risky bonds lost money on average; aggressive play had no upside |
| `forced_sale.venture_discount` | 50% | 30% | Venture houses were ruined by runs they could not meet |
| `bonds.price_sensitivity` | 0.1 | 0.2 | Bond-heavy was too safe; bond prices now fall further in bad markets |
| `family.invest.educate.cost` | 1,500 fl. | 1,000 fl. | Education was a pure loss (see open question 2) |

The cautious harness strategy also changed before tuning: it educates only the heir who will take over, until trained, and buys only safe bonds. The golden runs were re-recorded after each change; the panic seed is now 2894.

## What it cost, and what is still open

1. **1825 is less deadly for aggressive play.** Risky bonds now pay, so the aggressive house is better cushioned: 18.2% go bankrupt in 1825-29, down from 42.5%. Harsher panic withdrawals didn't restore 25% without breaking T2. Hence the lowered floor. The playtest should say whether 1825 still feels dangerous.
2. **Educating heirs still doesn't pay for itself.** Cautious play with no education has a median of 91k against 74k with it. Doubling the untrained-heir penalties changed nothing, because reputation and the head's stats barely affect income. The likely fix is a rule, not a number: **reputation-driven deposit inflows** (deferred since Week 2), so a good name brings in money and a trained, respected heir is worth paying for. This is a question for you, possibly for the Week 8 buffer.
3. **Rates and coupons are above history.** A poor borrower now pays up to about 20% a year, and Naples bonds 10%. Both are game numbers well above the period (interest caps of about 5 to 6% were common in the German states; Neapolitan loans carried lower nominal coupons). Logged under "To verify" in decisions.md for historical calibration after the prototype.
4. **Venture-heavy is a lottery.** Its median is 3,661 fl. with 40.8% bankrupt, but it has the highest p90 (261,026 fl.). That meets the targets and may be the right feel for railway mania. The playtest will tell.
5. **These are scripted probes.** A thoughtful player will do better than any of them. The targets show the numbers no longer punish whole styles of play, not that the game is fun.

## Next

- **Your playtest:** one full run with [docs/playtest.md](playtest.md). Time, feel, and whether 1825 and the family matter.
- **A decision** on reputation-driven deposit inflows (open question 2).

## Deposits round (2026-11-06)

Reputation now draws deposits in calm quarters (1,000 fl. per point, 10% of the gap a quarter), and depositors earn interest. The cautious_no_family strategy and target T7 measure whether educating heirs pays. Seeds 1 to 1,000; strong finish / bankrupt / median.

| Strategy | Before deposits (Week 7 final) | Deposits rule, untuned (2% interest) | After tuning |
| --- | --- | --- | --- |
| idle | 0% / 0% / 46,510 fl. | 0% / 0% / 19,269 fl. | 0% / 0% / 32,557 fl. |
| cautious | 18.1% / 1.2% / 74,350 fl. | 8.3% / 6.5% / 43,991 fl. | 23.1% / 3.1% / 71,279 fl. |
| aggressive | 18.8% / 35.1% / 36,989 fl. | 14.4% / 50.7% / -10,284 fl. | 26.0% / 38.0% / 42,231 fl. |
| bond_heavy | 16.8% / 18.2% / 41,050 fl. | 11.6% / 35.0% / 12,160 fl. | 23.3% / 23.7% / 44,612 fl. |
| venture_heavy | 17.2% / 40.8% / 3,661 fl. | 15.2% / 55.2% / -10,325 fl. | 27.7% / 38.3% / 23,866 fl. |
| cautious_no_family | not measured | 15.3% / 4.3% / 65,350 fl. | 23.2% / 2.4% / 78,132 fl. |
| Targets passed | 6 of 6 | 4 of 7 | **7 of 7** |

Changed: deposit interest 2% to 1%, tutor price 1,000 to 500 fl., the shipping line's failure risk 20% to 15%, Naples coupon 10% to 12%.

What it shows:

1. **Strong finishes are more common and more even** (23% to 28% for every contender, from 17% to 19%). Reputation now feeds deposits, which feed lending.
2. **Educating still doesn't pay outright.** It costs about 9% of the median: 71,279 fl. with education against 78,132 without. No numbers fixed this, because tutoring is paid when heirs are children and loses decades of compounding. T7 was softened to "within 10%", by Scott's decision. What education buys is safety: untrained successions fall from about 1 a run to about 0.2, and reputation ends higher (median 48 against 41).
3. **Doing nothing now costs more:** depositors' interest runs whether or not the money is put to work (idle median 32,557 fl.).
4. **The 1825 floor is tight:** 15.8% of aggressive houses fail in 1825-29, just above T5's 15%.
