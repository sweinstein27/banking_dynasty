import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useMemo } from "react";
import { gameData } from "../data";
import { bondBook, bondValue, quarterlyCoupon } from "../sim/bonds";
import { freeCash } from "../sim/reserves";
import { loanBook, netWorth } from "../sim/turn";
import type { GameState, LedgerEntry } from "../sim/types";
import { quartersLeft, ventureBook, venturePayout } from "../sim/ventures";
import { fl, pct, signedFl } from "./format";

interface Row extends LedgerEntry {
  when: string;
}

const features = tableFeatures({});
const col = createColumnHelper<typeof features, Row>();
const columns = col.columns([
  col.accessor("when", { header: "When" }),
  col.accessor("account", { header: "Account" }),
  col.accessor("category", { header: "Category", cell: (c) => c.getValue().replace(/_/g, " ") }),
  col.accessor("amount", { header: "Amount", cell: (c) => signedFl(c.getValue()) }),
  col.accessor("note", { header: "Note" }),
]);

/** Balance sheet and holdings from `preview` (queued decisions included); entries from last quarter plus the queue. */
export function LedgerPanel({ base, preview }: { base: GameState; preview: GameState }) {
  const rows = useMemo<Row[]>(() => {
    const lastTurn = base.world.turn - 1;
    const resolved = base.ledger
      .filter((e) => (lastTurn === 0 ? e.category === "opening" : e.turn === lastTurn))
      .map((e) => ({ ...e, when: lastTurn === 0 ? "Opening" : "Last quarter" }));
    const queued = preview.ledger.filter((e) => e.id >= base.next_ledger_id).map((e) => ({ ...e, when: "Queued" }));
    return [...queued, ...resolved];
  }, [base, preview]);
  const table = useTable({ features, columns, data: rows });
  const { house } = preview;

  return (
    <section className="panel">
      <h2>Ledger</h2>
      <table className="sheet">
        <tbody>
          <tr><th>Cash</th><td>{fl(house.cash)}</td><th>Deposits owed</th><td>{fl(house.deposits)}</td></tr>
          <tr><th>Loans</th><td>{fl(loanBook(preview))}</td><th>Reserve</th><td>{fl(house.reserve)}</td></tr>
          <tr><th>Bonds</th><td>{fl(bondBook(preview))}</td><th>Free cash</th><td>{fl(freeCash(preview))}</td></tr>
          <tr><th>Ventures</th><td>{fl(ventureBook(preview))}</td><th>Net worth</th><td className="strong">{fl(netWorth(preview))}</td></tr>
        </tbody>
      </table>

      <Holdings state={preview} />

      <h3>This turn's entries</h3>
      {rows.length === 0 ? (
        <p className="muted">No entries yet.</p>
      ) : (
        <div className="scroll">
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
        </div>
      )}
    </section>
  );
}

function Holdings({ state }: { state: GameState }) {
  const loans = state.loans.filter((l) => l.status === "active");
  const bonds = state.bonds.filter((b) => b.status === "active");
  const ventures = state.ventures.filter((v) => v.status === "active");
  const stateName = (id: string) => gameData.states.find((s) => s.id === id)?.name ?? id;
  const ventureName = (id: string) => gameData.ventures.find((v) => v.id === id)?.name ?? id;

  return (
    <>
      <h3>Holdings</h3>
      {!loans.length && !bonds.length && !ventures.length ? (
        <p className="muted">No loans, bonds or ventures.</p>
      ) : (
        <ul className="holdings">
          {loans.map((l) => (
            <li key={`l${l.id}`}>
              Loan #{l.id}, {l.borrower_name}: {fl(l.principal)} at {pct(l.rate)}, quality {l.quality}, {quartersLeft(state, l)} qtr left
            </li>
          ))}
          {bonds.map((b) => (
            <li key={`b${b.id}`}>
              Bond #{b.id}, {stateName(b.issuer_state)}: {fl(b.face_value)} face at {b.price}, worth {fl(bondValue(b))}, coupon {fl(quarterlyCoupon(b))} a quarter
            </li>
          ))}
          {ventures.map((v) => (
            <li key={`v${v.id}`}>
              Venture #{v.id}, {ventureName(v.type)}: {fl(v.invested)} locked, pays {fl(venturePayout(v))} in {quartersLeft(state, v)} qtr if it succeeds
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
