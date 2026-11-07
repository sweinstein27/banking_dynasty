# C1, Europe: decisions

Branch `claude/c1-europe-d4dd6d`. Plan approved by Scott on 2026-11-07, with the recommended answers to its four questions. Written in the style of docs/decisions.md; the integrator moves these there.

## Approved choices

- **Eight cities, each with its real currency:** Frankfurt (gulden, home), London (pound), Amsterdam (Dutch guilder), Hamburg (mark banco), Paris (franc), Berlin (thaler), Vienna (Convention gulden), Naples (ducat). Every city has a latitude and longitude, and courier roads link them, so the wave 3 map can draw them from `data/europe.json` and `state.europe`.
- **News stamped with a day of the quarter.** Each quarter every city writes a dispatch on a rolled day. It is known in Frankfurt at the next turn if that day plus `newsDelay` is within the 91-day quarter. Otherwise it arrives a quarter (or more) late.
  - What happens abroad takes effect at once.
  - The house's view of the city (mood, trouble, currency shock) and the Frankfurt quote change only when the dispatch arrives.
  - A bill or a branch can lose money on news the house has not yet heard.
- **Who can run a branch:** any living adult of the line (sons and daughters alike) who is not the head of house and runs no other branch.
- **Branch money comes home only when recalled** (or when the branch closes). Forced sales in a Frankfurt run do not touch it. That would need a change to `liquidity.ts`; it is left as a follow-up if playtests want it.

## How it works

- **`newsDelay(state, from, data)`** is in `src/sim/europe/world.ts`, re-exported from `src/sim/news.ts` and `src/sim/systems/europe.ts`. It returns days:
  - the shortest road by the ordinary post;
  - ×0.5 with a courier stable;
  - ×0.6 from a city with a branch;
  - less 10% per correspondent, at most 30%.
  - C4 (the telegraph) shortens news by wrapping this function; nothing in Europe needs to change for it.
- **Random numbers:** Europe rolls on its own stream (`state.europe.rng_state`).
  - The stream is seeded from the run RNG's state at the start, without drawing from it. Other systems' rolls are unchanged and no golden run moved.
  - The rolls are made in a fixed order each quarter:
    - one per currency;
    - four per foreign city (mood, trouble, panic shock size, dispatch day);
    - one per branch (forced closure);
    - one per bill due (the payer failing).
- **City moods** use their own transition table (`moods.transitions`). Chances of worsening are scaled by each city's volatility (Naples 1.5, Paris 1.2, Amsterdam and Hamburg 0.8).
  - Unrest breaks out at random with a small chance (0.2% to 1.2% a quarter).
  - Unrest and war last their quarters, then end with a roll.
  - Trouble keeps a city at least uneasy.
- **Currencies:** the rate is par × (1 + deviation) × shock.
  - The deviation reverts (0.6 of it stays each quarter), gets uniform noise (0.5% to 1.2%) and stays within the specie band (±2%; Vienna ±4%, Naples ±3%).
  - Shocks:
    - a panic takes 5 to 10% off;
    - unrest takes 3%;
    - war takes 8%;
    - Vienna's 1848 suspension takes 12%;
    - dated happenings can add more.
  - Shocks fade by half each quarter.
  - The thaler is fixed at 1.75 fl. from 1839 Q1 (Dresden Convention, ratified 7 Jan 1839), within ±0.2%. Shocks no longer move it.
- **Branch quarter,** in local currency:
  - Deposits move 25% a quarter toward capital × 0.8 × (0.5 + Connections/10) × reputation/50. In a panic, 20% run.
  - It lends 75% of capital plus deposits at the local rate plus 3%, and pays depositors the local rate less 1%.
  - Bill trading earns capital × 1.5% × (0.5 + Acumen/10).
  - Defaults take the lending × 0.3% / 0.8% / 3% (calm, uneasy, panic), doubled at war, × (1.5 − Prudence/10).
  - Upkeep is paid in gulden at the quote.
  - The head's traits scale these (see `branch.traits` in `data/europe.json`).
  - A branch with no head uses neutral stats, half the bill income and twice the defaults.
- **Forced closure:** the chance a quarter is war 15%, unrest 4%, panic 2%, × (1.4 − Prudence/10). It loses 30% of capital in a war and 15% otherwise. The rest comes home at the Frankfurt quote, and so does the head.
  - A branch whose capital is gone fails, and the house loses 5 reputation.
- **Bills:** 3-month bills are bought for gulden at the Frankfurt quote, discounted by the local rate/4 plus 0.5%.
  - They are paid at that quarter's End Turn, after news arrives, at the new quote.
  - The payer fails with a chance of 0.5% / 2% / 8% by the city's real mood. A failed bill recovers 40%.
  - A city takes at most 2,000 fl. of bills, plus the book value of the house's branch there.
- **Ledger:**
  - New accounts: `branches` (each branch's capital at the Frankfurt quote) and `bills` (at cost).
  - New categories: branch_opening, branch_capital, branch_profit, branch_loss, branch_closed, exchange (revaluation at the quote each quarter), bill_purchase, bill_paid, bill_default.
  - Both accounts are checked against their books in `save.ts`.
  - Net worth counts `europeBook` (branches plus bills).
- **Capacity:** every Europe decision uses the "deals" pool, which is the default in `capacity.ts`, left unchanged.

## Numbers and sources (uncertain unless marked)

- **Pars in gulden** are worked out from metal content (`docs/research/currencies.md`, plus a fact-check on 2026-11-07):

  | Currency | Par in gulden | How it was set | Status |
  |---|---|---|---|
  | Thaler | 1.75 | Dresden Convention | Confirmed |
  | Convention gulden | 1.2 | Half a Conventionsthaler of 2.4 gulden | Confirmed arithmetic |
  | Mark banco | 0.88 | About 8.45 g of silver against 9.545 g | Derived |
  | Ducat | 2.0 | About 4.25 francs | Derived |
  | Franc | 0.47 | 4.5 g of silver | Derived |
  | Pound | 11.9 | 7.32 g of gold × 15.5 / 9.545 | Derived; no quote found |
  | Dutch guilder | 1.0 | Metal content | Derived; no quote found |

  A possible primary source for real Frankfurt rates is Streng, *Berechnung verschiedener Geldsorten* (Frankfurt 1831); not consulted.
- **Courier days are design estimates.** No route-by-route post times were found. The only anchor is that the Rothschild news of Waterloo reached London in about 2 days from Belgium.
  - The road days are: Frankfurt to Paris 5, Amsterdam 4, Hamburg 5, Berlin 5, Vienna 8; Paris to London 3; Vienna to Naples 12.
  - That gives London 8 and Naples 20.
- **Branch economics, local rates (London and Amsterdam 4%, Hamburg 4.5%, Paris and Berlin 5%, Vienna 6%, Naples 7%), setup costs and upkeep** are design numbers. They were tuned so a 20,000 fl. branch opened in 1822 grows about 5.5 to 9% a year at the median over ten years (100 seeds, no player action). Amsterdam (36%) and Paris (14%) were the most often closed in that span. Earlier numbers gave 2 to 6% a year with 19% of branches closed, too weak to be worth a family member.

## Dated happenings (data/europe.json `history`)

Each happening fires at the End Turn before its quarter, like events. Checked on 2026-11-07 by a fact-check pass (sources in parentheses).

| Id | Date in game | Fact | Status |
|---|---|---|---|
| naples-revolution-1820 | 1820 Q3 | Nola mutiny 1 to 2 July 1820 | Confirmed (month; day differs between sources) |
| naples-austrians-1821 | 1821 Q1 | Rieti 7 Mar, Naples entered 23 Mar 1821 | Confirmed from snippets (onwar.com) |
| naples-restored-1821 | 1821 Q2 | Austrian occupation; Carl Rothschild opens a Naples house in 1821; branches may open from 1821 Q2 | Year confirmed (Wikipedia, Carl Mayer von Rothschild) |
| london-panic-1825 | 1825 Q4 | Pole, Thornton & Co. stop 12 Dec 1825, runs 11 to 18 Dec | Confirmed (NatWest heritage) |
| paris-july-1830 | 1830 Q3 | 26 to 29 July 1830 | Confirmed (Wikipedia) |
| brussels-revolt-1830 | 1830 Q3 | Brussels riot 25 Aug 1830 | Confirmed (Wikipedia) |
| ten-days-1831 | 1831 Q3 | Invasion 2 Aug 1831 | Confirmed (Wikipedia) |
| cholera-berlin-1831 | 1831 Q3 | Late Aug or Sept 1831 | **Uncertain** (sources differ; both in Q3) |
| cholera-vienna-1831 | 1831 Q3 | Aug 1831 (not Sept as first planned) | Corrected; day uncertain |
| cholera-hamburg-1831 | 1831 Q4 | "Autumn 1831" only | **Uncertain** (could be late Q3) |
| cholera-london-1832 | 1832 Q1 | First cases 11 to 12 Feb 1832 | Confirmed |
| cholera-paris-1832 | 1832 Q1 | First cases 26 Mar 1832 (first planned for Q2; moved) | Confirmed |
| london-uneasy-1836 | 1836 Q4 | Bank of England tightening in 1836 | **Uncertain**: no date found for the rate rise |
| london-panic-1837 | 1837 Q2 | Wilson, Wiggin and Wildes stop payment about 1 to 2 June 1837 | Confirmed (early June); day uncertain |
| hamburg-fire-1842 | 1842 Q2 | 5 to 8 May 1842 | Confirmed (Wikipedia) |
| london-crisis-1847 | 1847 Q4 | Bank Charter Act suspended by letter of 25 Oct 1847 | Confirmed (Wikipedia, Panic of 1847) |
| naples-1848 | 1848 Q1 | Palermo 12 Jan; constitution promised 29 Jan, sworn 10 Feb 1848 | Confirmed |
| paris-february-1848, paris-panic-1848 | 1848 Q1 | 22 to 24 Feb 1848 | Confirmed |
| vienna-march-1848 | 1848 Q1 | 13 Mar 1848 | Confirmed |
| berlin-march-1848 | 1848 Q1 | 18 to 19 Mar 1848 | Confirmed |
| vienna-suspension-1848 | 1848 Q2 | Notes made legal tender 22 May 1848; the exact suspension date of silver payment was not found | **Uncertain** ("spring 1848") |
| paris-june-1848 | 1848 Q2 | June Days, 22 to 26 June 1848 | Confirmed |
| vienna-october-1848 | 1848 Q4 | Rising 6 Oct, stormed 31 Oct 1848 | Confirmed |

## Harness

- Aggressive opens up to three branches under the ablest free family member:
  - London, Paris, Vienna, Hamburg or Berlin, the first its reputation opens and it believes calm;
  - 15% of free cash each, 5,000 to 40,000 fl., before its other wants, once free cash is at least 20,000 fl.;
  - it closes a branch on news of war or unrest there.
- Investor buys up to 2,000 fl. of bills a quarter on each of London, Amsterdam, Hamburg and Paris when it believes them calm.
### 1,000-seed run (2026-11-07), seeds 1 to 1000, against `main` at fe0ca2b

| Strategy | main: bankrupt / median / p90 / strong | C1: bankrupt / median / p90 / strong |
|---|---|---|
| aggressive | 31.4% / 169,504 / 735,944 / 51.8% | 33.7% / 168,997 / 753,855 / 52.6% |
| investor | 3.6% / 65,670 / 174,387 / 14.6% | 2.6% / 78,512 / 183,462 / 17.7% |
| idle, cautious, bond_heavy, venture_heavy, cautious_no_family | unchanged | identical to main, figure for figure |

- All seven targets (T1 to T7) still pass. T5 aggressive 1825-29 bankruptcy went from 13.9% to 15.0%, and T6 from 31.4% to 33.7%.
- Strategies that leave Europe alone give identical results. This shows Europe's own random stream moves no one else's rolls.
- **Aggressive** opened branches in 72% of runs: about 15,000 fl. of capital and 4,600 fl. of setup per run.
  - Branches earned about 22,000 fl. of profit per run, against 2,200 of losses (fires, cholera) and 700 of exchange losses.
  - 55% of runs closed a branch, either forced or on news of unrest.
  - The median barely moves and bankruptcy rises 2.3 points: branches tie up cash an aggressive house later misses in a panic. That is the intended trade-off.
- **Investor** bought about 567,000 fl. of bills over a run (2,000 fl. a city a quarter). It netted about 7,000 fl. after failed payers, which cost 2,200 fl. net in 79% of runs. Bills plus the cash they keep liquid raise its median by 12,800 fl. and cut its bankruptcy rate by a point.
- No golden run changed (`npm test` passes with no new skips). The panic seed and targets are untouched.

## Files touched outside C1's ownership

- `src/sim/news.ts`: one re-export of `newsDelay` (allowed).
- `src/sim/types.ts`: `"europe"` added to `NewsKind`.
- `src/sim/save.ts`: the `branches` and `bills` accounts added to the books check (the typecheck requires every account).
- `scripts/play.ts`: an [e] Europe menu, a Europe figure in the status line, Europe holdings.
- `tests/news.test.ts`: one test filters out Europe news, as it already filtered markets news.
- Not touched: `data/states.json`, `src/sim/systems/counting.ts`, `capacity.ts`, `liquidity.ts`.
