# Banking Dynasty Sim: Prototype Design

Source of truth: the "Banking Dynasty Sim: Prototype Design" doc in Claude. If this file and the doc disagree, the doc wins; re-export it.

## Concept and goal

You run a family trading and banking house in Frankfurt from 1815, growing its capital, reputation and family one quarter at a time. Think Victoria 3's economics with Crusader Kings' dynasty layer, played entirely through ledgers, news and decisions.

The prototype has to prove one thing: that lending, investing and surviving panics is fun for a full run of 1815 to 1850 with no map, no art and nothing but menus. If that loop works, everything else (more cities, rival houses, marriages) is content added on top.

## Prototype scope

One city, one family, 35 years: 140 quarterly turns from 1815 to 1850.

| In the prototype | Saved for later |
| --- | --- |
| Frankfurt only | Branches in London, Paris, Vienna, Naples |
| Head of house plus 1 to 3 heirs | Marriages, alliances, family feuds |
| 5 core decisions per turn | Full investment menu |
| About 15 historical events, 20 random ones | Hundreds of events, regional news |
| One simple rival house (news only) | AI rivals that compete for deals |
| Text and tables, single save | Map, art, sound, Steam release |

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

UI: four panels (News, Ledger, Family, Decisions) plus End Turn. Everything is a click: no dragging, no hover-only information, large targets. Must be fully playable on a trackpad.

## Build plan

Eight weeks part-time (about 5 to 8 hours a week). The sim works in a terminal before it gets a screen.

1. Week 1, sim core: state, loans, interest, defaults, End Turn. Print the ledger to the console.
2. Week 2, the rest of the economy: bonds, ventures, reserves, sentiment, bankruptcy.
3. Week 3, first screen: the four panels and End Turn. Play a full run, ugly but complete.
4. Week 4, events: the event system plus the first 6 historical and 10 random events.
5. Week 5, family: stats, heirs, ageing, succession.
6. Week 6, balancing harness: auto-play 1,000 runs with simple strategies (cautious, aggressive, bond-heavy); compare final net worth and bankruptcy rates.
7. Week 7, tune and playtest: adjust numbers until more than one strategy can win.
8. Week 8, buffer: fix what broke, write more events.

## Success test

- At least two different strategies can reach a strong 1850 finish
- The 1825 panic feels dangerous but survivable with good reserves
- A full run takes about 60 to 90 minutes

## Open questions

- Is the family's background fixed or chosen by the player?
- Does the rival house compete for deals in the prototype, or only appear in the news?
- Quarterly turns, or yearly turns with quarterly resolution, if 140 turns feels too long?
- Free hobby project, or something to sell on Steam eventually?
