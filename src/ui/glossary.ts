// The explanation cards behind underlined terms. Each card's text can link to another card with
// [[id]] (the card's own title) or [[id|words]]. Numbers come from tuning, so a card never
// disagrees with the game. tests/ui-glossary.test.ts checks that every link leads to a card.
import { fl } from "../sim/format";
import type { GameData } from "../sim/tuning";

export interface GlossaryCard {
  title: string;
  body: (data: GameData) => string;
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

export const GLOSSARY: Record<string, GlossaryCard> = {
  cash: {
    title: "Cash",
    body: () =>
      "Gulden in the strongroom. Every loan, bond and venture is paid from cash, and so is every depositor who asks for money back. Spending cannot take cash below the [[reserve]]; [[withdrawals]] can. If cash runs out, assets go in a [[forced_sale]].",
  },
  reserve: {
    title: "Reserve",
    body: () =>
      "Cash you keep back for depositors. Loans, bonds and ventures cannot spend below it, so it is what stands between the house and a [[forced_sale]] when a [[panic]] brings [[withdrawals]]. Set it at the Desk.",
  },
  free_cash: {
    title: "Free cash",
    body: () => "Cash above the [[reserve]]: what loans, bonds, ventures and the family can spend this quarter.",
  },
  net_worth: {
    title: "Net worth",
    body: () =>
      "[[cash|Cash]] plus [[loans]], [[bonds]] and [[ventures]], less [[deposits]] and [[borrowings]] owed. It is the score: the house's net worth at the end of 1850 is how the run is judged. It is recorded at every [[year_end]].",
  },
  loans: {
    title: "Loans to merchants",
    body: (d) => {
      const k = d.tuning.loans.kinds;
      return `Merchants ask for three kinds of loan: [[bill|bills of exchange]] for ${k.bill.term[0]} to ${k.bill.term[1]} quarters, commercial credit for ${k.commercial.term[0]} to ${k.commercial.term[1]} quarters, and [[mortgage|mortgages]] for ${k.mortgage.term[0] / 4} to ${k.mortgage.term[1] / 4} years. Each pays interest every quarter. A loan counts at its principal until it is repaid, sold ([[sell_loan]]), or it [[default|defaults]]. You never see a borrower's true soundness: read their [[books]].`;
    },
  },
  bill: {
    title: "Bills of exchange",
    body: () => "Short credit, a quarter or two, for a merchant's goods on the road. Small, frequent and a little cheaper than other loans.",
  },
  mortgage: {
    title: "Mortgages",
    body: (d) => `Long credit secured on a borrower's property: never more than ${pct(d.tuning.loans.mortgage_cover)} of their collateral. Repaid in equal parts each quarter. Less likely to default, and on a default the collateral brings back up to ${pct(d.tuning.loans.kinds.mortgage.recovery)} of what is owed.`,
  },
  books: {
    title: "A borrower's books",
    body: () => "Every merchant keeps books: turnover, profit, debts owed to others, collateral, and a record of late payments. You never see a score or a verdict. Free [[talk]] on the bourse gives a hint; a [[report]] shows the books as the merchant keeps them; an [[inquiry]] finds the truth beneath. Weak houses flatter their books, so read with care.",
  },
  talk: {
    title: "Bourse talk",
    body: () => "What the bourse says of a merchant this quarter: free, but sometimes wrong. The head's [[prudence]] makes it more often right.",
  },
  estimate: {
    title: "Reading a borrower",
    body: () => "There is no estimate of quality: read their [[books]].",
  },
  report: {
    title: "A correspondent's report",
    body: (d) => `For ${fl(d.credit.info.report_cost)}, a correspondent sends the borrower's books as kept: turnover, profit, debts and late payments. It is a snapshot, worth buying again after ${d.credit.info.stale_quarters} quarters. Uses a correspondent's time ([[actions|capacity]]).`,
  },
  inquiry: {
    title: "A full inquiry",
    body: (d) => `For ${fl(d.credit.info.inquiry_cost)}, everything a report shows, plus the borrower's collateral, their true profit, and your partner's private remarks.`,
  },
  sell_loan: {
    title: "Selling a loan",
    body: () => "Another house will buy a loan from you for less than it is owed: the discount grows with the market's doubts about the borrower, the years left and the market's mood. The buyer prices on the market's view, not the truth, so a loan you know to be weak can be worth selling.",
  },
  default: {
    title: "Default",
    body: (d) =>
      `A borrower or a state that cannot pay. The loan or bond is lost. The chance rises with the [[market_mood]]: in a fair market it is the base rate, uneasy ${d.tuning.sentiment_multiplier.uneasy} times that, in a panic ${d.tuning.sentiment_multiplier.panic} times.`,
  },
  bonds: {
    title: "State bonds",
    body: () =>
      "Loans to states, bought at a price per gulden of face value and paying a coupon each quarter. They count at today's price, which falls when the [[market_mood]] sours and the state looks risky. A state may [[default]]. Each state sells only to a house whose [[reputation]] clears its [[bond_gate|gate]].",
  },
  bond_gate: {
    title: "A state's reputation gate",
    body: (d) =>
      `The [[reputation]] a state asks of a house before it sells you its bonds. The head's [[connections]] lower every gate by ${d.tuning.family.connections_step} for each point above ${d.tuning.family.neutral_stat}.`,
  },
  ventures: {
    title: "Ventures",
    body: (d) =>
      `Mills, shipping lines and later railways, built over years. You commit a sum and it is called in [[calls|instalments]]; a build may [[overrun]]. Short ventures pay out when built. Medium and great ones then run and earn, great works opening in [[sections]], and a venture that earns well [[listing|lists on the bourse]]. An unlisted stake can be sold privately for ${pct(1 - d.tuning.ventures.unlisted_discount)} of what was paid in. The head's [[acumen]] makes failure less likely; a stormy [[market_mood]] makes it more likely.`,
  },
  deposits: {
    title: "Deposits",
    body: (d) =>
      `Money depositors keep with the house, owed back on demand. In a fair market they move ${pct(d.tuning.deposits.catch_up)} of the way each quarter toward ${fl(d.tuning.deposits.per_reputation)} for each point of [[reputation]]. They earn [[deposit_interest]], and an uneasy or panicking market brings [[withdrawals]].`,
  },
  deposit_interest: {
    title: "Interest to depositors",
    body: (d) =>
      `Depositors earn ${pct(d.tuning.deposits.interest_rate)} a year, credited each quarter. It is added to what the house owes them, not paid in cash, so it lowers [[net_worth]] without touching [[cash]].`,
  },
  withdrawals: {
    title: "Withdrawals",
    body: (d) =>
      `Each quarter depositors ask for a share of their [[deposits]]: ${pct(d.tuning.sentiment.withdrawal_share.calm)} in a fair market, ${pct(d.tuning.sentiment.withdrawal_share.uneasy)} uneasy, ${pct(d.tuning.sentiment.withdrawal_share.panic)} in a [[panic]]. A [[reputation]] above ${d.tuning.sentiment.reputation_withdrawals.neutral} lowers that, one below raises it. They are paid from [[cash]], even below the [[reserve]]; what cash cannot cover forces a [[forced_sale]]. [[crisis|Crisis measures]] can slow them.`,
  },
  forced_sale: {
    title: "Forced sale",
    body: (d) =>
      `When cash cannot meet what is owed, loans, bonds and ventures are sold at a discount: loans lose ${pct(d.tuning.forced_sale.loan_discount)}, bonds ${pct(d.tuning.forced_sale.bond_discount)} off their price, ventures ${pct(d.tuning.forced_sale.venture_discount)} of their cost. If even that is not enough, the house is [[bankruptcy|bankrupt]].`,
  },
  bankruptcy: {
    title: "Bankruptcy",
    body: () => "The house cannot pay its depositors even after a [[forced_sale]] of everything it holds. The run ends there, and the chronicle is written.",
  },
  borrowings: {
    title: "Borrowings",
    body: (d) =>
      `Money borrowed from other houses in a crisis. Interest is paid each quarter and the whole sum falls due after ${d.tuning.crisis.lending.term_quarters} quarters. A house lends only if its [[opinion]] of yours is good enough.`,
  },
  upkeep: {
    title: "Upkeep a quarter",
    body: () =>
      "What the house's obligations cost each quarter at today's balances: [[deposit_interest]] and interest on [[borrowings]]. It also includes the wages and the upkeep of the rooms of the [[counting_house]].",
  },
  counting_house: {
    title: "The counting house",
    body: () => "The house's staff and rooms: clerks, correspondents, analysts, tellers and perhaps a partner, in a counting room with a strongroom, an archive, a courier stable, reception rooms or a warehouse. Staff draw wages and rooms cost upkeep each quarter. Together they set the house's [[actions|capacity]].",
  },
  actions: {
    title: "Capacity",
    body: (d) => `How much the house can do in a quarter. There is no fixed number of actions: each kind of work draws on a pool. Each clerk writes up ${d.tuning.capacity.per_clerk} deal a quarter (loans, bonds, ventures, calling a loan in); each correspondent ${d.tuning.capacity.per_correspondent} reports; each analyst ${d.tuning.capacity.per_analyst} opinions. The head's own time (${d.tuning.capacity.head} a quarter, ${d.tuning.capacity.partner} more with a partner) goes on courting, marriages, the family and borrowing, and covers deals and reports when the staff are busy. Changing the reserve, naming an heir, answering [[letters]] and hiring use none.`,
  },
  reputation: {
    title: "Reputation",
    body: () =>
      "The house's good name, from 0 to 100. It sets the level of [[deposits]] the house draws, how hard depositors pull out in a [[panic]] ([[withdrawals]]), and which states will sell you [[bonds]]. Charity, patronage and some [[letters]] raise it; [[crisis|crisis measures]], a new head (most of all an untrained [[heir]]), some letters and events, and an ally's failure ([[alliance]]) lower it.",
  },
  market_mood: {
    title: "The market's mood",
    body: (d) =>
      `Fair (calm), changeable (uneasy) or stormy (panic). It scales every risk: the chance of a [[default]] is ${d.tuning.sentiment_multiplier.uneasy} times higher uneasy and ${d.tuning.sentiment_multiplier.panic} times in a panic; it sets [[withdrawals]] and the price of [[bonds]]. A [[panic]] comes with warning.`,
  },
  panic: {
    title: "Panic",
    body: (d) =>
      `The stormiest mood. Before one breaks, the Gazette carries warning signs for ${d.tuning.sentiment.panic_warning_quarters.min} to ${d.tuning.sentiment.panic_warning_quarters.max} quarters: time to raise the [[reserve]]. In a panic depositors withdraw heavily and [[crisis|crisis measures]] open.`,
  },
  crisis: {
    title: "Crisis measures",
    body: (d) =>
      `Open while the market is uneasy, panicking or under warning: borrow from another house ([[borrowings]]), pay depositors ${pct(d.tuning.crisis.pay_slowly.share)} of what they ask (costs ${d.tuning.crisis.pay_slowly.reputation_cost} [[reputation]]), suspend withdrawals for a quarter (costs ${d.tuning.crisis.suspend.reputation_cost}), or call a loan in early for ${pct(d.tuning.crisis.call_loan.recovery)} of it.`,
  },
  base_rate: {
    title: "Base interest rate",
    body: () => "The going rate for money on the bourse. It drifts slowly, and events can jolt it.",
  },
  quarter: {
    title: "The quarter",
    body: () => "Each turn is a quarter of a year. Read the Gazette, check the Ledger, give your orders at the Desk, answer the [[letters]], then end the quarter: interest, defaults and withdrawals are settled and the news is written. Every fourth quarter brings the [[year_end]].",
  },
  year_end: {
    title: "Year end",
    body: () => "After the autumn quarter: everyone ages, the old may die and an heir succeed ([[heir]]), children may be born, and the year's [[net_worth]] and [[reputation]] are written into the books for the chart and the chronicle.",
  },
  letters: {
    title: "Letters",
    body: () => "Some events ask for an answer. Each response shows its cost, what it does and its odds in words. Certain costs show in the books at once; chances are settled when the quarter ends. The quarter cannot end until every letter is answered. Answering uses no [[actions]].",
  },
  heir: {
    title: "The heir",
    body: (d) =>
      `Who takes over when the head dies: the heir you name, or else the best [[trained]] heir. Passing over the eldest costs ${d.tuning.family.succession.passed_over_reputation} [[reputation]]; an untrained heir costs ${d.tuning.family.succession.reputation_untrained}, a trained one ${d.tuning.family.succession.reputation_trained}.`,
  },
  trained: {
    title: "Trained",
    body: (d) =>
      `An heir aged ${d.tuning.family.succession.adult_age} or more whose [[acumen]], [[prudence]] and [[connections]] add up to at least ${d.tuning.family.succession.trained_total}. An untrained [[heir]] who takes over counts ${d.tuning.family.succession.inexperience_penalty} lower in every stat for ${d.tuning.family.succession.inexperience_quarters} quarters.`,
  },
  traits: {
    title: "Traits",
    body: () => "Each person has one or two traits that change real numbers in the game. The head's traits act on the business now; an [[heir]]'s act once they take over. Open a person's sheet in the Family to see what each does.",
  },
  acumen: {
    title: "Acumen",
    body: (d) => `The head's head for business: each point above ${d.tuning.family.neutral_stat} cuts the failure risk of [[ventures]] by ${pct(d.tuning.family.acumen_step)}.`,
  },
  prudence: {
    title: "Prudence",
    body: (d) => `The head's eye for a bad borrower: each point makes [[talk|bourse talk]] about ${pct(d.credit.info.talk.per_prudence)} more often right.`,
  },
  connections: {
    title: "Connections",
    body: (d) => `The head's friends at court: each point above ${d.tuning.family.neutral_stat} lowers every state's [[bond_gate|reputation gate]] by ${d.tuning.family.connections_step}.`,
  },
  opinion: {
    title: "Opinion",
    body: (d) =>
      `What another house thinks of yours, from ${d.tuning.houses.opinion.min} to ${d.tuning.houses.opinion.max}. It decides whether it will lend in a crisis ([[borrowings]]) and whether it will agree to a marriage ([[alliance]]). Courting raises it by ${d.tuning.houses.court.opinion} for ${fl(d.tuning.houses.court.cost)}; left alone it drifts back to the house's own leaning.`,
  },
  alliance: {
    title: "Alliance by marriage",
    body: (d) =>
      `A marriage ties two houses. An ally's rumours spare you, but if an ally fails your [[reputation]] falls by ${d.tuning.family.marriage.ally_failure_reputation}. Children need a married couple.`,
  },
  payment_record: {
    title: "Payment record",
    body: (d) => `How often the borrower paid other lenders late, as far back as the house's records reach: ${d.counting.effects.record_quarters} quarters, or ${d.counting.effects.archive_record_quarters} with an [[archive]].`,
  },
  collateral: {
    title: "Collateral",
    body: () => "Property and goods the borrower could pledge. Only a full [[inquiry]] finds it. A [[mortgage]] is secured on it.",
  },
  analyst_opinion: {
    title: "An analyst's opinion",
    body: (d) => {
      const a = d.counting.analysts;
      return `An analyst reads a borrower's [[books]] and writes one word: sound, doubtful or unsound. A middling analyst is right about ${pct(a.base_accuracy + a.per_skill * 5)} of the time; skill and [[staff_trait|trait]] change that, between ${pct(a.min_accuracy)} and ${pct(a.max_accuracy)}. Each analyst writes ${d.tuning.capacity.per_analyst} a quarter, only on merchants asking for a loan.`;
    },
  },
  desks: {
    title: "Desks",
    body: (d) => `Clerks, correspondents, analysts and tellers each need a desk in the counting room: ${d.counting.rooms.map((r) => `${r.desks} in the ${r.name.toLowerCase()}`).join(", ")}. A partner needs none. Enlarging the room takes a quarter.`,
  },
  staff_skill: {
    title: "Skill",
    body: (d) => `How good a member of staff is, from ${d.counting.skill.min} to ${d.counting.skill.cap}. New hires come with ${d.counting.skill.min} to ${d.counting.skill.max}; skill rises a point for every ${d.counting.skill.quarters_per_point} quarters served. It makes an [[analyst_opinion|analyst]] right more often and an advisor's letters truer ([[council]]).`,
  },
  staff_trait: {
    title: "Staff traits",
    body: (d) => d.counting.traits.map((t) => `${t.name}: ${t.description}`).join(" "),
  },
  hiring: {
    title: "Hiring and dismissing",
    body: (d) => `Each quarter brings ${d.counting.candidates_per_role} candidates for each post. A hire starts work, and is paid, from next quarter; a dismissed member works out this quarter. Neither uses any [[actions|capacity]]. Wages: ${Object.values(d.counting.roles).map((r) => `${r.name.toLowerCase()} ${fl(r.wage)}`).join(", ")} a quarter.`,
  },
  council: {
    title: "The advisor council",
    body: () => "The chief clerk (the longest serving clerk) watches the house's cash, the head correspondent the bourse abroad, and the head's spouse the heir. Each writes when they see trouble, and sometimes when there is none: [[staff_skill|skill]] makes them truer, and a careful advisor cries wolf where a sanguine one stays calm ([[staff_trait|traits]]).",
  },
  archive: {
    title: "Archive",
    body: (d) => `Shelves of old ledgers: a borrower's [[payment_record]] reaches back ${d.counting.effects.archive_record_quarters} quarters instead of ${d.counting.effects.record_quarters}.`,
  },
  warehouse: {
    title: "Warehouse",
    body: (d) => `Goods need somewhere to lie. Without a warehouse the house can hold none; with one it stores ${d.counting.effects.warehouse_space * d.markets.warehouse.units_per_lot} units of space. Grain and colonial wares take 1 unit each, cloth and iron 2, wine 3. Upkeep is the building's; [[storage]] is charged on top for each unit held.`,
  },
  shares: {
    title: "Shares",
    body: (d) => `Part-ownership of a company on the Frankfurt bourse. The price moves toward what investors will pay for its [[dividend]] in today's [[market_mood|mood]], plus news and chance. Each trade pays a broker's [[commission]] of ${pct(d.markets.commission.shares)}. Shares count at their last price; a company can fail.`,
  },
  dividend: {
    title: "Dividend",
    body: () => "Paid once a year, at the year end, from the last four quarters' earnings. The yield is the dividend as a share of today's price.",
  },
  earnings_estimate: {
    title: "Earnings estimate",
    body: (d) => `What the house believes a company earned over the last year: a range around the truth. ${d.markets.reports.map((r) => `${r.name[0]!.toUpperCase() + r.name.slice(1)} puts it within ${pct(r.width)} either way${r.cost ? ` for ${fl(r.cost)}, good for ${r.quarters} quarters` : ", free"}`).join(". ")}.`,
  },
  commission: {
    title: "Commission",
    body: (d) => `The broker's cut on every trade: ${pct(d.markets.commission.shares)} on shares, ${pct(d.markets.commission.commodities)} on goods. It is added to what a purchase costs and taken from what a sale raises.`,
  },
  goods: {
    title: "Goods",
    body: () => "Grain, wine, cloth, iron and colonial wares, bought and sold at Frankfurt. Prices drift toward a target set by the [[harvest]], the fairs and the news, so the trend shows which way the target lies. Goods need a [[warehouse]] and cost [[storage]].",
  },
  storage: {
    title: "Storage and spoilage",
    body: () => "Each unit held costs handling and insurance every quarter, paid from cash. Grain rots and wine leaks: a share of them is lost each quarter.",
  },
  harvest: {
    title: "The harvest",
    body: () => "Each summer the harvest is gathered in three regions, from failed to a bumper crop. A poor harvest lifts the price of grain and wine and makes grain dealers, wine importers and river freight more likely to [[default]] ([[trade_risk]]).",
  },
  trade_risk: {
    title: "Harvest and borrowers",
    body: (d) => `A borrower in a trade that lives on the harvest is more likely to [[default]] after a bad one, and less after a good one, by up to ${d.markets.trade_factor_cap} times.`,
  },
  calls: {
    title: "Calls",
    body: () => "A venture's money is called in instalments: the first when you commit, then one every few quarters until the build is done. Each call is paid from cash; if one cannot be paid the house forfeits part of its stake.",
  },
  overrun: {
    title: "Overruns",
    body: () => "Builds rarely keep to plan. At each call a venture may overrun: the sum committed grows and more calls are added, so the build takes longer.",
  },
  sections: {
    title: "Sections",
    body: () => "A great work (a canal or a trunk railway) opens a section at a time as it is built, and each open section earns before the whole is done.",
  },
  listing: {
    title: "Listing",
    body: (d) => `A medium or great venture that has run for a while and earned at least ${pct(d.tuning.ventures.float.min_yield)} a year on its stake floats on the bourse: the stake becomes [[shares]] of ${fl(d.tuning.ventures.float.par)} each, which can be sold at the bourse price instead of privately at a discount.`,
  },
  // ---------------------------------------------------------------- wave 2's systems
  high_finance: {
    title: "High finance",
    body: () =>
      "Business beyond merchants' loans: placing a [[state_loan]], [[house_credit|lending to other houses]], buying at [[auction]], and [[insurance|insuring]] ships and warehouses. Each takes a clerk's time, like any deal.",
  },
  state_loan: {
    title: "State loans",
    body: (d) => {
      const c = d.finance.contracts;
      return `A state announces a loan a quarter before it takes bids. Houses bid the [[commission]] they ask; the state takes the lowest, but counts a better [[reputation|name]] as worth ${pct(c.prestige_weight)} of commission for every 100 points above 50. The winner pays [[caution_money]], [[placement|places]] the bonds with investors over ${c.placement.quarters} quarters, and buys what is left at the close: a firm contract. Those bonds are redeemed at par when the term ends.`;
    },
  },
  caution_money: {
    title: "Caution money",
    body: (d) => `${pct(d.finance.contracts.caution)} of a state loan, paid to the state at the award as a pledge, and returned when placing ends. If the state defaults first, it is lost. It must come from [[free_cash]].`,
  },
  placement: {
    title: "Placing a loan",
    body: (d) => {
      const p = d.finance.contracts.placement;
      return `Each quarter investors take a share of the bonds still unplaced, at the issue price, and the house keeps its [[commission]] on what they take. The share is larger in a calm [[market_mood|market]], for a house of good [[reputation]], for a safer state, and with each correspondent (${pct(p.per_correspondent)} each), up to ${pct(p.max)}. A loan well placed raises the house's name; one that sticks lowers it.`;
    },
  },
  house_credit: {
    title: "Credit to houses",
    body: (d) => {
      const h = d.finance.house_loans;
      return `In an uneasy or panicking market a Frankfurt house in trouble may ask, quietly, for a year's credit. Ask no more than ${pct(h.gratitude[0]!.up_to)} and it is grateful (opinion +${h.gratitude[0]!.opinion}); ask near its limit and it resents it. While it owes the house it is less likely to fail in a [[panic]]. If it fails anyway, its estate pays back only part.`;
    },
  },
  auction: {
    title: "Auctions",
    body: (d) => `When a house fails, or a borrower defaults on a secured loan, the receivers sell its warehouse, ships, broker's place or shares the next quarter. Bid a share of the appraisal; the highest bid wins, a tie goes to you. Bought assets count at their [[appraisal]], earn rent, freight or brokerage, and may be lost to fire or the river. Sold privately they fetch ${pct(d.finance.auctions.sale_discount)} less than the appraisal.`,
  },
  appraisal: {
    title: "Appraisal",
    body: () => "What the receivers value a lot at. An asset the house owns counts at its appraisal in [[net_worth]].",
  },
  insurance: {
    title: "Insurance",
    body: (d) => {
      const i = d.finance.insurance;
      return `Merchants ask for cover on a voyage or on a warehouse for a year. Take a line (${i.lines.map(pct).join(", ")} of the value): the premium comes in at once, and if the ship is lost or the warehouse burns, the house pays its share, less any salvage. Ships are lost more often in winter, and far more in a great storm. [[exposure|Exposure]] is what the house would pay if all were lost.`;
    },
  },
  exposure: {
    title: "Exposure",
    body: () => "The house's share of the value of every ship and warehouse it insures now: the most it could have to pay.",
  },
  loyalty: {
    title: "Loyalty",
    body: (d) => {
      const l = d.people.loyalty;
      return `How much each member of the family (and the head's spouse) holds to the house, 0 to 100. Loyal at ${l.loyal} or more, disloyal at ${l.disloyal} or less. Granting what they ask raises it by ${l.grant}; refusing lowers it by ${l.refuse}; it drifts toward ${l.drift_to} each year. A loyal heir passed over accepts it; a disloyal one may lay a [[claim]] or leave to found a house of their own.`;
    },
  },
  family_letter: {
    title: "Family letters",
    body: () => "Members of the family write with requests, threats to leave, [[claim|claims]] and terms to end a [[feud]]. Answer by End Turn; a letter left unanswered takes the answer marked as the default. Answers cost no one's time, except a match, which takes the head's.",
  },
  claim: {
    title: "Claims",
    body: (d) => {
      const c = d.people.claims;
      return `After a succession, a passed-over or disloyal member may claim a share of the house: up to ${pct(c.share)} of it, at most ${fl(c.max)}. Pay it, go to law (${fl(c.law_cost)}, and a ${pct(c.law_win)} chance the court finds for the house), or refuse and start a [[feud]].`;
    },
  },
  feud: {
    title: "Feuds",
    body: (d) => `A refused claimant feuds with the head: the house loses ${d.people.feuds.reputation_per_quarter} [[reputation]] a quarter while it lasts. It ends with that head, after ${d.people.feuds.max_quarters} quarters, or when the house accepts the claimant's terms.`,
  },
  study: {
    title: "Education",
    body: () => "Send an heir of the right age away to study: university, an apprenticeship abroad, a commission, or a desk in the counting house. It is paid at once and takes the head's time; the heir comes back later with better stats, maybe a [[traits|trait]], and sometimes a friend in another house. Each path is taken once.",
  },
  news_delay: {
    title: "News delay",
    body: (d) => `News from abroad comes by the post: the days along the shortest road to Frankfurt, halved by a courier stable, cut by ${pct(1 - d.europe.delay.branch)} from a city where the house has a [[branch]], and by each correspondent. A city's dispatch is written on a random day of the quarter; if it cannot arrive before the quarter ends, Frankfurt hears a quarter late. The map shows each city as last heard, not as it is.`,
  },
  branch: {
    title: "Branches",
    body: (d) => {
      const b = d.europe.branch;
      return `A branch abroad is run by a member of the family. It takes deposits, lends at the local rate, trades bills and pays its upkeep in the city's currency; its book is counted in gulden at the Frankfurt [[exchange_quote|quote]]. It needs at least ${fl(b.min_capital)} of capital. War, unrest or panic in its city may force it shut at a loss; a prudent head makes that less likely. Without a head it earns less and loses more.`;
    },
  },
  bill_on_city: {
    title: "Bills on a city",
    body: (d) => `A 3-month bill of exchange payable in another city, bought at a discount (a quarter of the city's rate plus ${pct(d.europe.bills.spread)}) and paid home at the Frankfurt [[exchange_quote|quote]] when due. If the payer fails, only ${pct(d.europe.bills.recovery)} comes back. The house may hold ${fl(d.europe.bills.limit)} of bills on any one city, plus its branch's book there.`,
  },
  exchange_quote: {
    title: "The Frankfurt quote",
    body: () => "Gulden for one unit of a foreign currency on the Frankfurt exchange: its par (metal content), the day's deviation, which every post carries, and any shock from trouble in the city, as far as news of it has reached Frankfurt.",
  },
  adoption: {
    title: "Adoption",
    body: () => "How far a technology has spread, 0 to 100%, on a dated curve, plus a push from the house's own [[ventures]] of that kind once it has arrived. Adoption moves sector earnings: railways lift industry and hurt canals; steam lifts shipping.",
  },
  tech_stage: {
    title: "Stages",
    body: () => "Dated steps in a technology's arrival. Some open new kinds of venture; one can come early if the house already backs the technology.",
  },

};

/** One piece of a card's text: plain words, or a link to another card. */
export type Segment = { text: string } | { link: string; text: string };

/** Splits a card's text into words and [[links]]. */
export function parseGlossary(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /\[\[([a-z_]+)(?:\|([^\]]+))?\]\]/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    const id = m[1]!;
    out.push({ link: id, text: m[2] ?? GLOSSARY[id]?.title.toLowerCase() ?? id });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
