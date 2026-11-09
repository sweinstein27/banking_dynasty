# C2, politics: decisions

In the style of docs/decisions.md, newest first. For the integrator to move into docs/decisions.md.

The decisions table from this file was moved into docs/decisions.md when the branch was merged (2026-11-09). What is left here is the supporting detail.

## Historical notes and uncertainty

Checked against docs/research/politics-and-war.md unless a source is given.

- **Senate:** 42 members in three benches; officeholders needed citizenship with 5,000 fl. in property, to be 30 or older, and not unpaid bankrupts (Konstitutionsergänzungsakte, 1816). **Uncertain:** how a vacancy was filled. I found a drawing of lots ("Kugelung") only for the election of the two burgomasters in 1824, and nothing on life terms or a bar on relatives sitting together. The game uses one roll on standing, influence and the bourse's opinion, a life seat, and one Senate seat per house.
- **Office for men only:** taken as given for the period; not separately sourced.
- **The Federal Diet:** sat in Frankfurt from 5 November 1816; handed its powers to the Regent on 12 July 1848. Its members were the states' envoys. The four Free Cities (Lübeck, Frankfurt, Bremen, Hamburg) shared one vote in the inner council (Bundesakte, 8 June 1815, https://germanhistorydocs.org/de/vom-vormaerz-bis-zur-preussischen-vorherrschaft-1815-1866/deutsche-bundesakte-8-juni-1815). **Uncertain:** how the shared vote was used (by rotation?) and whether Frankfurt's envoy was always a senator; the game makes him one. The Diet was restored in 1850 to 1851, at the very end of the game; the post does not come back.
- **Court bankers:** Mayer Amschel Rothschild was court agent at Kassel; court bankers (Hofbankiers) were common at German courts. **Uncertain:** the appointments, terms and privileges at Darmstadt, Nassau, Munich, Vienna and Berlin. The gifts, bars, loan sizes and favour are invented. The courts named are real states of the period: the Duchy of Nassau, the Grand Duchy of Hesse (Darmstadt), Bavaria, Austria and Prussia.
- **The family's faith:** the Adlers are a Lutheran citizen family (Scott's decision). The sources seen do not say when Jews could sit in the Senate; under the 1816 act they were not full citizens, so a Jewish house could not stand. A Jewish house is for D1 scenarios.
- **Letters:**
  - *Riots against the Jews* (1819 Q3): the Hep-Hep riots in Frankfurt, 8 to 12 August 1819; they began in Würzburg earlier that month (the Würzburg start is from general knowledge, not the research file: **to verify**).
  - *The Diet's decrees in the Senate* (1819 Q4): the Carlsbad Decrees were adopted by the Diet on 20 September 1819. **Uncertain:** that the Frankfurt Senate debated how strictly to enforce them; the letter invents the debate.
  - *The rights of the Jewish community* (1824 Q2): civil rights restored in 1824 with a limit on marriages. **Uncertain:** the month (the quarter is a guess) and the Senate's part in it.
  - *Soldiers for the city* (1833 Q2): the Wachensturm of 3 April 1833 and the stationing of about 2,500 Austrian and Prussian soldiers afterwards. **Uncertain:** that the Senate was asked to agree.
  - *The March demands* (1848 Q1): on 3 March 1848 the Senate granted all rights except full emancipation. The crowd's demands are written generally.
  - *Barricades in Frankfurt* (1848 Q3): the Assembly accepted the Malmö armistice on 16 September; the riots and the troops from Mainz follow the research file. **Uncertain:** whether the Senate asked for the troops (the research file says Prussian and Austrian troops came from Mainz).
  - *Money for the imperial army* (1848 Q4): Vienna was retaken from the October rising at the end of October 1848, and the campaign against Hungary followed (general knowledge: **to verify**). The loan request is invented.

## For the integrator

- **Wire the hooks:** subtract `contractFavour` from the player's commission when ranking bids in `awardContracts` (ranking only: the fee stays the bid); subtract `contractGateRelief` in `reputationGate` (src/sim/bonds.ts), which `contractGate` also uses; multiply the withdrawal factor in `endTurn` by `withdrawalRelief(next, data)`. The wired harness run below did exactly this.
- **Hook order:** `resolvePolitics` stays just after `resolveHouses`. It reads `letter_outcomes` settled at the start of End Turn and posts its letters before `resolveEvents`.
- **Files touched outside C2's ownership:** `src/sim/capacity.ts` (the four head's-time kinds), `src/sim/save.ts` (court loans in the save check), `tests/strategies.test.ts` (the letter-style test lists two new replies: cautious answers the riots letter with quiet help, aggressive takes the chance in the September letter).
- `SAVE_VERSION` is not bumped: `state.politics` gains fields, so a save from before C2 has `politics: {}`.
- Golden runs are unchanged on this branch: `npm test` passes them without a skip.
- **For the screens:** news uses kind "event" with a title (no new NewsKind). Letter cards should add `politicsOptionEffects`. Court requests, vacancies, influence and the assurance need a Politics panel; the decisions' refusal reasons are written for the player.
- **For B3 legacy:** read `influence(state)` (0 to 100) and `offices(state)` (`senate` and `diet` person ids or null, `courts` ids).
