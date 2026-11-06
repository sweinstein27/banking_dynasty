# Banking Dynasty Sim: Prototype Design

Source of truth: the "Banking Dynasty Sim: Prototype Design" doc in Claude. If this file and the doc disagree, the doc wins; re-export it.

## Concept and goal

You run a family trading and banking house in Frankfurt from 1815, growing its capital, reputation and family one quarter at a time. Think Victoria 3's economics with Crusader Kings' dynasty layer, played entirely through ledgers, news and decisions.

The prototype has to prove one thing: that lending, investing and surviving panics is fun for a full run of 1815 to 1850 with no map, no art and nothing but menus. If that loop works, everything else (more cities, rival houses, marriages) is content added on top.

## Prototype scope

One city, one family, 36 years: 144 quarterly turns from 1815 Q1 to the end of 1850.

Widened on 2026-11-06 (Scott's decision): after the first prototype was playable and tuned, the game grows toward its pitch, a Crusader Kings dynasty layer first (Phase 1), then a Victoria 3 world (Phase 2). See the build plan.

| In the game | Saved for later |
| --- | --- |
| Frankfurt, then branches in London, Paris, Vienna, Naples (Phase 2) | More cities beyond these |
| A family of characters with traits, spouses and children (Phase 1) | Family feuds and intrigue |
| 5 core decisions per turn, plus crisis measures | Full investment menu |
| Historical and random events, many with choices (Phase 1) | Hundreds of events, regional news |
| Four or five other Frankfurt houses with opinions of you (Phase 1) | AI rivals that compete for every deal |
| One screen of paper and ink, a map of Europe (Phase 2), single save | Art, sound, Steam release |

## Core loop

Each turn is one quarter:

1. Read the news (events fire)
2. Check the ledger (cash, risk, reputation)
3. Take 3 actions (from the five core decisions)
4. Resolve the quarter (interest, defaults, withdrawals)
   - If cash runs out and assets cannot cover it: bankruptcy, the run ends
   - Otherwise, every 4th turn: year end (ageing, deaths, succession)
5. Next quarter

## The five core decisions

The player gets 3 actions per turn, so every quarter is a choice of what not to do.

| Decision | What you choose | The tradeoff |
| --- | --- | --- |
| Lend to merchants | Amount, rate, borrower | Steady income vs. defaults when trade sours |
| Underwrite state bonds | Which state, how much | Large fees and coupons vs. political and default risk |
| Back a venture | Mill, shipping line, later railways | High returns vs. money locked up and outright failure |
| Adjust reserves | Cash kept on hand | Survive a run on the bank vs. idle capital |
| Invest in the family | Educate an heir, patronage, charity | No direct return vs. reputation and a stronger successor |

## Economic model

The whole game runs on a handful of numbers, and the score is the house's net worth in 1850. All values are starting guesses, meant to be tuned.

- **Balance sheet:** cash, loans outstanding, bonds held, ventures, and deposits owed to customers.
- **Reputation (0 to 100):** sets how much deposit money flows in and which states will let you underwrite their bonds.
- **Market sentiment:** calm, uneasy or panic. It scales every risk in the game.
- **Base interest rate:** drifts slowly; events can jolt it.

Net worth, checked every turn:

    NetWorth = Cash + Loans + Bonds + Ventures - Deposits

Chance a loan defaults in a quarter, where q is borrower quality from 0 to 1 and m rises with sentiment (1 calm, 2 uneasy, 5 panic):

    p_default = p0 * m_sentiment * (1 - q)

**Bank runs:** in a panic, depositors withdraw a share of deposits each turn. If cash runs out, you sell assets at a discount; if that fails, the house goes bankrupt and the run ends.

## Family and succession

- **Head of house** has three stats from 1 to 10: Acumen (venture success), Prudence (spotting bad borrowers) and Connections (access to state bonds).
- **Heirs** start as children. The "invest in the family" action raises one heir's stats.
- **Ageing:** everyone ages each year; the head's chance of death rises after 55.
- **Succession:** the best-trained heir takes over. An untrained heir means a reputation hit and weaker stats for years.

## Events

Every event is a data record with conditions and effects, so writing new ones needs no code.

Starter historical events (from general knowledge; verify dates and details before writing them up):

| Year | Event | Effect in game |
| --- | --- | --- |
| 1815 | End of the Napoleonic Wars | Postwar states need loans; bond demand high |
| 1825 | Banking panic in London | Sentiment to panic; defaults and withdrawals spike |
| 1830 | July Revolution in France | French bond prices drop; political risk rises |
| 1834 | German customs union (Zollverein) takes effect | Trade lending becomes safer and more profitable |
| 1835 | First German railway opens | Railway ventures unlock |
| 1847 to 1848 | Economic crisis, then revolutions across Europe | Long panic; sovereign defaults possible |

Random event examples: a warehouse fire wipes out a merchant borrower; a clerk is caught skimming; a rival house spreads rumors about your solvency; an heir falls ill or shows unexpected talent.

## What makes it fun

Fun comes from judgment under uncertainty, tension you can see coming, and stories you remember, not from finding the one best number.

### In the prototype

| Feature | How it works | Why it matters | Build week |
| --- | --- | --- | --- |
| Hidden borrower quality | You see an estimate, not true quality. Higher Prudence or a paid correspondent's report narrows it. | Every loan is a judgment call | Week 4 |
| Named, recurring borrowers | Borrowers have names and a history with the house; good payers ask for more, past defaulters return | Defaults feel personal; the ledger becomes a cast | Week 4 |
| Panics you can fight | 2 to 3 turns of warning signs, then active choices: pay out slowly, borrow from a rival, call in loans, or suspend withdrawals | A bank run is a boss fight, not a dice roll | Week 4 |
| Family chronicle | End-of-run story generated from the ledger and family records | The payoff for 35 years of play | Week 5 |

Week 4 gets heavier with these; Week 8's buffer absorbs the overflow.

### Moved into the build plan (2026-11-06)

- Heirs with traits, and succession as a real choice between strengths and flaws: Phase 1, D1 and D2
- Ambitions: player-picked goals per decade, such as underwriting a state loan by 1830: Phase 1, D6
- A reactive rival that can stumble in a panic and be rescued for a stake: Phase 1, D4
- Hard political choices, such as lending to governments suppressing the 1848 revolutions: Phase 2, W3

### Still after the build plan (do not build yet)

- Information as a resource: news arrives late; a correspondent network gives earlier warning
- Rivals that bid against you for each deal

### Always

- Fast turns: loans auto-renew unless changed; a "same as last quarter" option
- No dominant strategy: the Week 6 harness must show cautious, aggressive and bond-heavy play can all win
- Clear feedback: a year-end report with a net worth chart and one line on what went right and wrong

## Data model

| Table | Key columns |
| --- | --- |
| world_state | turn, year, quarter, base_rate, sentiment |
| house | id, name, city, cash, deposits, reputation |
| person | id, house_id, name, birth_year, death_year, is_head, acumen, prudence, connections |
| loan | id, borrower_name, principal, rate, quality, start_turn, term_quarters, status |
| bond | id, issuer_state, face_value, coupon, price, risk |
| venture | id, type, invested, expected_return, failure_risk, unlock_year, status |
| event | id, title, text, is_historical, year, conditions_json, effects_json, fired_turn |
| ledger_entry | id, turn, category, amount, note |

## Tech stack and UI

TypeScript and React web app, runs in a browser on a Mac.

- Sim core as pure functions: (state, decisions) -> next state. No UI code inside.
- Seeded randomness: same seed, same run.
- Events and starting data in JSON files.
- Save as one JSON file per game.

### Libraries (reuse, don't build)

| Need | Choice | When |
| --- | --- | --- |
| Seeded RNG | Keep the existing mulberry32 in src/sim/rng.ts (stores state for saves) | Done |
| Immutable state updates | Immer | Optional; adopt if sim updates get verbose |
| Event text and choices | Ink (inkjs); evaluate at the start of Week 4 against plain JSON | Week 4 |
| UI components | React with Radix UI or shadcn/ui | Week 3 |
| Ledger tables | TanStack Table | Week 3 |
| Charts (net worth over time) | Recharts | Week 3 or later |
| Balancing analysis | Harness writes CSV; analyze with DuckDB or pandas outside the game | Week 6 |
| Historical calibration | Bank of England "A millennium of macroeconomic data" (interest rates, prices) | Week 6 to 7 |
| Desktop and Steam | Tauri or Electron, plus steamworks.js | After the prototype |

Not using: a full game engine (Godot, Unity, Phaser), an off-the-shelf economic sim, or an AI model inside the shipped game.

UI: one screen with no scrolling, a counting-house desk: the Gazette (news), the Ledger, the Desk (decisions) and the Family, plus End the quarter. New views (the family tree, the map of Europe) are tabs in the masthead, never longer pages; lists turn pages. Everything is a click: no dragging, no hover-only information, targets of at least 44 px. Must be fully playable on a trackpad.

## Build plan

Eight weeks part-time (about 5 to 8 hours a week). The sim works in a terminal before it gets a screen.

1. Week 1, sim core: state, loans, interest, defaults, End Turn. Print the ledger to the console.
2. Week 2, the rest of the economy: bonds, ventures, reserves, sentiment, bankruptcy.
3. Week 3, first screen: the four panels and End Turn. Play a full run, ugly but complete.
4. Week 4, events: the event system plus the first 6 historical and 10 random events.
5. Week 5, family: stats, heirs, ageing, succession.
6. Week 6, balancing harness: auto-play 1,000 runs with simple strategies (cautious, aggressive, bond-heavy); compare final net worth and bankruptcy rates.
7. Week 7, tune and playtest: adjust numbers until more than one strategy can win. Done, with a one-screen UI redesign after the first playtest and a reputation-driven deposits rule.

The first prototype ends here. The scope then widened (2026-11-06) toward the pitch: Crusader Kings' dynasty layer first, then Victoria 3's world. Each milestone is planned and approved before code, goes sim first with tests, then the terminal, then the UI, and ends with the harness re-run against the balance targets and a browser check.

Phase 1, the dynasty:

- D1, characters with traits: each person has one or two traits (data/traits.json) that change real numbers, and education can shape a child's traits.
- D2, choosing your heir: the player names the successor; passing over the eldest costs reputation.
- D3, events with choices: events offer two or three responses, answered as letters on the desk before the quarter ends (plain JSON, not Ink).
- D4, other houses: four or five invented Frankfurt houses, Kessler among them, each with a head, wealth, reputation and an opinion of the player's house.
- D5, marriages and alliances: children marry into other houses for dowries, allies and grandchildren; births need a spouse.
- D6, the family tree and ambitions: a family tree view, and goals picked each decade.

Phase 2, the world (planned in detail once Phase 1 is done):

- W1, a map of Europe as a second view, with branches in London, Paris, Vienna and Naples.
- W2, goods and prices (grain, cloth, wine, iron, colonial wares) moved by harvests, wars and the Zollverein; borrowers follow their trade.
- W3, states with politics: stability, regimes, wars, and hard choices such as 1848.
- W4, real interest rates, calibrated against the Bank of England data.

Week 8's buffer (fixes and more events) folds into each milestone.

## Success test

- At least two different strategies can reach a strong 1850 finish
- The 1825 panic feels dangerous but survivable with good reserves
- A full run takes about 60 to 90 minutes

## Open questions

- Is the family's background fixed or chosen by the player?
- Does the rival house compete for deals in the prototype, or only appear in the news?
- Quarterly turns, or yearly turns with quarterly resolution, if 140 turns feels too long?
- Free hobby project, or something to sell on Steam eventually?
