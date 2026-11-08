# B1: rivals that act

Decisions from milestone B1, in the style of docs/decisions.md, newest first. For the integrator to move into docs/decisions.md.

| Date | Question | Decision |
| --- | --- | --- |
| 2026-11-08 | B1: How hard do rumour plots bite? | Through deposits, not the name: 3% of deposits leave (never more than the cash in the till) and reputation falls 1 point. The player's reputation never drifts back, so a larger hit (first tried 3 to 6, then 2 to 4) piled up over a run and shut bond-heavy out of the bond gates. |
| 2026-11-08 | B1: How often do houses plot? | Only houses below opinion -20, and never one whose paper the player holds or one short-handed. Chance a quarter is 1.5% (cautious) or 3% (bold) times dislike / 50, at most twice that; one plot a quarter in all. Kessler at its usual -30 plots about twice a run. Houses split off by B2 feuds (opinion about -34) plot too: on seed 3, bond-heavy suffered 8 plots from two split houses. |
| 2026-11-08 | B1: Hearing of a plot. | The chance is 30% + 10% per working correspondent + 3% per point of the head's Connections above 5, at most 90%, rolled when the plot is laid. A plot heard of strikes next quarter unless countered: 500 fl. for rumours, 1,000 fl. for a debt purchase, plus the head's time. |
| 2026-11-08 | B1: Buying the player's debts. | A plotting house buys the player's largest debt to another house, becomes its lender, and calls it: it falls due at the next End Turn (`crisis.ts` repays it then, or forces sales). Without such a debt the plot is rumours. |
| 2026-11-08 | B1: How do poaching offers work? | At End Turn, each house of 100,000 fl. or more that is not short-handed rolls 0.5% (cautious) or 1% (bold), doubled at opinion -20 or below; one offer a quarter in all. The offer is 30 to 60% above the **role's** wage, for the most skilled member (skill 5 or more next quarter, never the partner) paid less than that. It stands for one quarter. `match_wage` (free, no capacity) sets `Staff.raise` so the member stays; otherwise they leave at End Turn. Offers were first set against the member's current wage: matching then compounded (seed 1 paid 52,000 to 68,000 fl. in wages against 7,250 without rivals). |
| 2026-11-08 | B1: Rivals for large loans. | A request of 20,000 fl. or more shows the best rival rate, worked out from the state with no roll: the borrower's highest rate less 0.5% (cautious) or 1% (bold), and 0.5% more from a house at opinion -40 or below, never under 3%. A house competes with wealth of 10 times the amount and not short-handed. At End Turn, a loan made this quarter above that rate is taken with chance 30% + 20% per 1% above, at most 80%: the borrower repays the principal (interest for the quarter is already paid). Built as a refinance inside `resolveRivals`, so A1's lend code is untouched. `rivalLoanWords` gives the odds in words for the Desk. |
| 2026-11-08 | B1: Who buys a sold loan? | Every house trading with wealth of 5 times the principal bids A1's market price, adjusted by 2% of the principal per 100 points of opinion. The best price wins (ties to the richer house); its wealth gains the discount and its opinion rises 1. When no Frankfurt house can buy, "a house in Amsterdam" pays the market price, so a sale is never refused for want of a buyer (and test data with no houses still sells). `salePrice` returns the winning bid, so offers and sales agree. |
| 2026-11-08 | B1: Rival bids for state loans. | A5 keeps its rolls (bid chance and commission), so the finance stream is unchanged. B1 then drops a short-handed house's bid, and lets a house at opinion -40 or below undercut the player's bid by one 0.25% step (floor 0.25%) on an even roll from the rivals stream, when the player bid and the house would otherwise ask more. |
| 2026-11-08 | B1: The player's schemes. | `scheme` (the head's time; one per house a quarter), paid when queued, settled at End Turn with one roll for success and one for discovery. Rumours: 800 fl., 60% + 3% per Connections point above 5 - 0.5% per point of the house's reputation above 50 (10 to 90%); the house loses 8 reputation and 2% of its wealth. Lure a clerk: 600 fl., 50% + 3% per Connections point; a clerk of skill 5 to 7 joins from next quarter (needs a free desk, checked when queued and again at End Turn) and the house is short-handed for 4 quarters (no bids, no rival loans, no poaching, no plots). Found out (30% - 2% per Connections point, 5 to 60%): rumours cost the player 4 reputation, the target 30 opinion and every other house 5; luring costs the target 20 opinion. |
| 2026-11-08 | B1: Buying a house's paper. | `buy_paper` (deals): face in steps of 1,000 fl., at least 5,000 fl., up to 5% of the house's wealth held at once, at 3% below par. It pays 5% a year from the quarter after it was bought and is repaid at par after 4 quarters. Booked at cost in the new ledger account `rival_paper`, counted in net worth by `rivalsBook`. While the player holds it, the house does not plot. `present_paper` (deals) is paid at par at once, drains the house by 20% of the face and costs 5 opinion; in a panic, a house left below 40% of its starting wealth fails at that End Turn (`failHouse`, now exported). A failed house's paper recovers 30% (20% in a panic), as A5's loans to houses do. |
| 2026-11-08 | B1: Random stream. | Rivals keeps its own stream (`state.rivals.rng_state`), seeded from the run's RNG without drawing, as finance does. The spite roll on contracts uses it too, so A5's rolls are unchanged. |

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

All seven targets pass both before and after.

| Strategy | Bankrupt | Median | p90 | Strong |
| --- | --- | --- | --- | --- |
| idle | 0.0% to 0.0% | 32,851 to 33,080 | 38,667 to 39,250 | 0% to 0% |
| cautious | 3.3% to 3.3% | 64,276 to 50,055 | 216,079 to 177,921 | 25.3% to 18.0% |
| aggressive | 31.7% to 41.0% | 232,812 to 160,183 | 1,145,917 to 882,152 | 59.7% to 51.3% |
| bond_heavy | 20.3% to 18.3% | 81,125 to 70,053 | 269,957 to 282,215 | 31.0% to 29.0% |
| venture_heavy | 7.3% to 11.0% | 95,450 to 93,213 | 240,119 to 246,283 | 27.3% to 29.3% |
| investor | 4.0% to 5.0% | 72,954 to 71,810 | 212,980 to 204,176 | 20.7% to 19.3% |
| cautious_no_family | 5.7% to 6.0% | 53,565 to 46,304 | 173,228 to 174,150 | 16.7% to 14.3% |

Rivals make the game harder for everyone but idle. The biggest moves:

- **Cautious** loses about a fifth of its median. It pays to counter plots and to match wages, and its head's time goes on counters.
- **Aggressive** goes bust more often (31.7% to 41.0%), within T6's 30 to 60%. Likely cause, not yet isolated: its yearly rumours against the most hostile house are found out about 3 times in 10, costing 4 reputation and 5 opinion with every other house, which can leave no house willing to lend in a panic (lending needs opinion -20 or better). Its large loans at the borrower's top rate are also the ones rivals take.
- **Venture-heavy** busts rise from 7.3% to 11.0%; it never counters plots, so rumour withdrawals land in panics.

Balance is the integrator's after merging; the levers are all in data/rivals.json.
