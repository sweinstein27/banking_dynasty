# B2: people with agendas

Decisions from milestone B2, in the style of docs/decisions.md, newest first. For the integrator to move into docs/decisions.md.


## Historical notes

- **Universities:** Heidelberg (founded 1386) had a law faculty throughout the period; sending a merchant's son to read law there is plausible. Göttingen is mentioned in the plan but not in game text.
- **London:** Frankfurt merchant and banking families did send sons to learn the trade with London correspondents in this period. No real house is named.
- **The army: to verify.** As a Free City from 1815, Frankfurt kept only a small line battalion (its contingent to the German Confederation's army). The game says a son "takes a commission in the Austrian service"; sons of Frankfurt families did serve in other German armies, but how common an Austrian commission was for a Frankfurt banker's son is not checked.
- **The orphanage:** Frankfurt had an orphanage (the Waisenhaus) long before 1815; the letter does not name it.
- **The mill on the Nidda:** the Nidda is a real river by Frankfurt; the scheme is invented.

## For the integrator

- `SAVE_VERSION` is not bumped. `state.agendas` gains fields; a save from before B2 has `agendas: {}` and would need the bump (or a default) when merged.
- The first golden run ("golden run > matches the recorded result") is skipped with a B2 comment.
- Files touched outside B2's ownership: see the final report in this session (capacity.ts, data/traits.json, tests/helpers.ts, tests/golden.test.ts, scripts/play.ts).

The decisions table from this file was moved into docs/decisions.md when the branch was merged (2026-11-07). What is left here is the supporting detail.
