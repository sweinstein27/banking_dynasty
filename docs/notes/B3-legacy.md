# B3: legacy

Decisions from milestone B3 (simulation only; the family tree view comes in wave 4), in the style of docs/decisions.md, newest first. For the integrator to move into docs/decisions.md.

The decisions table from this file was moved into docs/decisions.md when the branch was merged (2026-11-09). What is left here is the supporting detail.

## Historical notes

- **Rothschild:** Emperor Francis I ennobled four Rothschild sons in 1816; all five became Austrian Freiherren on 29 September 1822 (docs/research/politics-and-war.md, from the Rothschild family article). The 6-year gap before Freiherr comes from this.
- **Bethmann:** Simon Moritz Bethmann received the Austrian Ritterstand in 1808 (Grenzboten article; Deutsche Biographie dates his "von" from 1808). His son Moritz was made Freiherr in Baden only in 1854. Sources: https://www.deutsche-biographie.de/sfz4256.html, https://en.wikipedia.org/wiki/Moritz_von_Bethmann, https://brema.suub.uni-bremen.de/grenzboten/download/pdf/356025
- **Austria and Prussia:** Austria ennobled Jewish and Christian financiers freely from about 1800 (eleven ennobled Jewish families in Vienna by 1821); Prussia was far more reserved (Zupanic, https://przegladhistoryczny.uw.edu.pl/wp-content/uploads/sites/213/2024/05/59-68-Jan-Zupanic.pdf; https://en.wikipedia.org/wiki/Austrian_nobility). Making someone a baron who was not already noble was exceptional (Holec, https://www.sav.sk/journals/uploads/02191133Holec.pdf), hence "von" before Freiherr.

## Uncertain (flagged, not guessed)

- **Bavaria as a grantor:** plausible (it ennobled bankers in the period) but not checked. Chance and conditions are invented.
- **Fees:** the Taxe for each rank is not sourced; 3,000 fl. and 8,000 fl. are game numbers.
- **The ladder:** Austria had grades between plain "von" and Freiherr (Edler, Ritter). The game uses two ranks, as the spec asks.
- **A cousin inheriting:** an Austrian patent passed to the grantee's legitimate descendants; a distant cousin would not strictly inherit it. The game keeps the title with the house.
- **Service as a condition:** historically titles rewarded loans and public works; the exact link (a contract won, or 20,000 fl. of bonds) is a game rule.

## For the integrator

- **Capacity:** `src/sim/capacity.ts` is not mine. Please add `choose_ambition` to `FREE` (legacy already uses no capacity for it, but `poolFor` would call it a deal) and map `petition_title` to `"head"` in `BY_KIND` (it now draws on deals by default).
- **Influence:** replace the body of `influence(state, data)` in `src/sim/systems/legacy.ts` with C2's exported measure, scaled 0 to 100.
- **Titles elsewhere:** `titleRank(state)` and `titledName(name, state)` are exported for later wiring (dowries, contract bid scores, the chronicle, the family view). Nothing outside legacy calls them yet.
- **SAVE_VERSION** is not bumped. `state.legacy` now has fields; a v17 save has `legacy: {}` and needs the bump.
- **Goldens** are unchanged: the golden strategies take no legacy decisions and legacy rolls on its own stream.
- **News** goes into `state.news` as kind "family" (titles "An ambition met", "An ambition missed", "Ambitions for a new era", "A title granted", "A petition refused"); `src/sim/news.ts` is untouched.
- **Ledger:** one new category, `title_fee` (cash; negative when paid, positive when returned).
- Files touched outside B3's ownership: none.

## Harness: what legacy does to each strategy (seeds 1 to 300)

Measured with a scratch script (the harness's `run.ts` and `targets.ts` are not B3's), legacy on against legacy off (`enabled: false`), same seeds. Prestige is the final total (influence is 0 until C2 merges, so the real maximum is 400).

| Strategy | Bankrupt on / off | Median net worth on / off | Median prestige on / off | p10 to p90 prestige (on) | Wealth | Standing | Family | Legacy | Ambitions met (mean of 4) | "von" |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| idle | 0% / 0% | 32,851 / 32,851 | 52 / 52 | 27 to 71 | 7 | 21 | 30 | 0 | 0 | 0% |
| cautious | 3% / 3% | 66,912 / 64,276 | 187 / 168 | 138 to 240 | 27 | 56 | 90 | 20 | 1.77 | 4% |
| aggressive | 32% / 32% | 240,527 / 232,812 | 153 / 145 | 66 to 223 | 62 | 27 | 45 | 25 | 0.95 | 0% |
| bond_heavy | 20% / 20% | 71,990 / 81,125 | 95 / 92 | 62 to 156 | 29 | 22 | 45 | 10 | 0.72 | 0% |
| venture_heavy | 9% / 7% | 93,662 / 95,450 | 131 / 125 | 84 to 184 | 36 | 25 | 45 | 30 | 0.90 | 0% |
| investor | 4% / 4% | 73,879 / 72,954 | 93 / 96 | 62 to 139 | 30 | 20 | 45 | 0 | 0.27 | 0% |
| cautious_no_family | 4% / 6% | 48,890 / 53,565 | 149 / 138 | 107 to 205 | 18 | 51 | 65 | 10 | 1.03 | 7% |

Reading:
- **Money is barely touched.** Legacy pays no cash rewards; a met or missed ambition moves reputation by a few points, which shifts a run's later path (a lend of 4,800 fl. instead of 4,700 fl.) without biasing it. Medians move both ways by up to 11% (bond_heavy down, cautious up); bankruptcy rates are within 2 points. On 50 seeds the same comparison looked like a 30% drop for cautious_no_family: that was noise.
- **T7 still holds on these seeds:** cautious 66,912 against cautious_no_family 48,890 (needs at least 90%).
- **Titles are rare.** Only the cautious strategies reach 55 reputation, and few of their runs reach 75,000 fl. with 20,000 fl. of one state's bonds. No run reaches Freiherr. The levers, all in data/legacy.json, are the titles' `min_net_worth` and `min_reputation` and the petition's `bond_face`.
- **Reputation drives the spread.** The standing pillar splits cautious play (51 to 56) from everyone else (20 to 27); the family pillar splits strategies that marry into houses (cautious) from those that do not (45, heirs only).

## Proposed prestige targets (for the integrator; targets.ts untouched)

| Id | Target | Now (300 seeds) | Passes? |
| --- | --- | --- | --- |
| P1 | Idle's median prestige is below every contender's | idle 52; lowest contender investor 93 | Yes |
| P2 | No contender dominates another on (median net worth, median prestige) | venture_heavy (93,662; 131) dominates bond_heavy (71,990; 95) and investor (73,879; 93) | No |
| P3 | Every contender's median prestige is at least 60% of the best | best cautious 187, so at least 112: bond_heavy 95 and investor 93 fall short | No |
| P4 | cautious beats cautious_no_family on median prestige (education shows somewhere) | 187 against 149 | Yes |

P2 and P3 fail because bond_heavy and investor score little on standing and family: they never court, rarely marry into houses and keep reputation in the low 20s. When the integrator sets these targets, the fixes are those strategies' marriage and reputation play (outside B3) or C2's influence pillar, which should favour bond-heavy play (state loans, a court banker's place). I'd suggest adopting P1 and P4 now, and P2 and P3 after C2 merges.
