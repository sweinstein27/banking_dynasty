# Politics and war, Frankfurt 1815-1850

Research notes for the Banking Dynasty sim. Only facts seen in the cited pages are stated; gaps are marked **Uncertain** and collected at the end.

## 1. The Free City constitution

Frankfurt became a Free City of the German Confederation after 1815. Its Constitutional Supplement Act (Konstitutionsergaenzungsakte) was approved by a citizen vote on 18 July 1816 (about 2,700 for, 47 against, of about 5,000 eligible voters) and sworn on the Roemerberg on 18 October 1816 (German Wikipedia, "Konstitutionsergaenzungsakte", https://de.wikipedia.org/wiki/Konstitutionsergänzungsakte).

| Body | Facts (same source) |
|---|---|
| Senate | 42 members in three benches of 14 (the Schoeffen bench included the four city syndics) |
| Aelterer Buergermeister | Presided over the Senate, foreign relations and military; always from the Schoeffen bench |
| Juengerer Buergermeister | From the Senators' bench; police, guilds, citizenship; deputized for the elder |
| Gesetzgebender Koerper (Legislative Assembly) | 85 members: 20 appointed by the Senate (until 1856), 20 by the Permanent Citizen Representation, 45 chosen by electors; elected yearly, sat about six weeks |
| Staendige Buergerrepraesentation | 51 members; audited city finances |
| Franchise | Citizenship needed at least 5,000 gulden in property; those under 30, bankrupts who had not repaid creditors, and others were barred from office |

The 5,000 gulden threshold also appears in the English Wikipedia article on the Free City (https://en.wikipedia.org/wiki/Free_City_of_Frankfurt), which dates a later 1866 voting reform.

## 2. Jewish emancipation fight

- 1811: the Grand Duchy of Frankfurt granted Jews legal equality; it was reversed on the grand duchy's dissolution in 1815 (https://en.wikipedia.org/wiki/Jewish_emancipation, footnote summary).
- 1816 act, article 7: Jews stayed state subjects with limited civil rights (German Wikipedia above).
- 8-12 August 1819: anti-Jewish Hep-Hep riots in Frankfurt (https://de.wikipedia.org/wiki/Geschichte_der_Stadt_Frankfurt_am_Main).
- 1824: civil rights restored with a limit on Jewish marriages per year; the Rothschilds used the new opportunities (same German Wikipedia history page). The number of marriages allowed is **Uncertain** (not seen).
- 3 March 1848: Senate granted all rights except full emancipation; 1864: full civil rights (English Wikipedia, Free City of Frankfurt).
- Senate seats: the sources seen do not say when Jews could sit in the Senate. **Uncertain.**

## 3. Bankers

The Rothschild house was Frankfurt's most important bank and Bethmann the only Christian-owned house of comparable rank; both dominated bond trading (English Wikipedia, Free City of Frankfurt). Mayer Amschel Rothschild (1744-1812) was court factor to the Landgraves of Hesse-Kassel; Amschel Mayer Rothschild (1773-1855) headed the Frankfurt branch; Emperor Francis I ennobled four sons in 1816 and all five became Austrian Freiherren on 29 September 1822. In 1815 alone the Rothschilds provided 9.8 million pounds in subsidy loans to Britain's continental allies (https://en.wikipedia.org/wiki/Rothschild_family). Bethmann and Rothschild led the 1835 consortium behind the Taunus railway (see technology.md). The wider Hofbankier (court banker) system beyond Hesse-Kassel was not documented in my sources. **Uncertain.**

## 4. German Confederation and repression

- The Federal Diet (Bundestag) sat in the Palais Thurn und Taxis from 5 November 1816 (English Wikipedia, Free City of Frankfurt).
- Carlsbad Decrees: adopted by the Diet on 20 September 1819 after Kotzebue's murder (23 March 1819); university supervision, press censorship, a Mainz investigation commission; repealed 2 April 1848 (https://en.wikipedia.org/wiki/Carlsbad_Decrees).
- 3 April 1833 Wachensturm: about 50 students attacked the Hauptwache and Konstablerwache hoping to seize the Confederation's treasury; betrayed and crushed; afterwards about 2,500 Austrian and Prussian soldiers were stationed in the city (https://en.wikipedia.org/wiki/Frankfurter_Wachensturm and the Free City page). A federal execution (Bundesexekution) against Frankfurt is listed for 1834 (https://en.wikipedia.org/wiki/Bundesexekution). Other executions: Brunswick 1830, Holstein 1863, Prussia 1866.
- 1832: Sandhof festival near Frankfurt, about 4,000 people (German Wikipedia history page).

## 5. Wars and revolutions

| Date | Event | Source |
|---|---|---|
| 18 Jun 1815 | Waterloo | https://en.wikipedia.org/wiki/Battle_of_Waterloo |
| Feb/Mar 1821 | Greek revolt begins (17 Mar in the Peloponnese); London Protocol Feb 1830 recognized independence; Otto of Bavaria king 1832 | https://en.wikipedia.org/wiki/Greek_War_of_Independence |
| 26-29 Jul 1830 | July Revolution; Charles X abdicated 2 Aug | https://en.wikipedia.org/wiki/July_Revolution |
| 25 Aug 1830 | Belgian revolt begins; independence declared 4 Oct 1830; Dutch invasion 2 Aug 1831; Treaty of London 19 Apr 1839 | https://en.wikipedia.org/wiki/Belgian_Revolution |
| 23 Mar 1848 | First Italian War (Austro-Sardinian) begins; Custoza 22-27 Jul; Salasco armistice 9 Aug; Novara 23 Mar 1849; war over 22 Aug 1849 | https://en.wikipedia.org/wiki/First_Italian_War_of_Independence |
| 24 Mar 1848 | First Schleswig War begins; Malmoe armistice 26 Aug 1848; London Protocol 8 May 1852 | https://en.wikipedia.org/wiki/First_Schleswig_War |
| 9 Mar 1848 | Black-red-gold flag over Thurn und Taxis; pre-parliament in Paulskirche 31 Mar | Free City page |
| 18 May 1848 | Frankfurt National Assembly opens in the Paulskirche | https://en.wikipedia.org/wiki/Frankfurt_Parliament |
| 29 Jun / 12 Jul 1848 | Archduke John elected Regent; Diet transfers authority | same |
| 16-18 Sep 1848 | Assembly accepts Malmoe armistice; September riots, deputies Lichnowsky and Auerswald murdered; Prussian and Austrian troops from Mainz restore order within two weeks | same |
| 9 Nov 1848 | Robert Blum executed | same |
| Apr-30 May 1849 | Larger states reject the constitution; session ends 30 May (German Wikipedia gives 31 May); rump moves to Stuttgart in June | same, and German Wikipedia history page |
| 1866 | For context: Prussia occupies Frankfurt 16 Jul, annexes 20 Sep | Free City page |

Note: the 1848-51 Hesse crisis and any Bundesexekution in 1850 were not found; **Uncertain.** The Greek loans and bond crash of the 1820s were not confirmed either.

## For the game

- Event table keyed by turn (quarter): put the dates above in `data/events.json` with a `year`/`quarter` and a market effect tag (war, revolution, repression).
- Political risk by era: Vormaerz (1816-1847) stable and censored; 1830 Q3 and 1833 Q2 minor shocks; 1848 Q1 to 1849 Q2 high volatility, with 1848 Q3 (September riots) a local street-violence event.
- Senate and franchise: a "citizen standing" gate (5,000 gulden) for civic offices; a Jewish-family variant with restrictions until 1848 and full rights in 1864, beyond the game end.
- Marry and ennoble hooks: Austrian baron title 1822 as a historical anchor for the Rothschild NPC house.
- Do not state the Hofbankier mechanics as fact until sourced.

## Uncertain

- Number of Jewish marriages allowed per year after 1824 (not seen).
- When Jews could sit in the Senate; Hofbankier system beyond Hesse-Kassel.
- Whether any 1848-51 federal executions affected Frankfurt; Greek loan crash details.
- End date of the Paulskirche session (30 vs 31 May 1849, sources differ).
