# Wave 2: wave 1's screens

Decisions from the screens session (branch `claude/w2-screens-0e7e3b`), in the style of docs/decisions.md, for the integrator to move there. Plan approved by Scott on 2026-11-07. Nothing in `src/sim/` changed.


## Checks

- `npm run typecheck` and `npm test` pass (591 tests, 4 skipped as on main). New: tests/ui-screens.test.ts plays 24 quarters of the economy strategy and checks every sum against the sim, that every action the screens show as open is accepted by the sim (and every refused one refused), that trade costs match the cash taken, and that no "quality", "fair" or "truth" reaches the screens' data.
- Fit: every tab and first dialog of the Bourse, the House (and every room sheet) and Markets, on four fresh v15 saves (1815, 1816, 1825, 1840 with queued orders), with no page scroll, no overflow and no button under 44 px, at 1280x800, 1440x900 and 1920x1080. The checker is out/w2check.js and the saves come from out/make-saves.ts (both gitignored).
- In the browser: enlarging the counting room, hiring, building the strongroom, buying grain, reports, inquiries and analysts all queue on the Desk's orders sheet; refusals show the sim's reason.

## Notes for merging

- Port 5173 was taken by the main checkout's dev server, so this branch ran on 5181 through a local, uncommitted (skip-worktree) entry in .claude/launch.json.
- Bold EB Garamond doesn't load from a worktree's dev server (403: node_modules is outside its allowed folder). This doesn't happen on main.
- `BdLine` in src/ui/Breakdown.tsx is now exported, for the new sum cards (src/ui/ScreenKit.tsx).
- The glossary's ventures card was rewritten for A3's rules (calls, overruns, sections, listing).

The decisions table from this file was moved into docs/decisions.md when the branch was merged (2026-11-07). What is left here is the supporting detail.
