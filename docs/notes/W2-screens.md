# Wave 2: wave 1's screens

Decisions from the screens session (branch `claude/w2-screens-0e7e3b`), in the style of docs/decisions.md, for the integrator to move there. Plan approved by Scott on 2026-11-07. Nothing in `src/sim/` changed.

| Date | Question | Decision |
| --- | --- | --- |
| 2026-11-07 | Where do the House and the Markets fit, when a panel is about 540 px wide at 1280x800? | They open **wide**: while open they take the Desk's column too. End Turn stays on the top bar; closing them brings the Desk back. The Bourse keeps the normal width. (`WIDE_PANELS` in src/ui/Panel.tsx.) |
| 2026-11-07 | Where do ventures live now? | In Markets (Ventures tab), next to the companies they float as. The Bourse keeps Merchants, Loans held and States. |
| 2026-11-07 | The council's advice: House or Letters? | The House only, one letter a page. The letters already reach the Gazette from End Turn. |
| 2026-11-07 | How is a merchant's file shown in a narrow panel? | A short row per request (kind, term, amount, rate, bourse talk, chips for the file's age and the analyst's word), and an "Open the file" dialog with the full request, the report or inquiry as a parchment document with its age, the analyst's opinion and the four actions (lend, report, inquiry, analyst). Each action shows its price, and when the sim would refuse it, the reason under the button in words. |
| 2026-11-07 | Lending from the file | The dialog lends to that borrower directly: amount (with quick amounts) and rate, checked by the sim. The Desk's "Lend to merchants" card still opens the old dialog with a choice of borrower. |
| 2026-11-07 | Report, inquiry and analyst clicks | Queue at once, with the price on the button, like other orders. The Desk's orders sheet lists them, and "Take back all" undoes them. Selling a loan and selling a venture stake ask to confirm first, since they lose money for certain. |
| 2026-11-07 | A loan's sale price breakdown | Principal less four parts: any buyer's margin, the bourse's doubts about the borrower, the quarters left and the market's mood, in fl., adding up to `salePrice`. When the discount hits its cap, the parts are scaled to the cap. The "doubts" line uses the market's view of the borrower (`market_quality`), which is public, never the true quality. No quality number is shown. |
| 2026-11-07 | The cutaway | Three floors: reception rooms, the partner's office and the archive upstairs; the counting room on the ground floor with one tile per desk (name, post, skill, trait, wage, and whether starting or leaving); strongroom, courier stable and warehouse in the cellar and yard. Unbuilt rooms are hatched with their price; rooms being built are dashed. Clicking a room opens its sheet: staff with Dismiss, this quarter's candidates by post with Hire, build or enlarge, and (in the counting room) consulting an analyst. |
| 2026-11-07 | Commodity trend | Shown as the direction from today's price toward this quarter's target (`commodityTarget`), level within 2%, plus the price against a fair year. The sim keeps no price history, so this is "which way it is heading", not "what it did". |
| 2026-11-07 | Company figures shown | Price, last dividend and its yield, the house's earnings estimate (range and the report it rests on), holdings. Never fair value or true earnings. Price change since last quarter is not shown (no price history in the sim). |
| 2026-11-07 | Venture overruns | Shown as calls added beyond the type's planned calls (`calls - type.calls`), drawn as red-dashed call boxes. The sim doesn't keep the original commitment, so the overrun in fl. isn't shown; the commitment as it stands is. |
| 2026-11-07 | Counting panel | Replaced by the House (`CountingPanel.tsx` removed). Set reserves moved to the House's side column; the Desk keeps its own card too. |

## Checks

- `npm run typecheck` and `npm test` pass (591 tests, 4 skipped as on main). New: tests/ui-screens.test.ts plays 24 quarters of the economy strategy and checks every sum against the sim, that every action the screens show as open is accepted by the sim (and every refused one refused), that trade costs match the cash taken, and that no "quality", "fair" or "truth" reaches the screens' data.
- Fit: every tab and first dialog of the Bourse, the House (and every room sheet) and Markets, on four fresh v15 saves (1815, 1816, 1825, 1840 with queued orders), with no page scroll, no overflow and no button under 44 px, at 1280x800, 1440x900 and 1920x1080. The checker is out/w2check.js and the saves come from out/make-saves.ts (both gitignored).
- In the browser: enlarging the counting room, hiring, building the strongroom, buying grain, reports, inquiries and analysts all queue on the Desk's orders sheet; refusals show the sim's reason.

## Notes for merging

- Port 5173 was taken by the main checkout's dev server, so this branch ran on 5181 through a local, uncommitted (skip-worktree) entry in .claude/launch.json.
- Bold EB Garamond doesn't load from a worktree's dev server (403: node_modules is outside its allowed folder). This doesn't happen on main.
- `BdLine` in src/ui/Breakdown.tsx is now exported, for the new sum cards (src/ui/ScreenKit.tsx).
- The glossary's ventures card was rewritten for A3's rules (calls, overruns, sections, listing).
