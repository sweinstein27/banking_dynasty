# A1, credit: decisions

In the style of docs/decisions.md. The integrator moves these rows there after merging.


## Harness, 1,000 seeds

Before A1 (main at 450eda8) and after (this branch), seeds 1 to 1000. Net worth in 1850; a strong finish is 150,000 fl. or more.

| Strategy | Bankrupt before | Bankrupt after | Median before | Median after | p90 before | p90 after | Strong before | Strong after |
| idle | 0.0% | 0.0% | 35,402 | 35,574 | 41,195 | 41,265 | 0.0% | 0.0% |
| cautious | 0.7% | 3.0% | 79,495 | 44,304 | 225,554 | 169,314 | 29.7% | 16.1% |
| aggressive | 33.0% | 20.3% | 56,932 | 275,962 | 353,295 | 699,859 | 28.9% | 68.4% |
| bond_heavy | 27.8% | 28.4% | 43,692 | 54,458 | 334,200 | 426,025 | 26.0% | 28.2% |
| venture_heavy | 44.1% | 41.1% | 6,691 | 13,569 | 454,226 | 465,952 | 24.9% | 28.3% |
| cautious_no_family | 0.8% | 3.6% | 88,120 | 52,390 | 250,247 | 190,718 | 34.5% | 20.0% |

Targets after: T1 pass, T2 **fail** (aggressive dominates bond_heavy and venture_heavy), T3 pass, T4 pass (3.0%), T5 **fail** (aggressive 9.5% bankrupt in 1825 to 1829, needs 12%), T6 **fail** (aggressive 20.3% bankrupt, needs 30 to 60%), T7 **fail** (cautious 44,304 against 52,390 without family, needs 90%). Before A1 all seven passed.

Why: the failures all come from aggressive lending getting much stronger. Over 40 seeds it now earns about 406,000 fl. of loan interest a run against 141,000 fl. of defaults (28,000 recovered). Four requests a quarter, terms up to ten years and amounts up to 60,000 fl. let it keep most of its capital lent at the highest rates, and the rate rule (`base + spread x (1 - market_quality)`, up to about 20%) pays far more than the default chance costs (about 3% a year for a weak borrower in calm, and less for mortgages, which also recover 60%). Fewer forced sales mean fewer bankruptcies. Cautious pays about 53,000 fl. a run for files and lends less, so its median falls. T7 fails because cautious with family spends more on files than before. Per docs/parallel.md, balance is measured after merging (and A2's capacity changes every strategy), so I have not retuned. The levers are all in credit's data: the rate spread or kind premiums, mortgage default_factor and recovery, requests_per_quarter, and info costs.

The decisions table from this file was moved into docs/decisions.md when the branch was merged (2026-11-07). What is left here is the supporting detail.
