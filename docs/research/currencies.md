# Currencies, bills and crises, 1815-1850

## Standards

| Currency | Standard | Source |
|---|---|---|
| Konventionstaler / Convention gulden (1753) | 20 gulden or 10 Speziesthaler from one Cologne mark of fine silver; thaler about 23.39 g fine, 2 gulden (Austria) | [Conventionsthaler](https://en.wikipedia.org/wiki/Conventionsthaler), [South German gulden](https://en.wikipedia.org/wiki/South_German_gulden) |
| South German gulden, 24-gulden foot | 24 gulden per Cologne mark fine; coins wore to an effective 24.5 | [Munich Coinage Treaty](https://en.wikipedia.org/wiki/Munich_Coinage_Treaty) |
| Munich Coin Treaty, 25 Aug 1837 | Bavaria, Wuerttemberg, Baden, Hesse-Darmstadt, Nassau, Frankfurt; 24.5 gulden per Cologne mark (233.855 g base), gulden = 60 Kreuzer, about 9.545 g silver | same |
| Prussian thaler (Graumann 1750) | 14 thaler per Cologne mark fine, 16.704 g; from 1821 Prussian coinage unified, 1 thaler = 30 Silbergroschen = 360 Pfennige | [Prussian thaler search summary](https://en.wikipedia.org/wiki/Prussian_thaler) |
| Dresden Convention, 30 Jul 1838 (ratified 7 Jan 1839) | Zollverein states choose thaler or gulden at 1 thaler = 1.75 gulden (gulden = 4/7 thaler); Vereinsmuenze 2 thaler = 3.5 gulden | [Dresden Coinage Convention](https://en.wikipedia.org/wiki/Dresden_Coinage_Convention) |
| French franc (7 Germinal an XI, 28 Mar 1803) | 5 g silver at 900 fine (about 4.5 g fine); 20-franc gold piece 6.45 g at 900; implied gold-silver ratio about 15.5 | search summary of [cgb.fr](https://www.cgbfr.com/5-francs-bonaparte-premier-consul-1803-paris-f-301-1-ttb,fmd_751602,a.html) and [napoleon.org](https://www.napoleon.org/en/history-of-the-two-empires/articles/a-history-of-the-franc-the-key-moments/); gold weight **Uncertain** |

Derived (my arithmetic from the 1.75 rate): 1 gulden = 0.571 thaler = 17.1 Silbergroschen; 1 thaler = 105 Kreuzer. Silver content: 9.545 g per gulden vs 16.704 g per thaler gives 1.75 (consistent).

Pound sterling and the gold standard: sources I opened disagree on timing (one search result says a gold standard dated from 1816, the Cash Payments Act of 1819 is commonly cited with resumption in 1821, but I did not verify either; **Uncertain**). The Bank's coin and bullion was about 10.72 million pounds in Dec 1824 and about 1.26 million by Dec 1825 ([Mises Wiki, Panic of 1825](https://wiki.mises.org/wiki/Panic_of_1825)); other sources give about 1.0 to 1.1 million at the low ([boerse.de](https://www.boerse.de/boersenwissen/boersengeschichte/Die-britisch-suedamerikanische-Krise-1825-1826-83), search summary).

Exchange rates pound vs franc vs gulden in 1815-50: not found (**Uncertain**). Bill rates must be a design table. Only the thaler-gulden rate (1.75) is solid from 1838.

## Bills of exchange

- Bills were quoted at sight and at fixed terms; a sight price differs from spot because of transport time and grace days (Norwegian and Swedish central bank studies, [norges-bank.no](https://www.norges-bank.no/globalassets/upload/hms/pdf/hmsi_chapter7.pdf?ft=.pdf), [riksbank.se](https://www.riksbank.se/globalassets/media/forskning/monetar-statistik/volym1/5.pdf), via search; Christiania, not Frankfurt). Between 1823 and 1844 the three-month bill was the most frequent quotation in Norway.
- Frankfurt exchange practice goes back to 1585 uniform rates set by fair merchants ([boerse-frankfurt.de](https://boerse-frankfurt.de/en/know-how/about/geschichte-der-frankfurter-wertpapierboerse/11th-to-17th-century-fairs-coins-letters-of-exchange)). Usance lengths and discount rates for Frankfurt 1815-50 were not found (**Uncertain**).

## Crises

| Crisis | Facts found | Source |
|---|---|---|
| 1825-26 | 70 banks failed (Wikipedia lead says 12 in Britain); bankruptcies nearly doubled in 1826; Bank reserve fell to about 1 million pounds; Banque de France gold helped; foreign loans stopped Dec 1825; Peru, Gran Colombia, Greece suspended 1826 | [Panic of 1825](https://en.wikipedia.org/wiki/Panic_of_1825), eefshp.org, Mises Wiki |
| 1836-37 | Bank of England reserves shrank by 1836; planned gradual Bank rate rise from 3% to 5%; cotton prices fell 25% in Feb-Mar 1837; US: 343 of 850 banks closed | [Panic of 1837](https://en.wikipedia.org/wiki/Panic_of_1837) (no German figures) |
| 1847-48 | Crisis began late Dec 1847; an old Frankfurt house failed (summary of SGVS paper); Schaaffhausen bank of Cologne in difficulty in 1848 (payment stop 29 Mar 1848 from a weak blog source), reorganized as joint stock 3 Jun 1848, confirmed 28 Aug 1848; Banque de France governor feared collapse 15 Mar 1848 | [Schaaffhausen](https://en.wikipedia.org/wiki/A._Schaaffhausen%27scher_Bankverein), [sgvs.ch](https://www.sgvs.ch/papers/sjesBackIssues/1905_PDF/1905-I-I-2.pdf), Darden case (search) |

German railway share boom 1842-48 article ([boerse.de](https://www.boerse.de/boersenwissen/boersengeschichte/Die-Eisenbahnaktien-Hausse-in-Deutschland-1842-1848-80)) could not be fetched (403); no figures taken.

## For the game

- Unit: Frankfurt gulden (fl) = 60 Kreuzer. Fixed rate `thalerPerGulden = 4/7` from 1839; before 1838 use a slight random spread (design choice).
- Tradable FX pairs: GBP, FRF, thaler with a small noise band; shocks of 5 to 10% in crisis quarters (design assumption, not sourced).
- Crisis events: Q4 1825 (credit stops, loan defaults follow 1826-28), 1836-37 (rate rise, American bills), Q4 1847 to Q2 1848 (bank runs, forced sales).
- Bills: 3-month usance as the default term; discount rate as a tuning value; rate spikes in crisis quarters.

## Uncertain

- Sterling gold standard dates (1816 vs 1819 vs 1821).
- Gold content of the franc, gulden/pound/franc rates 1815-50.
- Bill usances and Frankfurt discount rates.
- Konventionstaler and 24-gulden details: the Wikipedia pages give some details, a 20-gulden Konventionsfuss page was not opened directly.
- 1836-37 British figures; Schaaffhausen payment-stop date.
- 1847-48 Frankfurt details.
