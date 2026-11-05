# Decisions

Open questions and settled answers, newest first.

| Date | Question | Decision |
| --- | --- | --- |
| 2026-11-05 | How do reserves work? | The reserve is a cash floor the player sets with a `set_reserve` action, which uses one of the turn's 3 actions. Lending (and later bonds and ventures) may only spend cash above it. Withdrawals may go below it, and are paid from the reserve first, then from free cash. The floor itself does not shrink after a withdrawal, so new spending stays blocked until income rebuilds cash. A reserve above current cash is allowed. Setting it writes no ledger entry because no money moves. |
| 2026-11-05 | Do the 3 actions per turn apply to every decision type? | Yes. `actions_per_turn` moved from `loans` to the top level of tuning.json, and the state tracks `actions_this_turn`, reset at End Turn. |
| 2026-11-05 | What happens in Week 1 to systems the spec leaves for later? | Sentiment stays calm, the base rate is fixed, deposits do not move or pay interest, and there is no bankruptcy check. Lending is refused if it would push cash below zero. Net worth can go negative after defaults until Week 2 adds bankruptcy. |
| 2026-11-05 | When does a new loan start earning, and in what order does a quarter resolve? | Loans are made at the start of the quarter, so they earn interest that quarter. Order: apply decisions, roll defaults, collect interest from loans that did not default, repay loans at the end of their term, advance the calendar. |
| 2026-11-05 | The spec's ledger_entry has no way to show non-cash changes such as a default. | Added an `account` column (cash, loans, deposits). A loan writes two entries (cash out, loans in), a default writes one loans entry. Summing entries per account reproduces each balance, so any run can be reconciled. Opening balances are written as `opening` entries. |
| 2026-11-05 | Can the player pick the loan term? | No. The term is fixed at 4 quarters (`loans.term_quarters` in tuning.json). |
| 2026-11-05 | What is lost when a loan defaults? | The full principal, and no interest that quarter. A partial recovery rate may come in Week 2. |
| 2026-11-05 | If the player sets the rate, what stops them always picking the highest? | Three borrower tiers (poor q=0.3, fair q=0.6, good q=0.9). Each tier has a maximum rate it will accept, higher for riskier borrowers. An offer above that maximum is refused. Values live in tuning.json. |
| 2026-11-05 | What currency and units does the ledger use? | Frankfurt gulden (fl.), stored as whole integers to avoid rounding drift. Interest is rounded to the nearest gulden. Starting cash 100,000 fl., deposits 50,000 fl., reputation 50. **To verify:** that the gulden was Frankfurt's money of account in 1815, and whether these starting sums are plausible for a mid-sized house. |
| 2026-11-05 | Who is the player's house? | A made-up placeholder, "Haus Adler", in tuning.json. Merchant borrower names in data/borrowers.json are also invented, not historical people. Related to the open question on whether the family background is fixed or chosen. |
