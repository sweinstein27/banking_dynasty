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
    body: (d) =>
      `Merchants borrow for ${d.tuning.loans.term_quarters} quarters and pay interest every quarter. A loan counts at its principal until it is repaid, or it [[default|defaults]]. You see an [[estimate]] of a borrower's quality, never the truth.`,
  },
  estimate: {
    title: "Estimate of quality",
    body: (d) =>
      `How likely a borrower is to repay, from 0 to 1, as a range that always contains the truth. The head's [[prudence]] narrows it; a [[report]] for ${fl(d.tuning.loans.estimate.report_cost)} narrows it most.`,
  },
  report: {
    title: "A correspondent's report",
    body: () => "A look at a borrower's books. It narrows your [[estimate]] of their quality to a tight range around the truth, and uses one of the quarter's [[actions]].",
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
    body: () =>
      "Mills, shipping lines and later railways. Money is locked up until the venture ends, then it pays out or fails. Ventures count at cost until then. The head's [[acumen]] makes failure less likely; a stormy [[market_mood]] makes it more likely.",
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
      "What the house's obligations cost each quarter at today's balances: [[deposit_interest]] and interest on [[borrowings]]. Wages for staff and the upkeep of rooms will join it with the [[counting_house]].",
  },
  counting_house: {
    title: "The counting house",
    body: () => "The house's staff and rooms: clerks, correspondents, tellers, a strongroom. Coming soon, it will set how much the house can do each quarter in place of the three [[actions]].",
  },
  actions: {
    title: "Actions",
    body: (d) => `The house can take ${d.tuning.actions_per_turn} actions a quarter: each loan, bond, venture, reserve change, family investment, courtship or marriage uses one. Answering [[letters]] uses none.`,
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
    body: () => "The head's eye for a bad borrower: each point narrows your [[estimate]] of a borrower's quality.",
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
