# Wave 3: wave 2's screens

Decisions from the screens session (branch `claude/w3-screens-e89361`), in the style of docs/decisions.md, for the integrator to move there. Plan approved by Scott on 2026-11-08. Nothing in `src/sim/` changed.

## Decisions

| # | Question | Decision |
| --- | --- | --- |
| 1 | Where do wave 2's systems live in the shell? | Three new side-menu panels: **Finance** (A5), **Europe** (C1, the map) and **Progress** (C4), all wide (they take the Desk's room, like Markets and the House). People (B2) goes into the **Family** panel as ribbons: the house, Letters, Studies, Feuds. |
| 2 | How is a decision with a few fixed choices shown (a commission, a rate, a bid, a line)? | One `ChoiceDialog` (src/ui/ScreenKit.tsx): the terms as sums at the top, each choice as a large button with its price and what it brings, the sim's refusal under any it would refuse, the time it takes, and a confirm button. |
| 3 | What does a decision say about the house's time? | `capacityNote` (src/ui/model/capacity.ts) reads capacity.ts's pools: "Uses 1 of 2 deals (clerks) left this quarter (of 3)", or that it falls back to the head's time, or that none is left. Every wave 2 action shows it. |
| 4 | Rates to offer a house asking for credit | About five even steps (whole half points) from the floor (`min_rate`) to the house's top rate, plus the top of each gratitude band, so the opinion change at each band edge is visible. Every half point made the dialog too tall. |
| 5 | The map | An inline SVG, equirectangular, squeezed east-west at 48 degrees north, with a hand-drawn simplified coastline (the mainland and Great Britain) in src/ui/model/europe.ts. It is labelled "drawn by hand, for orientation only". No map library. |
| 6 | What the map shows of a city | Only `known` (mood, status, shock as last heard), never the true mood or rate; the test checks the map's data equals `known`. Each label says how many days late its news is. A dispatch written at turn t's End Turn tells of quarter t + 1, so "news as of" is that quarter. |
| 7 | A city's branch estimate | `branchQuarter` run on the city's **known** mood and status at the Frankfurt quote: "next quarter, if the city stays as Frankfurt knows it". The closure chance and the open-branch warning use the known view too. |
| 8 | Who may open a branch | The sheet lists only members who can head one (`headProblem` is null) and sums up the rest in one line ("Cannot go: ... too young ..."), so the sheet fits the page. |
| 9 | Progress and borrower quality | Trades moved by progress are described by direction only ("grow weaker, turnover falls toward 70%"): no quality number reaches the screen (the test checks). |
| 10 | Untitled stages | A stage with no title in data/progress.json (the 1835 railway, told by its own event) is shown as "The first railways in the German lands". |
| 11 | Narrow windows | At 900 px wide or less, wave 2's pages stack their columns and scroll inside the document rather than clip. Desktop sizes never scroll. |
| 12 | The top bar's net worth breakdown | Now lists finance, Europe and the four wave 3 books when they hold anything, so its lines always add up to `netWorth`. It left them out before, which would have shown a sum that did not add up once a branch or an asset was held. |

## Checks

- `npm run typecheck` and `npm test` pass (737 tests). New: tests/ui-wave3-screens.test.ts plays 70 quarters of a rich, well-known house that takes every open chance (contracts, credit, lots, cover, family letters, studies, branches, bills) on top of the economy strategy. On every quarter it checks that every choice the screens show as open is accepted by the sim and every refused one refused, that the finance, exposure, Europe and branch-estimate sums add up to the sim's own figures, that the worth breakdown equals `netWorth`, that a bill's face and cost match what the sim books, and that the map shows only `known`.
- Fit: every ribbon of Finance, Family, Progress and Europe (every city, both sheet ribbons) on eight saves (1815, 1817, 1819 to 1823 with a contract, a lot, a credit request, a cover request or a family letter open, 1830, 1846). At 1280x800, 1440x900 and 1920x1080 nothing overflows or scrolls and no button is under 44 px. The checker and saves are in out/ (gitignored): out/make-w3-saves.ts.
- In the browser (port 5182): a 2% bid on the Naples loan, a branch opened in Hamburg (its news delay fell from 4.5 to 2.7 days, as `newsDelay` says), a bill on Hamburg, a family match granted and an heir sent to London all queue on the Desk; End Turn resolves them with no console errors.

## Notes for merging

- Port 5173 was taken, so this branch ran on 5182 through a local, uncommitted (skip-worktree) entry in .claude/launch.json.
- The UI reads, from wave 2: `openContracts`, `contractGate`, `cautionFor`, `bidScore`, `placementRate`, `checkBidContract` (contracts.ts); `openHouseRequests`, `activeHouseLoans`, `gratitude`, `checkLendHouse` (houseLoans.ts); `openLots`, `bidPrice`, `checkBidLot`, `checkSellAsset`, `assetSalePrice`, `seasonFactor` (auctions.ts); `openCoverRequests`, `activePolicies`, `exposure`, `premiumFor`, `policyName`, `checkUnderwrite` (insurance.ts); `financeBook`; B2's `letterWords`, `familyOptions`, `DEFAULT_OPTION`, `checkAnswerFamilyLetter`, `checkSendToStudy`, `loyaltyOf`, `loyaltyWord`, `hasLoyalty`, `studyOf`, `studyData`, `splitTerms`; C4's `adoption`, `curveLevel`, `sectorFactor`, `ventureBlocked`, `telegraphDelay`; C1's `newsDelay`, `roadDays`, `quote`, `isFixed`, `branchQuarter`, `closeChance`, `closeLoss`, `headProblem`, `branchHead`, `billFace`, `billRoom`, `billDiscount` and the five `check*` functions. **W3 rivals changes finance.ts and contracts**: if a name or signature moves, src/ui/model/finance.ts needs the matching one-line change, and tests/ui-wave3-screens.test.ts will catch any disagreement.
- The Europe sheet reads a city's status from `known`, so C3 (war) cities at war show the double ring and the alert ("Your branch in X: the city is at war") with no change here.
- Follow-ups, not done here: the shell at phone widths (the top bar's readouts shrink to 16 px and the Desk stays beside the narrow panels, so the Family panel is cramped at 375 px; this is A4's layout, not wave 2's pages); B2's `describePeopleDecision` writes the path name in lower case ("apprenticeship in london").
