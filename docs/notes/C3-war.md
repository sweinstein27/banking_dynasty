# C3, war and revolution: decisions

Branch `claude/w3-war-b53301`. Plan approved by Scott on 2026-11-08 with the recommended answers to its four questions. Written in the style of docs/decisions.md; the integrator moves these there.

## Approved choices

- **Historical campaigns only, no random wars.** Start dates and phase lengths are fixed so history holds. What is rolled is how each fighting quarter's news reads for each state at war (its fortunes), which moves its risk and the chance its war loans are repaid. Random unrest abroad (C1's rolls, scaled by pressure) carries the uncertainty.
- **Forced sales sell war loans** at the loan discount, after high finance and before merchant loans (`raiseFromWar`, one line in `liquidity.ts`). Without it a house could go bankrupt while still holding war loans.
- **Hooks for the integrator, not wired:** `warContractFactor(state, stateId, data)` (finance announces loans 3x as often from a state mobilizing, 2x fighting, 1.5x settling) and `warBondDiscount(state, stateId, data)` (a share off its bond price, 3% / 6% / 2%, even in a calm market). Both default to no change at peace. `bonds.ts` and finance are not C3's files.
- **The Central Power's fleet advance** stays, labelled as an invention (see below).

## How it works

- **Seam:** `src/sim/systems/war.ts`; the pieces in `src/sim/war/` (`types.ts`, `campaigns.ts`, `loans.ts`); data in `data/war.json`; state in `state.war`.
- **Random numbers:** war has its own stream (`state.war.rng_state`), seeded from the run RNG's state without drawing from it. Rolls each End Turn, in order:
  - one per war loan that falls due;
  - one per state at war in each fighting campaign (its fortune);
  - one per city (pressure), in `data/europe.json` order;
  - one for Frankfurt (random unrest).
- **End Turn step** (`resolveWar`, just before Europe's): war loans pay interest and those due are repaid or fail; campaigns move to their stage for next quarter (news, price shocks, fortunes); pressure is rolled; Frankfurt's quarter; then risk and trade are brought to what the war wants.
- **Campaigns** (`data/war.json` `campaigns`): dated timeline entries put a campaign in `mobilizing`, `fighting`, `settling` or (with `peace`) over. By phase each one adds risk to its states, multiplies trade risk, and may shock prices once as a phase begins (through markets' exported `applyShock`).
  - Fortunes: each fighting quarter, a state's news is bad with chance 0.4 (a step up) or good (a step down), within ±3 steps. Each step is ±0.02 risk while the campaign lasts, and each bad step raises its war loans' default chance by half.
  - Theatre cities go to war through C1's own `history` (with news delay). C3 added the Danish blockade of Hamburg (1848 Q2 to Q3, 1849 Q2) and its ends. Naples 1821, Belgium 1831 and Vienna 1848 were already there.
- **Taking effects back:** the war never writes `risk_shift` or `trade_risk` outright. It keeps what it has applied (`state.war.applied`) and moves both only by the difference from what it wants now, so events' own shifts are untouched and peace returns everything the war added. A campaign may leave a `residual` (none do yet: the existing events already leave France and the 1848 states their lasting risk).
- **War loans** (`subscribe_war_loan {offer, amount}`, deals pool):
  - Open while their campaign is in one of the offer's phases and the borrower has not defaulted. The house lends at par, at least 1,000 fl., up to the offer's `max` (counting earlier loans on it).
  - The gate is the state's bond gate (less the head's Connections); the Central Power has its own (35).
  - Interest each End Turn; repaid at the End Turn of the term's last quarter, or fails on one roll (`default_chance × (1 + 0.5 × bad fortune steps)`), recovering `recovery`.
  - A borrower that defaults on its bonds loses the house its war loans at once, with nothing recovered.
  - Loans that pay to put down a rising (`repression`: Naples 1821, Spain 1823, Austria 1848-49, Baden 1849) cost 1 to 3 reputation on the first loan to that offer.
  - Ledger: account `war_loans` (checked in `save.ts`), categories `war_loan`, `war_interest`, `war_repaid`, `war_default`, and `forced_sale`. Net worth counts `warBook`.
- **Unrest pressure** (`state.war.pressure`, 0 to 100 per city, Frankfurt included):
  - Closes 35% of the gap each quarter to a dated curve (25 in 1815, 45 in the hungry year 1817, 55 in 1830, 25 by 1836, 60 in 1847, 80 in 1848, 35 in 1850), scaled per city (Paris and Naples 1.2, London 0.7, Amsterdam and Hamburg 0.8, Frankfurt 0.9), plus 30 points per 100% that grain stands above its base price, plus 10 in a panic, plus noise of ±4. A city in unrest or at war lets out 15 a quarter.
  - Effects: C1's random unrest chance × (1 + pressure/50), by a one-line hook in `europe/world.ts`; up to +0.05 risk on the city's state at pressure 100; news as it rises through 50 and 75.
- **Frankfurt** (`data/war.json` `home`): C1 never rolls the home city, so war sets its status (seen at once, no delay). Unrest multiplies trade risk by 1.03 and war by 1.1. Above pressure 60, a quarter of random unrest has a chance of up to 8% at 100.
  - The September 1848 rising also sends a letter (`war-september-1848` in `data/events.json`): hire guards (400 fl.), give the Senate 1,500 fl. for the troops (+3 reputation), or bar the doors (the default: a 30% chance of losing 2% of cash).
- **Harness:** aggressive lends 10% of free cash to the open war loan of the lowest-risk borrower whose gate it meets; bond_heavy lends 8%, only to states of risk 0.25 or less and never to repression loans. Both lend first in the quarter, before their other deals use the clerks' time. The rest never lend.

## Touched outside C3's files (all small)

- `src/sim/europe/world.ts`: `unrest_chance × unrestFactor(state, city.id, data)` (allowed: city status).
- `data/europe.json` `history`: four Hamburg entries (allowed: extend).
- `data/events.json`: `war-september-1848` (allowed: `war-` ids).
- `src/sim/save.ts`: `war_loans: warLoansBook(state)` in the ledger check (needed for the new account).
- `src/sim/liquidity.ts`: `raiseFromWar` after `raiseFromFinance` (approved).
- `tests/helpers.ts`: `quiet.war` (no campaigns, no Frankfurt troubles, pressure that moves nothing).
- `tests/strategies.test.ts`: the letter-style test lists the new letter's responses.
- `tests/golden.test.ts`: the full economy and panic goldens are skipped, naming C3 (the Hundred Days runs from turn 1).

## For the integrator

- Wire `warContractFactor` into `announceContracts` (`chance × warContractFactor(state, issuer.id, data)`) and `warBondDiscount` into `bondPrice`/`markBonds` if wanted; they change balance, so measure after.
- `warPhaseOf(state, data, stateId)` and `openOffers(state, data)` are exported for screens (the map can show states at war; the desk can list war loans).
- News uses the existing kind `"europe"`; `types.ts` is unchanged.

## History: sources and uncertain points

Checked against `docs/research/politics-and-war.md` and, for the rest, Wikipedia (EN and DE), the Bundesarchiv and marxists.org on 2026-11-08.

| Item | Date used | Status |
| --- | --- | --- |
| Napoleon lands from Elba | 1 Mar 1815 | Confirmed |
| Allies enter Paris; Second Treaty of Paris | 7 Jul 1815; 20 Nov 1815 | Confirmed |
| Bavaria in the 1815 campaign | Wrede's corps on the upper Rhine | Confirmed (little fighting) |
| Troppau; Laibach; Rieti; Austrians in Naples | Oct to Dec 1820; Jan to May 1821; 7 Mar 1821; 24 Mar 1821 | Confirmed (24 Mar, not 23) |
| France into Spain; Trocadero; Cadiz gives up the king | 7 Apr 1823; 31 Aug 1823; 23 Sep 1823 | Confirmed (one source gives 6 Apr) |
| French war credit of 100 million francs | early 1823 | **Uncertain:** only a passing mention (Gaceta de Madrid, 17 Mar 1823); vote date not found |
| Russia declares war on the Sultan; Adrianople | 26 Apr 1828 (O.S.), 8 May (N.S.); 14 Sep 1829 | Confirmed |
| Polish rising; Warsaw falls | 29 Nov 1830; 7 to 8 Sep 1831 | Confirmed |
| Prussian army of observation, 1830-31 | 1830-31 | Confirmed |
| French loan of 120 million francs | 1831 | Confirmed |
| Austrian loans or mobilization in 1830-31 | none used | **Uncertain:** not found, so Austria is left out of the 1830 war scare |
| London Convention; Thiers falls; federal fortresses decided | 15 Jul 1840; 29 Oct 1840; 26 Mar 1841 | Confirmed |
| Bavarian war loan in 1840 | 1840 Q3 | **Invented:** a plausible offer; no source |
| Schleswig rising; Elbe blockade; war resumes; truce; Peace of Berlin | 24 Mar 1848; from 10 May 1848; 3 Apr 1849; 10 Jul 1849; 2 Jul 1850 | Confirmed |
| Prussian voluntary loan, 15 million thaler | 1848 | Confirmed |
| Sardinia declares war; Jelacic crosses the Drava; Russians in Hungary; Vilagos | 23 Mar 1848; 11 Sep 1848; Jun 1849; 13 Aug 1849 | Confirmed |
| Austrian war loans in 1848-49 | 1848 Q2 to 1849 Q3 | **Uncertain:** an 1849 lottery loan and heavy paper money are mentioned, but no good source on terms |
| Rastatt mutiny; Grand Duke flees; Waghaeusel; Rastatt surrenders | 9 May 1849; 13 to 14 May; 21 to 22 Jun; 23 Jul 1849 | Confirmed |
| Prussian loan for the Baden campaign | 1849 Q2 | **Invented:** a plausible offer; no source |
| Hesse: troops enter; Prussia mobilizes; Bronnzell; Olmuetz | 1 Nov; 5 Nov; 8 Nov; 29 Nov 1850 | Confirmed (research had marked it uncertain) |
| Fleet vote; the Central Power ends; the fleet is sold | 14 Jun 1848, 6 million thaler; 20 Dec 1849; 1852-53 | Confirmed |
| The Central Power asks houses for an advance | 1848 Q2 to 1849 Q3 | **Invented**, built on the fleet vote and the states' slow payments; risky by design (45% default) |
| Hep-Hep riots in Frankfurt | 8 to 12 Aug 1819 | Confirmed |
| Wachensturm; 2,500 federal troops after | 3 Apr 1833 | Confirmed |
| Flag over the Diet's palace; Paulskirche opens; September rising; parliament leaves | 9 Mar 1848; 18 May 1848; 18 Sep 1848; 30 or 31 May 1849 | Confirmed (end date differs by source) |
| The pressure curve | 1815 to 1850 | **Design:** shaped to the hunger years (1816-17), 1830 and 1847-48, not measured |

Dropped: the allied entry into Paris as a war in C1's history for 1815 Q3. Paris saw only skirmishes at its gates (Issy, 3 July), and the entry leaked into other systems' quiet tests.

## Harness results (1,000 seeds, 2026-11-08)

Main at 642c6bb (the wave 3 foundation) against this branch at c048139.

**Targets:** all seven pass on this branch. On main, T2 fails (investor dominates cautious); with C3 no strategy dominates another.

| Target | Main | C3 |
| --- | --- | --- |
| T1 strong finish (cautious, aggressive, bond_heavy, venture_heavy, investor) | 24.1, 56.9, 30.4, 32.3, 24.5% | 19.6, 52.5, 27.8, 31.3, 26.3% |
| T2 no contender dominates | FAIL (investor over cautious) | PASS |
| T3 cautious median above idle | 60,339 vs 33,009 | 52,522 vs 32,828 |
| T4 cautious bankrupt at most 5% | 3.7% | 3.1% |
| T5 1825-29: cautious at most 5%, aggressive at least 12% | 0.6%, 14.7% | 0.3%, 16.1% |
| T6 aggressive bankrupt 30 to 60% | 33.0% | 34.1% |
| T7 cautious at least 90% of cautious_no_family | 60,339 vs 57,504 | 52,522 vs 47,142 |

**By strategy** (bankruptcy share of all runs; windows by the year the run ended):

| Strategy | Median main | Median C3 | Bankrupt main | Bankrupt C3 | 1825-29 main | 1825-29 C3 | 1848-50 main | 1848-50 C3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| aggressive | 217,148 | 172,020 | 33.0% | 34.1% | 14.7% | 16.1% | 0.9% | 1.2% |
| bond_heavy | 72,499 | 65,050 | 21.2% | 21.6% | 5.4% | 6.0% | 3.8% | 3.8% |
| cautious | 60,339 | 52,522 | 3.7% | 3.1% | 0.6% | 0.3% | 0.9% | 0.2% |
| cautious_no_family | 57,504 | 47,142 | 5.2% | 4.1% | 0.6% | 0.3% | 1.7% | 1.4% |
| investor | 85,099 | 87,746 | 3.7% | 4.1% | 0.1% | 0.1% | 2.1% | 1.9% |
| venture_heavy | 101,242 | 99,006 | 6.6% | 6.6% | 2.1% | 2.1% | 0.9% | 0.9% |
| idle | 33,008 | 32,828 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |

- **1825-29:** almost unchanged. No state among the five is at war then, so the only war effect is the Russo-Turkish grain shock and pressure starting to rise. Aggressive's +1.4 points comes mostly from its war loans of 1821-23 locking up cash going into the panic.
- **1848-50:** bankruptcies barely move (at most ±0.7 points). Most houses that fail have failed before 1848, and the 1848 events already in the game carry most of the shock.
- **Medians fall** for the lenders (cautious −13%, aggressive −21%, bond_heavy −10%).

**Ablation** (300 seeds; the median with one part of the war turned off):

| Variant | Cautious median | Aggressive median |
| --- | --- | --- |
| Full war | 58,611 | 182,555 |
| No pressure risk | 61,093 | 195,214 |
| No trade factors | 53,252 | 198,498 |
| No campaign risk | 64,062 | 186,391 |
| No war at all | 60,785 | 243,717 |

- **Cautious:** the whole war costs about 4% on 300 seeds against 13% on 1,000, and turning parts off does not add up (no trade factors comes out *lower*). The cautious median is lumpy, so much of its fall is path noise, not a steady cost.
- **Aggressive:** most of the fall comes from its own war loans, which every variant above keeps. They lock cash at 6 to 7.5% that it would otherwise lend dearer, and repression loans cost it 10 reputation over a run. War loans are not a dominant play, which is what we want.
- **Balance is the integrator's call.** If the medians matter, the levers are `WAR_PLAY.aggressive` (the harness share) and the `trade` factors in `data/war.json`.
