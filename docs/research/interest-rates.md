# Interest rates, 1815-1850

Only facts seen in the cited pages are stated. Gaps are marked **Uncertain** and listed at the end.

## British benchmark

**Bank of England rate.** The Bank's rate was 5% for seventy-six years up to June 1822, then moved between 4% and 5% until 1839 (search summary of a Bank of England history, results incl. https://www.perlego.com/book/1677529/century-of-bank-rate-pdf; specific 1822 cut not confirmed, **Uncertain**). Usury laws set a 5% ceiling; section 7 of the Bank Charter Act of 1833 exempted bills of up to three months, allowing the Bank for the first time to exceed 5%. The rate went to 5.5% on 20 June 1839 and 6% six weeks later, the first time ever above 5% (same search, sources not individually opened). One source dates the usury repeal to 1837 and the general repeal act is dated 1854 (https://en.wikipedia.org/wiki/Usury lists the Usury Laws Repeal Act 1854). Those dates conflict; **Uncertain.**

**Consol yield** (Bank of England series, annual, FRED LTCYUKA, https://fred.stlouisfed.org/data/LTCYUKA):

| Year | Yield % | Year | Yield % |
|---|---|---|---|
| 1815 | 5.04 | 1833 | 3.43 |
| 1816 | 4.81 | 1835 | 3.32 |
| 1817 | 3.99 | 1837 | 3.31 |
| 1818 | 3.85 | 1839 | 3.29 |
| 1820 | 4.38 | 1841 | 3.38 |
| 1822 | 3.76 | 1843 | 3.16 |
| 1824 | 3.21 | 1845 | 3.07 |
| 1826 | 3.81 | 1847 | 3.46 |
| 1828 | 3.51 | 1848 | 3.52 |
| 1830 | 3.39 | 1850 | 3.13 |

So the safest long asset yielded about 5% in 1815, about 3.8% by 1818, and 3.0 to 3.5% through the 1830s and 1840s. A Spectator column of 23 January 1830 put 3% Consols near 93 (https://archive.spectator.co.uk/article/23rd-january-1830/2/the-money-market), consistent with about 3.2%.

## Continental bonds

- Prussia 1818: Rothschild's 5 million pound loan, first tranche issued at 70, a later 5% tranche at 84 (Rothschild Archive, https://www.rothschildarchive.org/collections/archivists_choice/march_2018_subscription_ledger_for_the_prussian_government_loan_1818). At 70, a 5% coupon is about 7.1% current yield; at 84, about 6.0%. These are my arithmetic, not stated in the source.
- France 1817: a 5% loan closed at 55, the state receiving 55 (OCR German source surfaced by search, unverified). **Uncertain.**
- Austrian 5% paper traded around 43-48 in 1817-18 (same search, unverified), implying double-digit yields. **Uncertain.**
- French rente, later Prussian and Austrian yields, Hamburg discount: no figures found. Homer and Sylla, A History of Interest Rates (Wiley, 4th ed. 2005) is the likely source, not opened. **Uncertain.**

## Frankfurt and German lending

- Prussia abolished remaining interest restrictions in 1811 (Fritz Blaich essay, Duncker & Humblot, https://elibrary.duncker-humblot.com/article/71530/download, snippet only, wording truncated), yet Prussian parliament debated usury limits in 1857-67 and another source says Prussia kept a rate cap for loans even after the general German commercial code (date not given in the source) freed merchant loans. Net: whether a legal maximum applied in 1815-1850 is **Uncertain**; no Bavarian, Hessian or Frankfurt caps found.
- Frankfurt discount rate (Privatdiskont): not found. **Uncertain.** Frankfurt's exchange was mainly a market for safe government bonds by 1850 (https://boerse-frankfurt.de/en/know-how/about/geschichte-der-frankfurter-wertpapierboerse/18th-and-19th-centuries-citizens-princes-new-stock-exchanges).
- Mortgages: a 19th-century journal passage mentions 5% as the customary rate and a mortgage rate of probably 4.5% (OCR damaged), and describes 1830-45 as rising prices and generally rising rates because of railway demand. **Uncertain.**

## Money and prices

British prices trended down from 1815 to the 1850s; convertibility, suspended 1797, was restored 1 May 1821 after Peel's Act of 1819; the small-note circulation fell from 7.4 million pounds in 1819 to 900,000 in 1822 (https://historyhome.co.uk/peel/economic/bullion.htm and https://victorianweb.org/history/bullion.html, via search summary). Gold/silver ratio and German price levels: not found. **Uncertain.**

## Are the game numbers plausible?

| Game value | Verdict |
|---|---|
| base_rate 5% | Plausible for 1815-1822 and roughly as the Bank's upper bound until 1839; high against Consols 3-3.5% for 1825-1850, so a base rate of about 4% fits 1823-1838 better. Frankfurt discount may be lower or higher (**Uncertain**). |
| borrower max rate 6% (good) | Plausible; matches 5% mortgage custom plus margin, and Prussian 1818 yield of 6.0%. |
| 10% (fair), 16% (poor) | Not verifiable. Plausible for risky borrowers; no source seen. Treat as design choices. |
| bond coupons 5-6% | 5% is documented as the nominal coupon for 1818 Prussian and French loans, but issue at discount (70-84) made yields 6-7%. A coupon of 3-4% for strong credit after 1825 would be closer to Consols. |

## For the game

- Put a per-year `base_rate` series in `data/tuning.json`: 5% to 1822, 4% to 1838, 5-6% around 1839, with spikes in crisis years (1825 and 1847 crises were not sourced, **Uncertain**).
- Make state bond yield = benchmark plus a sentiment/credit spread; use Consols as the floor (about 3.2%), Prussia roughly 4-6%, Austria higher.
- Issue price discount: represent the 1818 Prussian issue at 70 then 84 as a launch-price example.
- Usury cap as optional flag, off by default since evidence is unclear.

## Uncertain

- 4% cut in 1822 and the exact usury repeal year (1833 exemption, 1837, 1854 conflict).
- All French, Austrian, later Prussian yields; Hamburg and Frankfurt discount rates.
- German legal rate maxima by state; mortgage rates (4-5% only from damaged OCR).
- Gold-silver ratio and German inflation; the 1825 and 1847 rate spikes.
