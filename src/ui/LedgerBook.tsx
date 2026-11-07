// The ledger book: the accounts as an open book, with ribbon tabs for holdings and this quarter's
// entries. Shows `preview` (queued decisions included), so every choice shows in the books at once.
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { Tabs } from "radix-ui";
import { useMemo } from "react";
import { gameData } from "../data";
import { bondBook, bondValue, quarterlyCoupon } from "../sim/bonds";
import { debtBook, debtInterest } from "../sim/crisis";
import { depositLevel } from "../sim/deposits";
import { freeCash } from "../sim/reserves";
import { loanBook, netWorth } from "../sim/turn";
import type { GameState, LedgerEntry } from "../sim/types";
import { quartersLeft, ventureBook, venturePayout } from "../sim/ventures";
import { fl, pct, signedFl } from "./format";
import { PageTurner, usePages } from "./Pager";
import { Term } from "./Term";
import { WorthChart } from "./WorthChart";

const HOLDINGS_PER_PAGE = 5;
const ENTRIES_PER_PAGE = 7;

interface Row extends LedgerEntry {
  when: string;
}

const features = tableFeatures({});
const col = createColumnHelper<typeof features, Row>();
const columns = col.columns([
  col.accessor("when", { header: "When" }),
  col.accessor("account", { header: "Account" }),
  col.accessor("category", { header: "Entry", cell: (c) => c.getValue().replace(/_/g, " ") }),
  col.accessor("amount", { header: "Amount", cell: (c) => signedFl(c.getValue()) }),
  col.accessor("note", { header: "Note" }),
]);

export function LedgerBook({ base, preview }: { base: GameState; preview: GameState }) {
  return (
    <div className="doc ledger">
      <Tabs.Root defaultValue="accounts" className="ledger-tabs">
        <Tabs.List className="ribbons" aria-label="Ledger pages">
          <Tabs.Trigger value="accounts" className="ribbon">Accounts</Tabs.Trigger>
          <Tabs.Trigger value="holdings" className="ribbon">Holdings</Tabs.Trigger>
          <Tabs.Trigger value="entries" className="ribbon">Entries</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="accounts" className="ledger-page">
          <Accounts state={preview} />
        </Tabs.Content>
        <Tabs.Content value="holdings" className="ledger-page">
          <Holdings state={preview} />
        </Tabs.Content>
        <Tabs.Content value="entries" className="ledger-page">
          <Entries base={base} preview={preview} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function Accounts({ state }: { state: GameState }) {
  const { house } = state;
  const loans = loanBook(state);
  const bonds = bondBook(state);
  const ventures = ventureBook(state);
  const debts = debtBook(state);
  return (
    <>
      <div className="spread">
        <div className="leaf">
          <h3>What the house owns</h3>
          <dl className="accounts">
            <dt><Term id="cash">Cash</Term></dt><dd>{fl(house.cash)}</dd>
            <dt><Term id="loans">Loans</Term></dt><dd>{fl(loans)}</dd>
            <dt><Term id="bonds">Bonds</Term></dt><dd>{fl(bonds)}</dd>
            <dt><Term id="ventures">Ventures</Term></dt><dd>{fl(ventures)}</dd>
            <dt className="total">Total</dt><dd className="total">{fl(house.cash + loans + bonds + ventures)}</dd>
          </dl>
        </div>
        <div className="leaf">
          <h3>What the house owes</h3>
          <dl className="accounts">
            <dt><Term id="deposits">Deposits</Term></dt><dd>{fl(house.deposits)}</dd>
            <dt><Term id="borrowings">Borrowings</Term></dt><dd>{fl(debts)}</dd>
            <dt className="total">Total</dt><dd className="total">{fl(house.deposits + debts)}</dd>
          </dl>
        </div>
      </div>
      <WorthChart state={state} now={netWorth(state)} />
      <dl className="ledger-foot">
        <dt><Term id="net_worth">Net worth</Term></dt><dd className="net-worth">{fl(netWorth(state))}</dd>
        <dt><Term id="reserve">Reserve</Term></dt><dd>{fl(house.reserve)}</dd>
        <dt><Term id="free_cash">Free cash</Term></dt><dd>{fl(freeCash(state))}</dd>
        <dt><Term id="reputation">Reputation</Term></dt><dd>{house.reputation} of 100</dd>
        <dt>Draws deposits of</dt><dd>{fl(depositLevel(house.reputation, gameData.tuning))}</dd>
      </dl>
    </>
  );
}

/** What the house knows of a borrower's books. True quality is never shown. */
function estimateText(state: GameState, borrowerId: number): string {
  const f = state.borrowers.find((x) => x.id === borrowerId)?.file;
  if (!f) return "no report";
  return `${f.tier === "inquiry" ? "inquiry" : "report"}: profit ${fl(f.profit)}, debts ${fl(f.debts)}`;
}

function Holdings({ state }: { state: GameState }) {
  const stateName = (id: string) => gameData.states.find((s) => s.id === id)?.name ?? id;
  const ventureName = (id: string) => gameData.ventures.find((v) => v.id === id)?.name ?? id;
  const lines = [
    ...state.loans.filter((l) => l.status === "active").map((l) => ({
      key: `l${l.id}`, cls: "", text: `Loan to ${l.borrower_name}: ${fl(l.principal)} at ${pct(l.rate)}, ${quartersLeft(state, l)} qtr left, ${estimateText(state, l.borrower_id)}`,
    })),
    ...state.bonds.filter((b) => b.status === "active").map((b) => ({
      key: `b${b.id}`, cls: "", text: `${stateName(b.issuer_state)} bonds: ${fl(b.face_value)} face at ${b.price}, worth ${fl(bondValue(b))}, coupon ${fl(quarterlyCoupon(b))} a quarter`,
    })),
    ...state.ventures.filter((v) => v.status === "active").map((v) => ({
      key: `v${v.id}`, cls: "", text: `${ventureName(v.type)}: ${fl(v.invested)} locked, pays ${fl(venturePayout(v))} in ${quartersLeft(state, v)} qtr if it succeeds`,
    })),
    ...state.debts.filter((d) => d.status === "active").map((d) => ({
      key: `d${d.id}`, cls: "debt", text: `Owed to ${d.lender}: ${fl(d.principal)} at ${pct(d.rate)}, interest ${fl(debtInterest(d))} a quarter, due in ${quartersLeft(state, d)} qtr`,
    })),
  ];
  const pages = usePages(lines, HOLDINGS_PER_PAGE);
  return (
    <>
      {lines.length === 0 ? (
        <p className="muted">No loans, bonds, ventures or debts.</p>
      ) : (
        <ul className="holdings">
          {pages.items.map((l) => <li key={l.key} className={l.cls}>{l.text}</li>)}
        </ul>
      )}
      <PageTurner pages={pages} />
    </>
  );
}

function Entries({ base, preview }: { base: GameState; preview: GameState }) {
  const rows = useMemo<Row[]>(() => {
    const lastTurn = base.world.turn - 1;
    const resolved = base.ledger
      .filter((e) => (lastTurn === 0 ? e.category === "opening" : e.turn === lastTurn))
      .map((e) => ({ ...e, when: lastTurn === 0 ? "Opening" : "Last quarter" }));
    const queued = preview.ledger.filter((e) => e.id >= base.next_ledger_id).map((e) => ({ ...e, when: "Queued" }));
    return [...queued, ...resolved];
  }, [base, preview]);
  const pages = usePages(rows, ENTRIES_PER_PAGE);
  const table = useTable({ features, columns, data: pages.items });

  if (rows.length === 0) return <p className="muted">No entries yet.</p>;
  return (
    <>
      <table className="entries">
        <thead>
          {table.getHeaderGroups().map((g) => (
            <tr key={g.id}>
              {g.headers.map((h) => (
                <th key={h.id}>{h.isPlaceholder ? null : <table.FlexRender header={h} />}</th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr key={r.id} className={r.original.when === "Queued" ? "queued" : undefined}>
              {r.getAllCells().map((c) => (
                <td key={c.id} className={c.column.id === "amount" ? "num" : undefined}>
                  <table.FlexRender cell={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <PageTurner pages={pages} />
    </>
  );
}
