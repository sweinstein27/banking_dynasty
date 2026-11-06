// One dialog per decision. Choices are big buttons; amounts are typed or picked from quick buttons.
// The sim checks every decision: a refusal shows its reason and keeps the dialog open.
import { Dialog, ToggleGroup } from "radix-ui";
import { useState, type ReactNode } from "react";
import { gameData } from "../data";
import { bondCost } from "../sim/bonds";
import { borrowingRoom, callRecovery, debtInterest } from "../sim/crisis";
import { ageIn, headOf, heirsOf, investCost, reputationGain, type Stat, STATS } from "../sim/family";
import { bondOffers, lendOffers, ventureOffers, type LendOffer } from "../sim/offers";
import { freeCash } from "../sim/reserves";
import type { Decision, GameState } from "../sim/types";
import { fl, parseAmount, pct } from "./format";

export type DecisionKind = Decision["kind"];

export const DECISION_LABELS: Record<DecisionKind, string> = {
  lend: "Lend to merchants",
  report: "Buy a report",
  buy_bond: "Buy state bonds",
  invest_venture: "Back a venture",
  set_reserve: "Set reserves",
  invest_family: "Invest in the family",
  borrow: "Borrow from the rival house",
  pay_slowly: "Pay depositors slowly",
  suspend: "Suspend withdrawals",
  call_loan: "Call a loan in",
};

/** Decisions only open during a crisis: shown in their own section of the Decisions panel. */
export const CRISIS_KINDS: DecisionKind[] = ["borrow", "pay_slowly", "suspend", "call_loan"];

export function DecisionDialog({ kind, state, onClose, onSubmit }: {
  kind: DecisionKind | null;
  state: GameState;
  onClose: () => void;
  /** Returns the sim's reason if the decision is refused, or null. */
  onSubmit: (d: Decision) => string | null;
}) {
  return (
    <Dialog.Root open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog" aria-describedby={undefined}>
          {kind && (
            <>
              <Dialog.Title>{DECISION_LABELS[kind]}</Dialog.Title>
              <p className="muted">Uses 1 action. Free cash above the reserve: {fl(freeCash(state))}</p>
              {kind === "lend" && <LendForm state={state} onSubmit={onSubmit} onDone={onClose} />}
              {kind === "report" && <ReportForm state={state} onSubmit={onSubmit} onDone={onClose} />}
              {kind === "buy_bond" && <BondForm state={state} onSubmit={onSubmit} onDone={onClose} />}
              {kind === "invest_venture" && <VentureForm state={state} onSubmit={onSubmit} onDone={onClose} />}
              {kind === "set_reserve" && <ReserveForm state={state} onSubmit={onSubmit} onDone={onClose} />}
              {kind === "invest_family" && <InvestFamilyForm state={state} onSubmit={onSubmit} onDone={onClose} />}
              {kind === "borrow" && <BorrowForm state={state} onSubmit={onSubmit} onDone={onClose} />}
              {kind === "pay_slowly" && <PayoutForm kind="pay_slowly" state={state} onSubmit={onSubmit} onDone={onClose} />}
              {kind === "suspend" && <PayoutForm kind="suspend" state={state} onSubmit={onSubmit} onDone={onClose} />}
              {kind === "call_loan" && <CallLoanForm state={state} onSubmit={onSubmit} onDone={onClose} />}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface FormProps {
  state: GameState;
  onSubmit: (d: Decision) => string | null;
  onDone: () => void;
}

function useSubmit({ onSubmit, onDone }: FormProps) {
  const [error, setError] = useState<string | null>(null);
  const submit = (d: Decision) => {
    const reason = onSubmit(d);
    if (reason) setError(reason);
    else onDone();
  };
  return { error, submit };
}

function Choices<T extends string>({ value, onChange, children }: { value: T | ""; onChange: (v: T) => void; children: ReactNode }) {
  return (
    <ToggleGroup.Root type="single" className="choices" value={value} onValueChange={(v) => v && onChange(v as T)}>
      {children}
    </ToggleGroup.Root>
  );
}

function Choice({ value, disabled, children }: { value: string; disabled?: boolean; children: ReactNode }) {
  return (
    <ToggleGroup.Item value={value} disabled={disabled} className="choice">
      {children}
    </ToggleGroup.Item>
  );
}

function AmountField({ label, text, onText, quick }: { label: string; text: string; onText: (t: string) => void; quick: [string, number][] }) {
  return (
    <div className="field">
      <label>
        <span>{label}</span>
        <input inputMode="numeric" value={text} onChange={(e) => onText(e.target.value)} />
      </label>
      <div className="row">
        {quick.map(([name, n]) => (
          <button key={name} type="button" className="secondary" onClick={() => onText(String(n))}>{name}</button>
        ))}
      </div>
    </div>
  );
}

/** Quick amounts as shares of free cash, rounded down to 100 fl. */
function shares(state: GameState): [string, number][] {
  const free = freeCash(state);
  const options: [string, number][] = [["25%", 0.25], ["50%", 0.5], ["All", 1]];
  return options.map(([name, f]) => {
    const n = Math.floor((free * f) / 100) * 100;
    return [`${name} (${fl(n)})`, n];
  });
}

function Footer({ error, canConfirm, onConfirm }: { error: string | null; canConfirm: boolean; onConfirm: () => void }) {
  return (
    <>
      {error && <p className="error">Refused: {error}</p>}
      <div className="row dialog-buttons">
        <Dialog.Close asChild>
          <button className="secondary">Cancel</button>
        </Dialog.Close>
        <button className="primary" disabled={!canConfirm} onClick={onConfirm}>Confirm</button>
      </div>
    </>
  );
}

/** One borrower's request, as a choice button: what they want, what they pay, and your estimate. */
function OfferSummary({ o }: { o: LendOffer }) {
  return (
    <>
      <strong>{o.name}, {o.trade}</strong>
      <span>Wants up to {fl(o.amount)} and pays up to {pct(o.max_rate)} a year.</span>
      <span>
        Your estimate of quality: {o.estimate.low.toFixed(2)} to {o.estimate.high.toFixed(2)}
        {o.reported ? " (from a report)" : ""}.
      </span>
      <span className="muted">
        {o.repaid === 0 && o.defaulted === 0 ? "No history with the house." : `With the house: repaid ${o.repaid}, defaulted ${o.defaulted}.`}
      </span>
    </>
  );
}

function NoRequests() {
  return <p>No one is asking for a loan this quarter.</p>;
}

function LendForm(props: FormProps) {
  const { state } = props;
  const { error, submit } = useSubmit(props);
  const [id, setId] = useState("");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const offers = lendOffers(state, gameData);
  const chosen = offers.find((o) => String(o.borrower_id) === id);
  const quick = shares(state).map(([name, n]): [string, number] => {
    const capped = chosen ? Math.min(n, chosen.amount) : n;
    return [name.replace(/\(.*\)/, `(${fl(capped)})`), capped];
  });

  if (!offers.length) return <><NoRequests /><Footer error={null} canConfirm={false} onConfirm={() => {}} /></>;
  return (
    <>
      <h3>Borrower</h3>
      <Choices value={id} onChange={(v) => {
        setId(v);
        const o = offers.find((x) => String(x.borrower_id) === v)!;
        setRate(String(+(o.max_rate * 100).toFixed(2)));
        setAmount(String(Math.min(o.amount, Math.floor(freeCash(state) / 100) * 100)));
      }}>
        {offers.map((o) => (
          <Choice key={o.borrower_id} value={String(o.borrower_id)}>
            <OfferSummary o={o} />
          </Choice>
        ))}
      </Choices>
      <AmountField label="Amount (fl.)" text={amount} onText={setAmount} quick={quick} />
      <div className="field">
        <label>
          <span>Annual rate (%)</span>
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
      </div>
      <p className="muted">Term {gameData.tuning.loans.term_quarters} quarters. Interest is paid each quarter, starting this one.</p>
      <Footer error={error} canConfirm={chosen !== undefined} onConfirm={() => chosen && submit({ kind: "lend", borrower: chosen.borrower_id, amount: parseAmount(amount), rate: Number(rate) / 100 })} />
    </>
  );
}

function ReportForm(props: FormProps) {
  const { state } = props;
  const { error, submit } = useSubmit(props);
  const [id, setId] = useState("");
  const offers = lendOffers(state, gameData);
  const { report_cost } = gameData.tuning.loans.estimate;

  if (!offers.length) return <><NoRequests /><Footer error={null} canConfirm={false} onConfirm={() => {}} /></>;
  return (
    <>
      <p>A correspondent looks into a borrower's books for {fl(report_cost)} The estimate of their quality narrows to a tight range around the truth.</p>
      <h3>Borrower</h3>
      <Choices value={id} onChange={setId}>
        {offers.map((o) => (
          <Choice key={o.borrower_id} value={String(o.borrower_id)} disabled={o.reported}>
            <OfferSummary o={o} />
            {o.reported && <span className="error">Already reported</span>}
          </Choice>
        ))}
      </Choices>
      <Footer error={error} canConfirm={id !== ""} onConfirm={() => submit({ kind: "report", borrower: Number(id) })} />
    </>
  );
}

function BondForm(props: FormProps) {
  const { state } = props;
  const { error, submit } = useSubmit(props);
  const [id, setId] = useState("");
  const [face, setFace] = useState("");
  const issuer = gameData.states.find((s) => s.id === id);
  const faceValue = parseAmount(face);
  const cost = issuer && Number.isFinite(faceValue) ? bondCost(state, issuer, faceValue, gameData.tuning) : null;

  return (
    <>
      <h3>State</h3>
      <Choices value={id} onChange={setId}>
        {bondOffers(state, gameData).map((o) => (
          <Choice key={o.id} value={o.id} disabled={o.blocked !== null}>
            <strong>{o.name}</strong>
            <span>Coupon {pct(o.coupon)} a year. Risk {o.risk}. Price {o.price} per fl. of face value.</span>
            {o.blocked && <span className="error">{o.blocked}</span>}
          </Choice>
        ))}
      </Choices>
      <AmountField label="Face value (fl.)" text={face} onText={setFace} quick={shares(state)} />
      {cost !== null && <p>Cost now: {fl(cost)}</p>}
      <Footer error={error} canConfirm={id !== ""} onConfirm={() => submit({ kind: "buy_bond", state: id, face_value: faceValue })} />
    </>
  );
}

function VentureForm(props: FormProps) {
  const { state } = props;
  const { error, submit } = useSubmit(props);
  const [id, setId] = useState("");
  const [amount, setAmount] = useState("");

  return (
    <>
      <h3>Venture</h3>
      <Choices value={id} onChange={setId}>
        {ventureOffers(state, gameData).map((o) => (
          <Choice key={o.id} value={o.id} disabled={o.blocked !== null}>
            <strong>{o.name}</strong>
            <span>Locked for {o.term_quarters} quarters. Returns {pct(o.expected_return)} on success. Fails {pct(o.failure_chance)} of the time if it ended in today's market.</span>
            {o.blocked && <span className="error">{o.blocked}</span>}
          </Choice>
        ))}
      </Choices>
      <AmountField label="Amount (fl.)" text={amount} onText={setAmount} quick={shares(state)} />
      <Footer error={error} canConfirm={id !== ""} onConfirm={() => submit({ kind: "invest_venture", venture: id, amount: parseAmount(amount) })} />
    </>
  );
}

function ReserveForm(props: FormProps) {
  const { state } = props;
  const { error, submit } = useSubmit(props);
  const [amount, setAmount] = useState(String(state.house.reserve));
  const quick: [string, number][] = [0, 10000, 20000, 30000, 50000].map((n) => [fl(n), n]);

  return (
    <>
      <p>Loans, bonds and ventures cannot take cash below the reserve. Withdrawals are paid from it first. Current reserve: {fl(state.house.reserve)}</p>
      <AmountField label="New reserve (fl.)" text={amount} onText={setAmount} quick={quick} />
      <Footer error={error} canConfirm onConfirm={() => submit({ kind: "set_reserve", amount: parseAmount(amount) })} />
    </>
  );
}

function BorrowForm(props: FormProps) {
  const { state } = props;
  const { error, submit } = useSubmit(props);
  const [amount, setAmount] = useState("");
  const r = gameData.tuning.crisis.rival;
  const room = borrowingRoom(state, gameData.tuning);
  const quick: [string, number][] = [10000, 25000, room]
    .filter((n, i, all) => n >= r.min_amount && n <= room && all.indexOf(n) === i)
    .map((n) => [n === room ? `All they will lend (${fl(n)})` : fl(n), n]);
  const n = parseAmount(amount);

  return (
    <>
      <p>
        {r.name} will lend up to {fl(r.max_outstanding)} in all, at {pct(r.rate)} a year. Interest is paid each quarter and the whole sum
        falls due after {r.term_quarters} quarters. If you cannot pay it then, assets are sold, as for depositors. Borrowing from a rival costs{" "}
        {r.reputation_cost} reputation.
      </p>
      <p>Room left to borrow: {fl(room)}</p>
      <AmountField label="Amount (fl.)" text={amount} onText={setAmount} quick={quick} />
      {Number.isFinite(n) && n > 0 && <p>Interest each quarter: {fl(debtInterest({ principal: n, rate: r.rate }))}</p>}
      <Footer error={error} canConfirm onConfirm={() => submit({ kind: "borrow", amount: n })} />
    </>
  );
}

function PayoutForm({ kind, ...props }: FormProps & { kind: "pay_slowly" | "suspend" }) {
  const { error, submit } = useSubmit(props);
  const c = gameData.tuning.crisis;
  return (
    <>
      {kind === "pay_slowly" ? (
        <p>
          This quarter, depositors are paid {pct(c.pay_slowly.share)} of what they ask. The rest stays owed. Costs{" "}
          {c.pay_slowly.reputation_cost} reputation, and lower reputation means more withdrawals later.
        </p>
      ) : (
        <p>
          This quarter, depositors are paid nothing. Everything stays owed. Costs {c.suspend.reputation_cost} reputation, and lower
          reputation means more withdrawals later.
        </p>
      )}
      <p>Current reputation: {props.state.house.reputation} of 100</p>
      <Footer error={error} canConfirm onConfirm={() => submit({ kind })} />
    </>
  );
}

function CallLoanForm(props: FormProps) {
  const { state } = props;
  const { error, submit } = useSubmit(props);
  const [id, setId] = useState("");
  const c = gameData.tuning.crisis.call_loan;
  const active = state.loans.filter((l) => l.status === "active");

  return (
    <>
      <p>
        The borrower pays back {pct(c.recovery)} of the principal now and you forgive the rest. They will not ask the house for a loan for{" "}
        {c.absence_quarters} quarters.
      </p>
      {active.length === 0 ? (
        <p>You have no active loans to call in.</p>
      ) : (
        <Choices value={id} onChange={setId}>
          {active.map((l) => (
            <Choice key={l.id} value={String(l.id)}>
              <strong>Loan #{l.id}, {l.borrower_name}</strong>
              <span>{fl(l.principal)} at {pct(l.rate)}. Calling it in brings back {fl(callRecovery(l.principal, gameData.tuning))} now.</span>
            </Choice>
          ))}
        </Choices>
      )}
      <Footer error={error} canConfirm={id !== ""} onConfirm={() => submit({ kind: "call_loan", loan: Number(id) })} />
    </>
  );
}

const STAT_HELP: Record<Stat, string> = {
  acumen: "Acumen: ventures fail less often",
  prudence: "Prudence: sharper estimates of borrowers",
  connections: "Connections: states sell bonds at a lower reputation",
};

function InvestFamilyForm(props: FormProps) {
  const { state } = props;
  const { error, submit } = useSubmit(props);
  const [form, setForm] = useState<"" | "educate" | "charity" | "patronage">("");
  const [heir, setHeir] = useState("");
  const [stat, setStat] = useState<"" | Stat>("");
  const inv = gameData.tuning.family.invest;
  // Costs and reputation as the head's traits make them (a spendthrift pays more, a charismatic head gains more).
  const charityGain = reputationGain(inv.charity.reputation, state, gameData);
  const patronageGain = reputationGain(inv.patronage.reputation, state, gameData);
  const head = headOf(state);
  const heirs = heirsOf(state);
  const chosen = heirs.find((p) => String(p.id) === heir);
  const ready = form === "charity" || form === "patronage" || (form === "educate" && chosen !== undefined && stat !== "");

  return (
    <>
      <h3>How</h3>
      <Choices value={form} onChange={(v) => setForm(v as typeof form)}>
        <Choice value="educate" disabled={heirs.length === 0}>
          <strong>Educate an heir ({fl(investCost("educate", state, gameData))})</strong>
          <span>Tutors raise one of an heir's stats by {inv.educate.gain}. A trained heir makes a smooth succession.</span>
        </Choice>
        <Choice value="charity">
          <strong>Charity ({fl(investCost("charity", state, gameData))})</strong>
          <span>A gift to the poor of Frankfurt: reputation +{charityGain}, drawing about {fl(charityGain * gameData.tuning.deposits.per_reputation)} more in deposits over calm years.</span>
        </Choice>
        <Choice value="patronage">
          <strong>Patronage ({fl(investCost("patronage", state, gameData))})</strong>
          <span>
            Sponsor the arts: {head?.name ?? "the head"}'s connections +{inv.patronage.connections}, reputation +{patronageGain} (about {fl(patronageGain * gameData.tuning.deposits.per_reputation)} more in deposits).
          </span>
        </Choice>
      </Choices>
      {form === "educate" && (
        <>
          <h3>Heir</h3>
          <Choices value={heir} onChange={setHeir}>
            {heirs.map((p) => (
              <Choice key={p.id} value={String(p.id)}>
                <strong>{p.name}, aged {ageIn(p, state.world.year)}</strong>
                <span>Acumen {p.acumen}, prudence {p.prudence}, connections {p.connections}</span>
              </Choice>
            ))}
          </Choices>
          <h3>Subject</h3>
          <Choices value={stat} onChange={(v) => setStat(v as Stat)}>
            {STATS.map((k) => (
              <Choice key={k} value={k}>
                <strong>{STAT_HELP[k]}</strong>
                {chosen && <span>Now {chosen[k]} of {gameData.tuning.family.max_stat}</span>}
              </Choice>
            ))}
          </Choices>
        </>
      )}
      <Footer
        error={error}
        canConfirm={ready}
        onConfirm={() => {
          if (form === "educate" && chosen && stat) submit({ kind: "invest_family", form, heir: chosen.id, stat });
          else if (form === "charity" || form === "patronage") submit({ kind: "invest_family", form });
        }}
      />
    </>
  );
}
