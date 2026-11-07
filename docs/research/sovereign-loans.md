# Sovereign loans, 1815-1850

Purpose: how states borrowed through banking houses, what the terms looked like, and how defaults played out. Evidence for fees and syndicate mechanics was thin in what I could open; those gaps are flagged.

## How loans worked

- Banks "lent their reputation": they negotiated terms, rates and prices and marketed the bond, earning a commission, and did not supply most of the capital themselves (Rothschild Archive material as summarized in a web search; [rothschildarchive.org, 1818 subscription ledger](https://rothschildarchive.org/collections/archivists_choice/march_2018_subscription_ledger_for_the_prussian_government_loan_1818); Rothschild profits per Ferguson came from exchange transactions, bond-price speculation and commissions, per [Wikipedia, Nathan Mayer Rothschild](https://en.wikipedia.org/wiki/Nathan_Mayer_Rothschild)). Commission rates were not found (**Uncertain**).
- Flandreau and Flores argue that a prestigious intermediary raised what investors would pay for an unknown sovereign's bonds ([Bonds and Brands, JEH 2009](https://www.cambridge.org/core/journals/journal-of-economic-history/article/abs/bonds-and-brands-foundations-of-sovereign-debt-markets-18201830/9CB9400C2517D8183DC7C72390A5ABA8), abstract only).
- Loans were issued at a discount to par with a fixed coupon, so effective yield exceeded coupon. Example: Mexico's 1824 5% bond at 58 yielded 8.6% ([core.ac.uk paper on early republican Spanish America](https://core.ac.uk/download/29406279.pdf), via search summary).
- A Prussian law of 17 (or 29, sources differ) January 1820 barred the king from contracting state debt without the consent of an assembly, and a state debt administration under Christian von Rother was founded the same year (Engels article and search summary, [marxists.org](https://www.marxists.org/archive/marx/works/1846/05/15.htm); **Uncertain** on the exact date).

## Examples

| Loan | Date | Size | Coupon | Issue price | Notes |
|---|---|---|---|---|---|
| Prussia (Rothschild) | May 1818 | 5 million pounds | 5% | first tranche 70 | traded well above issue; terms leaked by Seehandlung's London agent Barandon before signing |
| Prussia (Rothschild) | 1822 | 3.5 million pounds | 5% | 84 | same source |
| France (Baring and Hope) | contract 18 Feb 1817 | 400,000 pounds of 5% rentes in that contract | 5% | gross price 55 | Hyde Clarke text, via search; the total 1817 loan size is unclear (**Uncertain**) |
| Naples | May and Dec 1821 | Dec 1821: 16.8 million ducats | n/a | not found | syndicated with Neapolitan bankers, Rothschilds main partners |
| Naples | Feb 1824 | 15 million ducats of redeemable bonds | n/a | not found | listed on the London Stock Exchange |
| Gran Colombia | 1822 | 2 million pounds (table garbled) | 6% | 84 | default 1826 |
| Peru | 1822 / 1824 | 450,000 / 750,000 pounds | n/a | 88 / 82 | default Apr 1826 |
| Mexico | 1824 / 1825 | 3.2 million pounds each | 5% / 6% | 58 / 89 | default Oct 1827 |
| Greece (Loughnan) | 1824 | 800,000 pounds | 5% | 59 | two years' interest prepaid; unpaid since Jul 1826 |
| Greece (Ricardo) | 1825 | 2 million pounds | n/a | about 56.5 (OCR "561") | unpaid since Jan 1827 |

Sources: Prussia and Naples: Rothschild Archive and [Rothschild banking family of Naples](https://en.wikipedia.org/wiki/Rothschild_banking_family_of_Naples), plus [rothschildarchive.org Naples paper](https://www.rothschildarchive.org/materials/ar2008naples.pdf) (could not be opened, figures from search summary). France 1817: search summary of Hyde Clarke. Latin America: [core.ac.uk](https://core.ac.uk/download/29406279.pdf) (table OCR garbled; verify). Greece: [Statesman's Year-Book 1871 on Wikisource, as quoted in search](https://kwx.liehendr.com/content/wikisource_en_all_maxi_2022-09/A/Page%3AStatesman's_Year-Book_1871.djvu/324) and [eefshp.org](https://www.eefshp.org/en/?p=11954).

## Aggregate facts

- About 21 million pounds of Latin American issues in the 1820s London boom were sold at an average discount near 25% ([NBER w18363](https://www.nber.org/system/files/working_papers/w18363/w18363.pdf), via search).
- Defaults: Peru Apr 1826; Gran Colombia and Chile Sep 1826; Mexico Oct 1827; Argentina Jan 1828; Central America Feb 1828; Brazil moratorium 1826-29 (same source).
- After the Dec 1825 crisis London bankers stopped foreign loans ([eefshp.org](https://www.eefshp.org/en/?p=11954)). The 1830 London Protocol made Greece accept responsibility for both loans; 1829 reduced offer was refused.
- France: spread over consols fell from over 400 to 100 basis points within ten years ([Oosterlinck et al., JEH abstract](https://www.cambridge.org/core/journals/journal-of-economic-history/article/baring-wellington-and-the-resurrection-of-french-public-finances-following-waterloo/7FEE50AF6DB42D3A6FAA9DCE170E3D3B)).
- Austria: Metternich opened a lottery-type loan negotiation with S. M. von Rothschild in 1820; the family was ennobled in 1822 ([Rothschild Archive via search](https://rothschildarchive.org/business/s_m_von_rothschild_vienna)).
- Not found: Russia 1822 size/terms (only a bond signed by Nathan Rothschild dated 1 Mar 1822), Bavaria, Hesse-Kassel, Frankfurt city loans, Portugal, Spain (all **Uncertain**/absent).

## For the game

- Loan offer fields: `size`, `coupon` (4 to 6%), `issuePrice` (55 to 90), `commissionPct`, `syndicateShare`. Pricing rule from the table: issue price 70 to 85 for sound borrowers, 55 to 60 for risky ones.
- Effective yield = coupon / price. Bank's profit = commission plus gain if the market price rises above issue (Prussia 1818 pattern); loss if unplaced.
- Defaults: risky tier (new Latin American, Greek style) default probability spikes in 1826-28; make credit tightening after a crisis event.
- Treat commission as a tuning value (design placeholder, 1 to 3%) until a source is found.

## Uncertain

- Commission/fee percentages for any loan.
- Naples issue prices and syndicate shares.
- Total of the 1817 French loan; Baring/Hope fee.
- Latin American table values (OCR-garbled source).
- Greek 1825 price (56.5 inferred from OCR).
- Date of Prussian debt law.
- Russia, Bavaria, Hesse-Kassel, Frankfurt, Portugal, Spain: no data found.
