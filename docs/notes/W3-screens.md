# Wave 3: wave 2's screens

Decisions from the screens session (branch `claude/w3-screens-e89361`), in the style of docs/decisions.md, for the integrator to move there. Plan approved by Scott on 2026-11-08. Nothing in `src/sim/` changed.

The decisions table from this file was moved into docs/decisions.md when the branch was merged (2026-11-09). What is left here is the supporting detail.

## Checks

- `npm run typecheck` and `npm test` pass (737 tests). New: tests/ui-wave3-screens.test.ts plays 70 quarters of a rich, well-known house that takes every open chance (contracts, credit, lots, cover, family letters, studies, branches, bills) on top of the economy strategy. On every quarter it checks that every choice the screens show as open is accepted by the sim and every refused one refused, that the finance, exposure, Europe and branch-estimate sums add up to the sim's own figures, that the worth breakdown equals `netWorth`, that a bill's face and cost match what the sim books, and that the map shows only `known`.
- Fit: every ribbon of Finance, Family, Progress and Europe (every city, both sheet ribbons) on eight saves (1815, 1817, 1819 to 1823 with a contract, a lot, a credit request, a cover request or a family letter open, 1830, 1846). At 1280x800, 1440x900 and 1920x1080 nothing overflows or scrolls and no button is under 44 px. The checker and saves are in out/ (gitignored): out/make-w3-saves.ts.
- In the browser (port 5182): a 2% bid on the Naples loan, a branch opened in Hamburg (its news delay fell from 4.5 to 2.7 days, as `newsDelay` says), a bill on Hamburg, a family match granted and an heir sent to London all queue on the Desk; End Turn resolves them with no console errors.

## Notes for merging

- Port 5173 was taken, so this branch ran on 5182 through a local, uncommitted (skip-worktree) entry in .claude/launch.json.
- The UI reads, from wave 2: `openContracts`, `contractGate`, `cautionFor`, `bidScore`, `placementRate`, `checkBidContract` (contracts.ts); `openHouseRequests`, `activeHouseLoans`, `gratitude`, `checkLendHouse` (houseLoans.ts); `openLots`, `bidPrice`, `checkBidLot`, `checkSellAsset`, `assetSalePrice`, `seasonFactor` (auctions.ts); `openCoverRequests`, `activePolicies`, `exposure`, `premiumFor`, `policyName`, `checkUnderwrite` (insurance.ts); `financeBook`; B2's `letterWords`, `familyOptions`, `DEFAULT_OPTION`, `checkAnswerFamilyLetter`, `checkSendToStudy`, `loyaltyOf`, `loyaltyWord`, `hasLoyalty`, `studyOf`, `studyData`, `splitTerms`; C4's `adoption`, `curveLevel`, `sectorFactor`, `ventureBlocked`, `telegraphDelay`; C1's `newsDelay`, `roadDays`, `quote`, `isFixed`, `branchQuarter`, `closeChance`, `closeLoss`, `headProblem`, `branchHead`, `billFace`, `billRoom`, `billDiscount` and the five `check*` functions. **W3 rivals changes finance.ts and contracts**: if a name or signature moves, src/ui/model/finance.ts needs the matching one-line change, and tests/ui-wave3-screens.test.ts will catch any disagreement.
- The Europe sheet reads a city's status from `known`, so C3 (war) cities at war show the double ring and the alert ("Your branch in X: the city is at war") with no change here.
- Follow-ups, not done here: the shell at phone widths (the top bar's readouts shrink to 16 px and the Desk stays beside the narrow panels, so the Family panel is cramped at 375 px; this is A4's layout, not wave 2's pages); B2's `describePeopleDecision` writes the path name in lower case ("apprenticeship in london").
